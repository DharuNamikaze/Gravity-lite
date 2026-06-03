// =============================================================================
// Gravity v3 — Offscreen Document
//
// Lives permanently (Chrome keeps offscreen docs alive while a WebSocket is
// open). Owns the WS connection to the MCP server bridge.
//
// Port is passed by the SW as a URL search param:
//   offscreen.html?port=9224
//
// If the user changes the port in the popup, the SW sends a 'reconfigure'
// message with the new port and this document reconnects immediately.
//
// Message flow:
//   SW  →  chrome.runtime.sendMessage({ to:'offscreen', ... })  →  here
//   here → chrome.runtime.sendMessage({ to:'sw', ... })         →  SW
// =============================================================================

const DEFAULT_PORT = 9224;
const RECONNECT_MS = 2000;

// Read port from URL search params — set by background.js when creating this doc
function portFromURL() {
  const p = parseInt(new URLSearchParams(location.search).get('port') ?? '', 10);
  return Number.isFinite(p) && p > 0 && p < 65536 ? p : DEFAULT_PORT;
}

let wsPort = portFromURL();
let ws = null;
let wsReady = false;

// ── WebSocket to MCP server ───────────────────────────────────────────────────

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  try {
    ws = new WebSocket(`ws://127.0.0.1:${wsPort}`);

    ws.onopen = () => {
      wsReady = true;
      chrome.runtime.sendMessage({ to: 'sw', type: 'ws_status', connected: true }).catch(() => {});
    };

    ws.onmessage = ({ data }) => {
      try {
        const msg = JSON.parse(data);
        // Forward CDP requests from MCP server → SW (which has chrome.debugger)
        if (msg.type === 'cdp_request') {
          chrome.runtime.sendMessage({ to: 'sw', type: 'cdp_request', payload: msg }).catch(() => {});
        }
      } catch (e) {
        console.error('[gravity/offscreen] parse error', e);
      }
    };

    ws.onclose = () => {
      wsReady = false;
      ws = null;
      chrome.runtime.sendMessage({ to: 'sw', type: 'ws_status', connected: false }).catch(() => {});
      setTimeout(connect, RECONNECT_MS);
    };

    ws.onerror = () => {
      // onclose fires right after — it handles the retry
    };
  } catch (e) {
    console.error('[gravity/offscreen] WS create failed', e);
    setTimeout(connect, RECONNECT_MS);
  }
}

function disconnect() {
  if (ws) {
    ws.onclose = null; // suppress automatic retry during intentional close
    ws.close();
    ws = null;
    wsReady = false;
  }
}

// ── Receive messages from SW ──────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.to !== 'offscreen') return;

  // CDP response — forward back to MCP server over WebSocket
  if (msg.type === 'cdp_response') {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg.payload));
    }
    return;
  }

  // Port changed — reconnect with new port immediately
  if (msg.type === 'reconfigure') {
    const p = parseInt(msg.port, 10);
    if (Number.isFinite(p) && p > 0 && p < 65536 && p !== wsPort) {
      wsPort = p;
      disconnect();
      connect();
    }
    return;
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────────

connect();
