# gravity-lite

AI-powered CSS layout diagnostics. Zero-config MCP server for AI assistants.

[![npm version](https://img.shields.io/npm/v/gravity-lite.svg)](https://www.npmjs.com/package/gravity-lite)
[![license](https://img.shields.io/npm/l/gravity-lite.svg)](LICENSE)

Give your AI assistant (Kiro, Cursor, Claude, etc.) the ability to **see what actually renders** in your browser — not just read source code. Gravity bridges AI tools to live Chrome tabs via the Chrome DevTools Protocol.

## Install

```bash
npm install -g gravity-lite
```

**Requirements:** Node.js ≥ 16, Chrome ≥ 116

---

## Setup (one-time, ~2 minutes)

### 1. Add to your IDE MCP config

**Kiro** (`.kiro/settings/mcp.json`), **Cursor** (`~/.cursor/mcp.json`), or **Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "gravity": { "command": "gravity" }
  }
}
```

Restart your IDE. The MCP server starts automatically.

### 2. Load the Chrome extension

```
chrome://extensions  →  enable Developer Mode  →  Load unpacked
```

Point it at the `extension/` folder inside the package:

```bash
# Print the exact path to load
gravity doctor
```

### 3. Connect to a tab

Click the **Gravity** icon in Chrome → **Connect to Tab**.

Done. The extension connects to the MCP server automatically.

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

### Example prompts

```
diagnose the #header element
why is .modal behind everything — inspect stacking context
check accessibility of the .submit-btn
screenshot the #hero section
highlight .nav-bar for 5 seconds
debug the flex container .card-grid
```

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

**The key insight:** The extension connects *out* to the MCP server, not the other way around. No native messaging, no registry keys, no OS-specific setup. Works on Linux, macOS, and Windows.

---

## Commands

```bash
gravity           # start MCP server (called by IDE automatically)
gravity doctor    # check setup status and print extension path
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `GRAVITY_PORT` | `9224` | WebSocket bridge port |

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "Browser extension not connected" | Open Chrome, load the extension, click "Connect to Tab" |
| "Port 9224 already in use" | Set `GRAVITY_PORT=9225` in your MCP config |
| MCP server dot stays red in popup | Make sure `gravity` is running (check IDE MCP status) |
| "Element not found: #selector" | Verify the selector exists on the current page |
| Chrome ≥ 116 required | The offscreen documents API was added in Chrome 116 |
