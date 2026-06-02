// =============================================================================
// Gravity v3 — Offscreen Document
//
// Lives permanently (Chrome keeps offscreen docs alive while a WebSocket is
// open). Owns the WS connection to the MCP server bridge on :9224.
//
// Message flow:
//   SW  →  chrome.runtime.sendMessage({ to:'offscreen', ... })  →  here
//   here → chrome.runtime.sendMessage({ to:'sw', ... })         →  SW
// =============================================================================

const WS_PORT = 9224;
const RECONNECT_MS = 2000;

let ws = null;
let wsReady = false;

// ── WebSocket to MCP server ───────────────────────────────────────────────────

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  try {
    ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}`);

    ws.onopen = () => {
      wsReady = true;
      // Tell SW the bridge is up so it can update the popup
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
      // onclose fires right after, handles retry
    };
  } catch (e) {
    console.error('[gravity/offscreen] WS create failed', e);
    setTimeout(connect, RECONNECT_MS);
  }
}

// ── Receive CDP responses from SW, forward to MCP server ─────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.to !== 'offscreen') return;

  if (msg.type === 'cdp_response') {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg.payload));
    }
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────────

connect();
