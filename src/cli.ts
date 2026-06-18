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
    const net = await import('net');
    const port = process.env.GRAVITY_PORT ? Number(process.env.GRAVITY_PORT) : 9224;

    console.log('\nGravity v' + pkg.version + ' — setup check');
    console.log('─'.repeat(40));

    // Node version — robust parse of "v16.5.0"
    const nodeVersionMatch = process.version.match(/^v(\d+)/);
    const nodeMajor = nodeVersionMatch ? parseInt(nodeVersionMatch[1], 10) : 0;
    const nodeOk = nodeMajor >= 16;
    console.log(`${nodeOk ? '✓' : '✗'} Node.js ${process.version}${nodeOk ? '' : ' (need ≥16)'}`);

    // Extension folder
    const extDir = resolve(__dirname, '..', 'extension');
    const extOk = existsSync(resolve(extDir, 'manifest.json'));
    console.log(`${extOk ? '✓' : '✗'} Extension folder: ${extDir}`);
    if (!extOk) console.log('  ↳ Run: npm install -g gravity-lite');

    // Port availability. IMPORTANT: we do NOT open a WebSocket to probe —
    // opening a real WS would be treated by the bridge as a new extension
    // connection and would kick the real extension's socket off (the bridge
    // only allows one client). Instead we do a raw TCP connect+close, which
    // only tells us whether *something* is listening, without touching the
    // WS handshake.
    const inUse = await isPortInUse(net, port);
    if (inUse) {
      console.log(`✓ Port ${port} is in use (MCP server likely running)`);
    } else {
      console.log(`✗ Port ${port} is free — MCP server is NOT running`);
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

/** TCP-only probe: returns true if something is listening on `port`. */
function isPortInUse(net: typeof import('net'), port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once('error', () => resolve(true));   // EADDRINUSE → something is there
    tester.once('listening', () => {
      tester.close(() => resolve(false));        // free
    });
    tester.listen(port, '127.0.0.1');
  });
}

// ── default: run MCP server ───────────────────────────────────────────────────

program.action(async () => {
  // If the dist build is missing (e.g. cloned from git without `npm run
  // build`), fail with a clear message instead of an obscure import error.
  const distCli = resolve(__dirname, 'cli.js');
  if (!existsSync(distCli)) {
    console.error('[gravity] dist/ not found. Run `npm run build` first.');
    process.exit(1);
  }

  const { GravityMCPServer } = await import('./mcp-server.js');
  const srv = new GravityMCPServer();
  // Catch bridge errors (port in use, etc.) cleanly instead of becoming an
  // unhandled promise rejection.
  try {
    await srv.run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[gravity] failed to start: ${msg}`);
    process.exit(1);
  }
});

program.parse();
