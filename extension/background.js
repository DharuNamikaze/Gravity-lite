// =============================================================================
// Gravity v3 — Service Worker (MV3)
//
// Responsibilities:
//   1. Manage chrome.debugger attachment (only works in SW context)
//   2. Ensure the offscreen document (WebSocket bridge) is always alive
//   3. Route messages between offscreen doc ↔ popup ↔ CDP
//
// The offscreen document owns the persistent WebSocket to the MCP server.
// The SW wakes on demand to execute CDP commands via chrome.debugger.
// =============================================================================

let debuggerState = {
  attached: false,
  tabId: null,
  domainsEnabled: false,
  lastError: null,
  attachmentTime: null,
};

let wsConnected = false; // reflects offscreen WS status

// ── Offscreen document management ────────────────────────────────────────────

async function ensureOffscreen() {
  // chrome.offscreen available since Chrome 116
  const existing = await chrome.offscreen.hasDocument().catch(() => false);
  if (!existing) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['WORKERS'],
      justification: 'Maintain persistent WebSocket connection to local MCP server bridge',
    }).catch(() => {
      // May fail if already being created — ignore
    });
  }
}

// ── Message routing ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {

  // ── From offscreen document ───────────────────────────────────────────────
  if (msg.to === 'sw') {

    if (msg.type === 'ws_status') {
      wsConnected = msg.connected;
      // Broadcast to popup if open
      chrome.runtime.sendMessage({ action: 'ws_status_update', connected: msg.connected }).catch(() => {});
      return;
    }

    if (msg.type === 'cdp_request') {
      // Execute CDP via chrome.debugger, send response back to offscreen
      const { id, method, params } = msg.payload;

      if (!debuggerState.attached || !debuggerState.tabId) {
        chrome.runtime.sendMessage({
          to: 'offscreen',
          type: 'cdp_response',
          payload: { type: 'cdp_response', id, error: { message: 'Debugger not attached. Click "Connect to Tab" in the Gravity popup.' } }
        }).catch(() => {});
        return;
      }

      chrome.debugger.sendCommand({ tabId: debuggerState.tabId }, method, params || {}, (result) => {
        const response = chrome.runtime.lastError
          ? { type: 'cdp_response', id, error: { message: chrome.runtime.lastError.message } }
          : { type: 'cdp_response', id, result };

        chrome.runtime.sendMessage({ to: 'offscreen', type: 'cdp_response', payload: response }).catch(() => {});
      });
      return;
    }
  }

  // ── From popup ────────────────────────────────────────────────────────────

  if (msg.action === 'attach') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs?.[0]?.id) return sendResponse({ success: false, error: 'No active tab found' });
      attachDebugger(tabs[0].id, sendResponse);
    });
    return true; // async
  }

  if (msg.action === 'detach') {
    detachDebugger(sendResponse);
    return true;
  }

  if (msg.action === 'status') {
    sendResponse({ ...debuggerState, wsConnected });
    return true;
  }
});

// ── Debugger management ───────────────────────────────────────────────────────

function attachDebugger(tabId, callback) {
  debuggerState.lastError = null;

  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab) {
      const err = chrome.runtime.lastError?.message || 'Tab not found';
      debuggerState.lastError = err;
      return callback({ success: false, error: err });
    }

    if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) {
      const err = `Cannot attach to browser page: ${tab.url}`;
      debuggerState.lastError = err;
      return callback({ success: false, error: err });
    }

    // Detach from previous tab if different
    if (debuggerState.attached && debuggerState.tabId && debuggerState.tabId !== tabId) {
      chrome.debugger.detach({ tabId: debuggerState.tabId }, () => {});
    }

    chrome.debugger.attach({ tabId }, '1.3', () => {
      if (chrome.runtime.lastError) {
        const err = chrome.runtime.lastError.message;
        debuggerState.lastError = err;
        debuggerState.attached = false;
        return callback({ success: false, error: err });
      }

      debuggerState.attached = true;
      debuggerState.tabId = tabId;
      debuggerState.domainsEnabled = false;
      debuggerState.attachmentTime = Date.now();

      enableCDPDomains(tabId, () => {
        debuggerState.domainsEnabled = true;
        // Make sure offscreen WS bridge is running
        ensureOffscreen();
        callback({ success: true, tabId });
      });
    });
  });
}

function detachDebugger(callback) {
  if (!debuggerState.tabId) {
    debuggerState = { attached: false, tabId: null, domainsEnabled: false, lastError: null, attachmentTime: null };
    return callback({ success: true });
  }
  chrome.debugger.detach({ tabId: debuggerState.tabId }, () => {
    debuggerState = { attached: false, tabId: null, domainsEnabled: false, lastError: null, attachmentTime: null };
    callback({ success: true });
  });
}

function enableCDPDomains(tabId, done) {
  const domains = ['DOM', 'CSS', 'Page', 'Overlay'];
  let i = 0;
  const next = () => {
    if (i >= domains.length) return done();
    const domain = domains[i++];
    chrome.debugger.sendCommand({ tabId }, `${domain}.enable`, {}, () => {
      if (chrome.runtime.lastError) {
        console.warn(`[gravity] failed to enable ${domain}:`, chrome.runtime.lastError.message);
      }
      next();
    });
  };
  next();
}

// ── Chrome events ─────────────────────────────────────────────────────────────

chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId === debuggerState.tabId) {
    debuggerState = {
      attached: false, tabId: null, domainsEnabled: false,
      lastError: reason === 'target_closed' ? 'Tab was closed' : `Detached: ${reason}`,
      attachmentTime: null,
    };
  }
  chrome.runtime.sendMessage({ action: 'debugger_detached', tabId: source.tabId, reason }).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === debuggerState.tabId && changeInfo.status === 'loading') {
    debuggerState.domainsEnabled = false;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === debuggerState.tabId) {
    debuggerState = { attached: false, tabId: null, domainsEnabled: false, lastError: 'Tab was closed', attachmentTime: null };
  }
});

// ── Boot — ensure offscreen doc is alive on SW startup ───────────────────────
ensureOffscreen();
