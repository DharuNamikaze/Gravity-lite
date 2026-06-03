/**
 * mcp-server.ts — Gravity MCP Server v3
 *
 * Tools built around the top real-world UI debugging pain points:
 *   1. connect_browser        — check extension connection status
 *   2. diagnose_layout        — offscreen, hidden, overflow issues
 *   3. inspect_stacking       — z-index traps, stacking context analysis
 *   4. check_accessibility    — contrast ratio, touch targets, ARIA
 *   5. inspect_responsive     — fixed widths, breakpoint analysis
 *   6. debug_flexgrid         — flexbox/grid container + children analysis
 *   7. get_computed_layout    — full computed style snapshot
 *   8. highlight_element      — visual overlay in browser
 *   9. screenshot_element     — capture element as PNG
 *  10. get_page_performance   — layout paint metrics from Chrome
 *  11. capture_viewport       — full visible page screenshot (vision input)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { startBridge, sendCDP, isExtensionConnected, getBridgePort } from './bridge.js';
import {
  validateSelector, extractBounds, sortBySeverity,
  checkVisibility, checkOffscreen, checkOverflow,
  checkZIndex, checkStackingContextCreators,
  checkFlexGrid, checkResponsive,
  checkAccessibilityStyles, checkColorContrast, checkCustomProperties,
} from './diagnostics.js';

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'connect_browser',
    description: 'Check whether the Gravity Chrome extension is connected and ready. Call this first to verify setup.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'diagnose_layout',
    description: 'Full layout diagnosis for an element: detects overflow, offscreen positioning, hidden visibility, unresolved CSS variables, and responsive sizing issues. Best first tool to run on any broken element.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: "CSS selector, e.g. '#modal', '.nav-bar', 'button.primary'" },
      },
      required: ['selector'],
    },
  },
  {
    name: 'inspect_stacking',
    description: "Diagnose z-index and stacking context problems — the #1 CSS pain point. Reveals why 'z-index: 9999' still goes behind other elements, identifies which CSS properties trap elements in stacking contexts (transform, opacity, filter, etc.), and shows the full stacking context chain.",
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the element with layering issues' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'check_accessibility',
    description: 'Audit an element for accessibility issues: WCAG color contrast ratio (AA & AAA), touch target size (44×44px minimum), pointer-events blocking interaction, missing cursor feedback, and ARIA role from the accessibility tree.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'inspect_responsive',
    description: 'Analyze how an element behaves across screen sizes: detects fixed pixel widths that will break on mobile, elements wider than the viewport, and missing responsive patterns. Also reports current viewport size.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'debug_flexgrid',
    description: 'Deep inspection of flexbox and CSS Grid containers: shows all layout properties, analyzes each child element for overflow/shrink issues, detects collapsed containers, and flags common flex/grid pitfalls.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the flex or grid container' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'get_computed_layout',
    description: 'Get a complete snapshot of computed CSS properties for an element: box model, all layout-related styles, custom property values, and applied CSS rules with specificity.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'highlight_element',
    description: 'Visually highlight an element in the browser with color-coded overlays (content/padding/border/margin). Useful for confirming which element is being diagnosed.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector' },
        duration: { type: 'number', description: 'Highlight duration in ms (default: 3000, 0 = permanent until next call)' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'screenshot_element',
    description: 'Capture a screenshot of a specific element. Returns a base64-encoded PNG. Use to visually document bugs or verify fixes.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'get_page_performance',
    description: 'Get page-level layout and performance metrics: viewport dimensions, scroll position, total page size, layout paint timings, and a count of elements that may be causing layout thrashing.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'capture_viewport',
    description: 'Capture a screenshot of the full visible viewport — what the user actually sees right now. Returns a base64-encoded PNG. Complements computed-value tools: screenshots show what it looks like, computed values explain why. Note: image rendering as a vision input depends on your MCP client (Claude Desktop supports it; some IDEs return it as a base64 string).',
    inputSchema: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          enum: ['png', 'jpeg'],
          description: "Image format: 'png' (lossless, default) or 'jpeg' (smaller file size)",
        },
        quality: {
          type: 'number',
          description: 'JPEG quality 0–100 (only applies when format is jpeg, default: 80)',
        },
      },
    },
  },
];

// ── MCP server ────────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'gravity', version: '3.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {

    // ── connect_browser ───────────────────────────────────────────────────────
    if (name === 'connect_browser') {
      const connected = isExtensionConnected();
      return ok({
        status: connected ? 'connected' : 'waiting',
        port: getBridgePort(),
        message: connected
          ? 'Gravity extension is connected and ready.'
          : `Waiting for extension. Open Chrome → load the Gravity extension → click "Connect to Tab". Extension connects to ws://127.0.0.1:${getBridgePort()}.`,
      });
    }

    // ── shared helpers ────────────────────────────────────────────────────────

    async function resolveNode(selector: string) {
      const v = validateSelector(selector);
      if (!v.valid) throw new Error(`Invalid selector: ${v.error}`);
      const { root } = await cdp('DOM.getDocument', { depth: -1 }) as any;
      const { nodeId } = await cdp('DOM.querySelector', { nodeId: root.nodeId, selector }) as any;
      if (!nodeId) throw new Error(`Element not found: ${selector}`);
      return nodeId as number;
    }

    async function getStyles(nodeId: number) {
      const { computedStyle } = await cdp('CSS.getComputedStyleForNode', { nodeId }) as any;
      return new Map<string, string>((computedStyle as { name: string; value: string }[]).map(p => [p.name, p.value]));
    }

    // ── diagnose_layout ───────────────────────────────────────────────────────
    if (name === 'diagnose_layout') {
      const selector = args?.selector as string;
      if (!selector) throw new Error('selector is required');

      const nodeId = await resolveNode(selector);
      const { model }              = await cdp('DOM.getBoxModel', { nodeId }) as any;
      const { layoutViewport: vp } = await cdp('Page.getLayoutMetrics') as any;
      const styles                 = await getStyles(nodeId);
      const bounds                 = extractBounds(model);

      const issues = sortBySeverity([
        ...checkVisibility(styles),
        ...checkOffscreen(bounds, vp),
        ...checkOverflow(styles),
        ...checkCustomProperties(styles),
        ...checkResponsive(styles, bounds, vp),
      ]);

      return ok({
        element: selector,
        timestamp: new Date().toISOString(),
        position: bounds,
        viewport: { width: vp.clientWidth, height: vp.clientHeight },
        computedStyles: pick(styles, ['display','position','width','height','overflow','z-index','visibility','opacity','max-width','min-height']),
        issues: issues.length ? issues : [{ type: 'none', severity: 'low', message: 'No layout issues detected', suggestion: 'Element appears correctly positioned' }],
        summary: summarize(issues),
      });
    }

    // ── inspect_stacking ──────────────────────────────────────────────────────
    if (name === 'inspect_stacking') {
      const selector = args?.selector as string;
      if (!selector) throw new Error('selector is required');

      const nodeId = await resolveNode(selector);
      const styles  = await getStyles(nodeId);

      const zIssues = checkZIndex(styles);
      const { creates, reasons } = checkStackingContextCreators(styles);

      // Walk up ancestors to find stacking context creators
      const ancestors: { tag: string; creates: boolean; reasons: string[] }[] = [];
      try {
        const { node } = await cdp('DOM.describeNode', { nodeId, depth: 0 }) as any;
        let parentId = node.parentId;
        let depth = 0;
        while (parentId && depth < 10) {
          const { node: parent } = await cdp('DOM.describeNode', { nodeId: parentId, depth: 0 }) as any;
          if (!parent || parent.nodeType !== 1) break; // element nodes only
          const { computedStyle: ps } = await cdp('CSS.getComputedStyleForNode', { nodeId: parentId }) as any;
          const parentStyles = new Map<string, string>((ps as { name: string; value: string }[]).map(p => [p.name, p.value]));
          const sc = checkStackingContextCreators(parentStyles);
          if (sc.creates) {
            ancestors.push({ tag: parent.localName, creates: true, reasons: sc.reasons });
          }
          parentId = parent.parentId;
          depth++;
        }
      } catch {
        // Ancestor walk is best-effort
      }

      return ok({
        element: selector,
        zIndex: styles.get('z-index') ?? 'auto',
        position: styles.get('position') ?? 'static',
        createsStackingContext: creates,
        stackingContextReasons: reasons,
        issues: sortBySeverity(zIssues),
        ancestorsWithStackingContext: ancestors,
        explanation: ancestors.length > 0
          ? `This element is nested inside ${ancestors.length} stacking context(s). Even with a high z-index, it cannot appear above elements outside these contexts.`
          : 'No ancestor stacking contexts found. z-index should work normally relative to siblings.',
        tip: 'The most common cause of z-index not working: a parent has transform, opacity < 1, or filter applied — these create isolated stacking contexts.',
      });
    }

    // ── check_accessibility ───────────────────────────────────────────────────
    if (name === 'check_accessibility') {
      const selector = args?.selector as string;
      if (!selector) throw new Error('selector is required');

      const nodeId = await resolveNode(selector);
      const styles  = await getStyles(nodeId);
      const { model } = await cdp('DOM.getBoxModel', { nodeId }) as any;
      const bounds = extractBounds(model);

      const styleIssues = [
        ...checkAccessibilityStyles(styles),
        ...checkColorContrast(styles),
        ...checkResponsive(styles, bounds, { clientWidth: 375 }), // check against mobile viewport
      ].filter(i => i.type === 'small-touch-target' || i.type.startsWith('contrast') || i.type.startsWith('pointer') || i.type.startsWith('user-select') || i.type.startsWith('missing'));

      // Get ARIA info from accessibility tree
      let ariaInfo: Record<string, unknown> = {};
      try {
        await cdp('Accessibility.enable', {});
        const { nodes } = await cdp('Accessibility.queryAXTree', { nodeId, accessibleNameMaxLength: 200 }) as any;
        if (nodes?.length > 0) {
          const n = nodes[0];
          ariaInfo = {
            role:          n.role?.value,
            name:          n.name?.value,
            description:   n.description?.value,
            focusable:     n.focusable,
            ignored:       n.ignored,
            ignoredReasons: n.ignoredReasons?.map((r: any) => r.value),
          };
        }
      } catch {
        ariaInfo = { note: 'Accessibility tree not available for this element' };
      }

      // Color contrast detail
      const fg = styles.get('color');
      const bg = styles.get('background-color');
      const fontSize = parseFloat(styles.get('font-size') ?? '16');

      return ok({
        element: selector,
        size: { width: bounds.width, height: bounds.height },
        touchTargetOk: bounds.width >= 44 && bounds.height >= 44,
        colorContrast: fg && bg ? {
          foreground: fg,
          background: bg,
          fontSize: `${fontSize}px`,
        } : null,
        ariaInfo,
        issues: sortBySeverity(styleIssues),
        summary: summarize(styleIssues),
        wcagReference: 'https://www.w3.org/WAI/WCAG21/quickref/',
      });
    }

    // ── inspect_responsive ────────────────────────────────────────────────────
    if (name === 'inspect_responsive') {
      const selector = args?.selector as string;
      if (!selector) throw new Error('selector is required');

      const nodeId = await resolveNode(selector);
      const styles  = await getStyles(nodeId);
      const { model }              = await cdp('DOM.getBoxModel', { nodeId }) as any;
      const { layoutViewport: vp } = await cdp('Page.getLayoutMetrics') as any;
      const bounds = extractBounds(model);

      const issues = sortBySeverity(checkResponsive(styles, bounds, vp));

      const widthPercent = vp.clientWidth > 0 ? Math.round((bounds.width / vp.clientWidth) * 100) : 0;

      return ok({
        element: selector,
        viewport: { width: vp.clientWidth, height: vp.clientHeight },
        elementSize: { width: bounds.width, height: bounds.height },
        widthVsViewport: `${widthPercent}%`,
        cssWidth: styles.get('width'),
        cssMaxWidth: styles.get('max-width'),
        cssMinWidth: styles.get('min-width'),
        mediaQueriesNote: 'Gravity reads computed styles — media queries are already applied for the current viewport size',
        issues: issues.length ? issues : [{ type: 'none', severity: 'low', message: 'No responsive issues detected at current viewport size', suggestion: 'Resize the browser window and run again to test other breakpoints' }],
        summary: summarize(issues),
      });
    }

    // ── debug_flexgrid ────────────────────────────────────────────────────────
    if (name === 'debug_flexgrid') {
      const selector = args?.selector as string;
      if (!selector) throw new Error('selector is required');

      const nodeId = await resolveNode(selector);
      const styles  = await getStyles(nodeId);
      const { model } = await cdp('DOM.getBoxModel', { nodeId }) as any;
      const bounds = extractBounds(model);

      const display = styles.get('display') ?? 'block';
      const isFlexOrGrid = display.includes('flex') || display.includes('grid');

      const containerIssues = sortBySeverity(checkFlexGrid(styles));

      // Get children and analyze each one
      const children: any[] = [];
      try {
        const { node } = await cdp('DOM.describeNode', { nodeId, depth: 1 }) as any;
        const childNodes = (node.children ?? []).filter((c: any) => c.nodeType === 1).slice(0, 10); // first 10 children
        for (const child of childNodes) {
          const { computedStyle: cs } = await cdp('CSS.getComputedStyleForNode', { nodeId: child.nodeId }) as any;
          const childStyles = new Map<string, string>((cs as any[]).map(p => [p.name, p.value]));
          const { model: cm } = await cdp('DOM.getBoxModel', { nodeId: child.nodeId }) as any;
          const childBounds = extractBounds(cm);
          const { layoutViewport: vp } = await cdp('Page.getLayoutMetrics') as any;

          children.push({
            tag: child.localName,
            size: { width: childBounds.width, height: childBounds.height },
            flexShrink: childStyles.get('flex-shrink'),
            flexGrow:   childStyles.get('flex-grow'),
            flexBasis:  childStyles.get('flex-basis'),
            minWidth:   childStyles.get('min-width'),
            overflow:   childStyles.get('overflow'),
            overflowing: childBounds.right > bounds.right + 2,
          });
        }
      } catch {
        // Child analysis best-effort
      }

      return ok({
        element: selector,
        display,
        isFlexOrGrid,
        containerSize: { width: bounds.width, height: bounds.height },
        containerProperties: isFlexOrGrid ? pick(styles, [
          'display','flex-direction','flex-wrap','justify-content','align-items',
          'align-content','gap','row-gap','column-gap',
          'grid-template-columns','grid-template-rows','grid-auto-flow',
        ]) : pick(styles, ['display','width','height','overflow']),
        children: children.length > 0 ? children : 'No child elements found (or selector is not a container)',
        issues: containerIssues,
        summary: summarize(containerIssues),
        tip: display.includes('flex')
          ? 'Common flex issues: min-width: auto on children causes overflow; align-items: stretch needs explicit height on container'
          : display.includes('grid')
          ? 'Common grid issues: no grid-template-columns defined; grid items escaping with absolute positioning'
          : 'Element is not a flex or grid container. Switch display to flex or grid to use this tool effectively.',
      });
    }

    // ── get_computed_layout ───────────────────────────────────────────────────
    if (name === 'get_computed_layout') {
      const selector = args?.selector as string;
      if (!selector) throw new Error('selector is required');

      const nodeId = await resolveNode(selector);
      const styles  = await getStyles(nodeId);
      const { model } = await cdp('DOM.getBoxModel', { nodeId }) as any;

      // Get applied CSS rules with selectors (for specificity debugging)
      let appliedRules: any[] = [];
      try {
        const { matchedCSSRules } = await cdp('CSS.getMatchedStylesForNode', { nodeId }) as any;
        appliedRules = (matchedCSSRules ?? []).slice(0, 5).map((r: any) => ({
          selector: r.rule?.selectorList?.text,
          origin: r.rule?.origin,
          styleText: r.rule?.style?.cssText?.slice(0, 200),
        }));
      } catch { /* best-effort */ }

      return ok({
        selector,
        boxModel: {
          content: { width: model.width, height: model.height },
          padding: `${model.width - model.content[2] + model.content[0]}px`,
        },
        layout: pick(styles, [
          'display','position','top','right','bottom','left',
          'width','height','max-width','min-width','max-height','min-height',
          'margin','padding','box-sizing',
        ]),
        flex: pick(styles, ['flex-direction','flex-wrap','justify-content','align-items','flex-grow','flex-shrink','flex-basis']),
        grid: pick(styles, ['grid-template-columns','grid-template-rows','grid-column','grid-row','gap']),
        visual: pick(styles, ['overflow','z-index','opacity','visibility','transform','filter','pointer-events']),
        typography: pick(styles, ['font-size','font-weight','line-height','color','background-color']),
        appliedRules: appliedRules.length > 0 ? appliedRules : 'Run from an active tab with CSS loaded',
      });
    }

    // ── highlight_element ─────────────────────────────────────────────────────
    if (name === 'highlight_element') {
      const selector = args?.selector as string;
      const duration = (args?.duration as number) ?? 3000;
      if (!selector) throw new Error('selector is required');

      const nodeId = await resolveNode(selector);
      await cdp('DOM.highlightNode', {
        nodeId,
        highlightConfig: {
          showInfo:     true,
          showRulers:   true,
          contentColor: { r: 111, g: 168, b: 220, a: 0.66 },
          paddingColor: { r: 147, g: 196, b: 125, a: 0.55 },
          borderColor:  { r: 255, g: 229, b: 153, a: 0.66 },
          marginColor:  { r: 246, g: 178, b: 107, a: 0.66 },
        },
      });

      if (duration > 0) setTimeout(() => cdp('DOM.hideHighlight', {}).catch(() => {}), duration);

      return ok({ success: true, selector, duration, message: `Element highlighted in browser for ${duration}ms` });
    }

    // ── screenshot_element ────────────────────────────────────────────────────
    if (name === 'screenshot_element') {
      const selector = args?.selector as string;
      if (!selector) throw new Error('selector is required');

      const nodeId = await resolveNode(selector);
      const { model } = await cdp('DOM.getBoxModel', { nodeId }) as any;
      const clip = { x: model.content[0], y: model.content[1], width: model.width, height: model.height, scale: 1 };
      const { data } = await cdp('Page.captureScreenshot', { clip, format: 'png' }) as any;

      return ok({ selector, screenshot: `data:image/png;base64,${data}`, bounds: clip });
    }

    // ── get_page_performance ──────────────────────────────────────────────────
    if (name === 'get_page_performance') {
      const { layoutViewport, contentSize } = await cdp('Page.getLayoutMetrics') as any;

      // Count potentially layout-thrashing elements (those with position:fixed/absolute, transform, etc.)
      let heavyElements = 0;
      try {
        const { root } = await cdp('DOM.getDocument', { depth: 1 }) as any;
        const result = await cdp('Runtime.evaluate', {
          expression: `(() => {
            const all = document.querySelectorAll('*');
            let heavy = 0;
            for (const el of all) {
              const s = getComputedStyle(el);
              if (s.transform !== 'none' || s.filter !== 'none' || s.willChange !== 'auto' || s.position === 'fixed') heavy++;
            }
            return heavy;
          })()`,
          returnByValue: true,
        }) as any;
        heavyElements = result?.result?.value ?? 0;
      } catch { /* best-effort */ }

      // Get paint metrics
      let paintMetrics: any[] = [];
      try {
        const { metrics } = await cdp('Performance.getMetrics') as any;
        paintMetrics = (metrics ?? []).filter((m: any) =>
          ['LayoutDuration','RecalcStyleDuration','FirstMeaningfulPaint','DOMContentLoaded'].includes(m.name)
        );
      } catch { /* best-effort */ }

      return ok({
        viewport: { width: layoutViewport.clientWidth, height: layoutViewport.clientHeight },
        pageSize: { width: contentSize.width, height: contentSize.height },
        scrollable: contentSize.height > layoutViewport.clientHeight,
        scrollRatio: contentSize.height > 0 ? `${Math.round((contentSize.height / layoutViewport.clientHeight) * 100)}%` : '100%',
        elementsWithHeavyCSSProperties: heavyElements,
        performanceMetrics: paintMetrics,
        tip: heavyElements > 50
          ? `${heavyElements} elements use transform/filter/will-change/fixed positioning — this can cause paint thrashing on scroll. Review with Chrome DevTools Layers panel.`
          : 'Page appears lightweight from a CSS performance perspective.',
      });
    }

    // ── capture_viewport ──────────────────────────────────────────────────────
    if (name === 'capture_viewport') {
      const format  = (args?.format as 'png' | 'jpeg') ?? 'png';
      const quality = (args?.quality as number) ?? 80;

      const { layoutViewport } = await cdp('Page.getLayoutMetrics') as any;
      const { data } = await cdp('Page.captureScreenshot', {
        format,
        ...(format === 'jpeg' ? { quality } : {}),
        clip: {
          x:      0,
          y:      0,
          width:  layoutViewport.clientWidth,
          height: layoutViewport.clientHeight,
          scale:  1,
        },
        captureBeyondViewport: false,
      }) as any;

      return {
        content: [
          {
            type: 'image' as const,
            data,
            mimeType: format === 'jpeg' ? 'image/jpeg' : 'image/png',
          },
          {
            type: 'text' as const,
            text: JSON.stringify({
              viewport: {
                width:  layoutViewport.clientWidth,
                height: layoutViewport.clientHeight,
              },
              format,
              note: 'This is the full visible viewport. Use screenshot_element to capture a specific element.',
            }, null, 2),
          },
        ],
      };
    }

    throw new Error(`Unknown tool: ${name}`);

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: msg, tool: name, timestamp: new Date().toISOString() }, null, 2) }],
      isError: true,
    };
  }
});

// ── Utility helpers ───────────────────────────────────────────────────────────

async function cdp(method: string, params: Record<string, unknown> = {}) {
  return sendCDP(method, params);
}

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function pick(styles: Map<string, string>, keys: string[]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const k of keys) out[k] = styles.get(k);
  return out;
}

function summarize(issues: { severity: string }[]) {
  return {
    total:  issues.length,
    high:   issues.filter(i => i.severity === 'high').length,
    medium: issues.filter(i => i.severity === 'medium').length,
    low:    issues.filter(i => i.severity === 'low').length,
  };
}

// ── GravityMCPServer ──────────────────────────────────────────────────────────

export class GravityMCPServer {
  async run(): Promise<void> {
    await startBridge();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('[gravity] MCP server ready — 11 tools loaded');
    process.on('SIGINT',  () => process.exit(0));
    process.on('SIGTERM', () => process.exit(0));
  }
}
