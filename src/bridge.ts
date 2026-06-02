/**
 * bridge.ts — WebSocket server that the Chrome extension connects to.
 *
 * The MCP server IS the WebSocket server. The extension connects OUT to us.
 * No native messaging. No manifest. No OS-specific registration.
 *
 * Extension  ──WS──►  Bridge (this)  ──CDP──►  MCP tools
 */

import { WebSocketServer, WebSocket } from 'ws';

const PORT = process.env.GRAVITY_PORT ? Number(process.env.GRAVITY_PORT) : 9224;
const CDP_TIMEOUT_MS = 10_000;

let extensionSocket: WebSocket | null = null;
let msgIdCounter = 1;

const pending = new Map<number, {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}>();

// ── Start the bridge server ───────────────────────────────────────────────────

export function startBridge(): Promise<void> {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port: PORT, host: '127.0.0.1' });

    wss.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(
          `Port ${PORT} is already in use. ` +
          `Set GRAVITY_PORT env var to use a different port, ` +
          `then reload the extension popup to reconnect.`
        ));
      } else {
        reject(err);
      }
    });

    wss.on('listening', () => {
      console.error(`[gravity] bridge listening on ws://127.0.0.1:${PORT}`);
      resolve();
    });

    wss.on('connection', (ws, req) => {
      const origin = req.headers.origin ?? 'unknown';
      console.error(`[gravity] extension connected (origin: ${origin})`);

      // Only one extension at a time — close the old one
      if (extensionSocket && extensionSocket.readyState === WebSocket.OPEN) {
        extensionSocket.close();
      }
      extensionSocket = ws;

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString()) as {
            type: string;
            id: number;
            result?: unknown;
            error?: { message: string };
          };

          if (msg.type === 'cdp_response') {
            const p = pending.get(msg.id);
            if (p) {
              clearTimeout(p.timer);
              pending.delete(msg.id);
              if (msg.error) {
                p.reject(new Error(msg.error.message));
              } else {
                p.resolve(msg.result);
              }
            }
          }
        } catch (e) {
          console.error('[gravity] bridge parse error:', e);
        }
      });

      ws.on('close', () => {
        console.error('[gravity] extension disconnected');
        if (extensionSocket === ws) extensionSocket = null;
        // Reject all pending requests
        for (const [id, p] of pending) {
          clearTimeout(p.timer);
          p.reject(new Error('Extension disconnected'));
          pending.delete(id);
        }
      });

      ws.on('error', (err) => {
        console.error('[gravity] extension socket error:', err.message);
      });
    });
  });
}

// ── Send a CDP command through the extension ──────────────────────────────────

export function sendCDP(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  if (!extensionSocket || extensionSocket.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error(
      'Browser extension not connected. ' +
      'Make sure Chrome is open, the Gravity extension is loaded, ' +
      'and you clicked "Connect to Tab" in the popup.'
    ));
  }

  const id = msgIdCounter++;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP ${method} timed out after ${CDP_TIMEOUT_MS}ms`));
    }, CDP_TIMEOUT_MS);

    pending.set(id, { resolve, reject, timer });
    extensionSocket!.send(JSON.stringify({ type: 'cdp_request', id, method, params }));
  });
}

// ── Status helpers ────────────────────────────────────────────────────────────

export function isExtensionConnected(): boolean {
  return extensionSocket !== null && extensionSocket.readyState === WebSocket.OPEN;
}

export function getBridgePort(): number {
  return PORT;
}
