#!/usr/bin/env node
/**
 * cli.ts — Gravity v3 CLI entry point
 *
 * Commands:
 *   gravity          — start the MCP server (default)
 *   gravity doctor   — check setup status
 */

import { program } from 'commander';
import { createRequire } from 'module';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

program
  .name('gravity')
  .description('AI-powered CSS layout diagnostics — MCP server')
  .version(pkg.version);

// ── doctor ────────────────────────────────────────────────────────────────────

program
  .command('doctor')
  .description('Check setup status and print instructions')
  .action(async () => {
    const { default: WebSocket } = await import('ws');
    const port = process.env.GRAVITY_PORT ? Number(process.env.GRAVITY_PORT) : 9224;

    console.log('\nGravity v' + pkg.version + ' — setup check');
    console.log('─'.repeat(40));

    // Node version
    const nodeOk = parseInt(process.version.slice(1)) >= 16;
    console.log(`${nodeOk ? '✓' : '✗'} Node.js ${process.version}${nodeOk ? '' : ' (need ≥16)'}`);

    // Extension folder
    const extDir = resolve(__dirname, '..', 'extension');
    const extOk = existsSync(resolve(extDir, 'manifest.json'));
    console.log(`${extOk ? '✓' : '✗'} Extension folder: ${extDir}`);
    if (!extOk) console.log('  ↳ Run: npm install -g gravity-lite');

    // Port availability / existing server
    try {
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}`);
        const t = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 2000);
        ws.on('open',  () => { clearTimeout(t); ws.close(); resolve(); });
        ws.on('error', (e) => { clearTimeout(t); reject(e); });
      });
      console.log(`✓ MCP server is running on port ${port}`);
    } catch {
      console.log(`✗ MCP server not running on port ${port}`);
      console.log('  ↳ Add gravity to your IDE MCP config and restart');
    }

    console.log('─'.repeat(40));
    console.log('\nExtension setup (one-time):');
    console.log(`  1. Open chrome://extensions  →  enable Developer Mode`);
    console.log(`  2. "Load unpacked"  →  select: ${extDir}`);
    console.log(`  3. Click the Gravity icon  →  "Connect to Tab"`);
    console.log('\nMCP config (add to your IDE):');
    console.log(JSON.stringify({
      mcpServers: {
        gravity: { command: 'gravity' }
      }
    }, null, 2));
    console.log();
  });

// ── default: run MCP server ───────────────────────────────────────────────────

program.action(async () => {
  const { GravityMCPServer } = await import('./mcp-server.js');
  const srv = new GravityMCPServer();
  await srv.run();
});

program.parse();
