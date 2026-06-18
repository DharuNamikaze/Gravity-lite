# gravity-lite

AI-powered CSS layout diagnostics. Zero-config MCP server for AI assistants.

[![npm version](https://img.shields.io/npm/v/gravity-lite.svg)](https://www.npmjs.com/package/gravity-lite)
[![license](https://img.shields.io/npm/l/gravity-lite.svg)](LICENSE)

Give your AI assistant (Kiro, Cursor, Claude, etc.) the ability to **see what actually renders** in your browser — not just read source code. Gravity bridges AI tools to live Chrome tabs via the Chrome DevTools Protocol.

**Requirements:** Node.js ≥ 16, Chrome ≥ 116

---

## Installation

### Step 1 — Install the package

```bash
npm install -g gravity-lite
```

### Step 2 — Add to your IDE MCP config

Pick your IDE and add the `gravity` server. Then **restart your IDE**.

**Kiro** — `.kiro/settings/mcp.json`

**Cursor** — `~/.cursor/mcp.json`

**Claude Desktop** — `claude_desktop_config.json`

```json
{
  "mcpServers": {
    "gravity": {
      "command": "gravity"
    }
  }
}
```

### Step 3 — Load the Chrome extension

Run this to get the exact folder path:

```bash
gravity doctor
```

Then in Chrome:

1. Go to `chrome://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `extension/` folder printed by `gravity doctor`

### Step 4 — Connect to a tab

1. Open the page you want to debug in Chrome
2. Click the **⚡ Gravity** icon in the Chrome toolbar
3. Click **Connect to Tab**

The popup shows two status dots — both should go green once connected.

That's it. Ask your AI to diagnose anything.

---

## Usage

```
diagnose the #header element
why is .modal behind everything
check accessibility of the .submit-btn
screenshot the #hero section
highlight .nav-bar for 5 seconds
debug the flex container .card-grid
```

The difference: when the AI answers, it's reading from the **live browser**. Every number it gives you came from a real CDP call. It's not guessing.

---

## Tools

| Tool | What it does |
|---|---|
| `connect_browser` | Check extension connection status |
| `diagnose_layout` | Detect overflow, hidden, offscreen, unresolved CSS vars |
| `inspect_stacking` | Debug z-index failures and stacking context traps |
| `check_accessibility` | WCAG contrast ratio, touch targets, ARIA tree |
| `inspect_responsive` | Fixed widths that break on mobile, viewport overflow |
| `debug_flexgrid` | Flexbox/Grid container + children deep analysis |
| `get_computed_layout` | Full computed style snapshot with CSS rule specificity |
| `highlight_element` | Color-coded overlay in the browser (content/padding/border/margin) |
| `screenshot_element` | Capture any element as a base64 PNG |
| `get_page_performance` | Layout thrash metrics, paint timings |
| `capture_viewport` | Screenshot the full visible viewport |

---

## How it works

```
IDE / AI  ──stdio──►  MCP Server (Node.js)
                           │
                      WS :9224  ◄── extension connects OUT to server
                           │         (no native messaging, no OS setup)
                    Chrome Extension (MV3)
                     ├── offscreen.js  — persistent WebSocket
                     └── background.js — chrome.debugger API
                           │
                       Active Tab (CDP)
```

The extension connects *out* to the MCP server — not the other way around. No native messaging, no registry keys, no OS-specific setup. Works on Linux, macOS, and Windows.

---

## Commands

```bash
gravity           # start MCP server (your IDE calls this automatically)
gravity doctor    # check setup and print the extension folder path
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `GRAVITY_PORT` | `9224` | WebSocket bridge port (set in both MCP config *and* the popup) |
| `GRAVITY_CDP_TIMEOUT_MS` | `10000` | Per-CDP-call timeout in ms (0 = no timeout) |

**Changing the port:** When you set `GRAVITY_PORT` in your MCP config, the server listens on that port — but the extension still defaults to 9224. Use the popup's **MCP port** field to point the extension at the same port. Both sides must agree.

---

## Security note

The WebSocket bridge binds to `127.0.0.1` only — it is not exposed to the network. However, any process on the local machine can connect to it and drive Chrome through CDP (read the DOM, take screenshots, evaluate JavaScript). If this is a concern in your environment, consider:

1. Running the bridge behind a local firewall rule
2. Using a per-connection token (future versions may add optional auth)

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "Browser extension not connected" | Open Chrome, load the extension, click "Connect to Tab" |
| "Port 9224 already in use" | Set `GRAVITY_PORT=9225` in your MCP config **and** update the popup port field |
| MCP server dot stays red in popup | Make sure `gravity` is running — check IDE MCP status panel |
| "Element not found: #selector" | Verify the selector exists on the current page |
| Chrome version error | The offscreen API requires Chrome 116 or later |

---

## Contributing

Contributions are welcome — bug reports, docs fixes, and new MCP tools alike. The project is MIT licensed, so anything you contribute ships under the same terms.

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions, branch naming, commit message format, and the PR checklist.

---

[npm](https://www.npmjs.com/package/gravity-lite) · [GitHub](https://github.com/DharuNamikaze/gravity-lite)
