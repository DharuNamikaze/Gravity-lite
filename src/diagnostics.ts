/**
 * diagnostics.ts — CSS layout & accessibility analysis helpers.
 * Pure functions — no I/O, no side effects.
 */

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface Issue {
  type: string;
  severity: 'high' | 'medium' | 'low';
  message: string;
  suggestion: string;
}

export interface RGB { r: number; g: number; b: number; }

// ── Box model helpers ─────────────────────────────────────────────────────────

/**
 * Extract the BORDER-box bounds (what the user actually sees) from a CDP
 * BoxModel. Chrome's BoxModel exposes four quads — border, padding, content,
 * margin — each as 8 numbers [x1,y1, x2,y2, x3,y3, x4,y4] going clockwise
 * from the top-left. We use the `border` quad for the rendered size because
 * WCAG touch-target and offscreen checks should account for padding+border.
 *
 * `model.width` / `model.height` are the *content* size, which is kept
 * available for callers that need it (e.g. screenshot clipping).
 */
export function extractBounds(model: {
  content?: number[];
  border?: number[];
  width?: number;
  height?: number;
}): Bounds {
  const quad = model.border && model.border.length === 8
    ? model.border
    : (model.content && model.content.length === 8 ? model.content : []);

  if (quad.length === 8) {
    const xs = [quad[0], quad[2], quad[4], quad[6]];
    const ys = [quad[1], quad[3], quad[5], quad[7]];
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);
    return {
      left: Math.round(left),
      top: Math.round(top),
      right: Math.round(right),
      bottom: Math.round(bottom),
      width: Math.round(right - left),
      height: Math.round(bottom - top),
    };
  }

  // Last-resort fallback for unusual payloads
  const c = model.content ?? [];
  return {
    left: Math.round(Math.min(c[0] ?? 0, c[6] ?? 0)),
    top: Math.round(Math.min(c[1] ?? 0, c[3] ?? 0)),
    right: Math.round(Math.max(c[2] ?? 0, c[4] ?? 0)),
    bottom: Math.round(Math.max(c[5] ?? 0, c[7] ?? 0)),
    width: Math.round(model.width ?? 0),
    height: Math.round(model.height ?? 0),
  };
}

/** Border-box bounds (touch target / offscreen). Alias of extractBounds. */
export function borderBoxBounds(model: Parameters<typeof extractBounds>[0]): Bounds {
  return extractBounds(model);
}

/**
 * Compute the four box-model paddings (top/right/bottom/left) in px from a
 * CDP BoxModel. Uses the geometry of the border and content quads rather than
 * mashing unrelated coordinates together.
 */
export function extractPadding(model: {
  border?: number[];
  content?: number[];
}): { top: number; right: number; bottom: number; left: number } {
  const b = model.border;
  const c = model.content;
  if (!b || b.length !== 8 || !c || c.length !== 8) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
  // Both quads are clockwise from top-left:
  //   [0,1]=TL  [2,3]=TR  [4,5]=BR  [6,7]=BL
  return {
    top:    Math.round(c[1] - b[1]),
    right:  Math.round(b[2] - c[2]),
    bottom: Math.round(b[5] - c[5]),
    left:   Math.round(c[0] - b[0]),
  };
}

// ── Layout checks ─────────────────────────────────────────────────────────────

export function checkVisibility(styles: Map<string, string>): Issue[] {
  const issues: Issue[] = [];
  if (styles.get('display') === 'none')
    issues.push({ type: 'hidden-display', severity: 'high', message: 'Element has display: none', suggestion: 'Remove display: none to make visible' });
  if (styles.get('visibility') === 'hidden')
    issues.push({ type: 'hidden-visibility', severity: 'high', message: 'Element has visibility: hidden', suggestion: 'Change to visibility: visible' });
  if (parseFloat(styles.get('opacity') ?? '1') === 0)
    issues.push({ type: 'hidden-opacity', severity: 'high', message: 'Element has opacity: 0', suggestion: 'Change to opacity: 1' });
  return issues;
}

export function checkOffscreen(bounds: Bounds, vp: { clientWidth: number; clientHeight: number }): Issue[] {
  const issues: Issue[] = [];
  const T = 2;
  if (bounds.right  > vp.clientWidth  + T) issues.push({ type: 'offscreen-right',  severity: 'high',   message: `Element extends ${Math.round(bounds.right - vp.clientWidth)}px beyond right edge`,    suggestion: 'Add max-width: 100% or overflow: hidden to parent' });
  if (bounds.left   < -T)                  issues.push({ type: 'offscreen-left',   severity: 'high',   message: `Element starts ${Math.abs(Math.round(bounds.left))}px left of viewport`,               suggestion: 'Check left/margin-left values' });
  if (bounds.top    < -T)                  issues.push({ type: 'offscreen-top',    severity: 'high',   message: `Element starts ${Math.abs(Math.round(bounds.top))}px above viewport`,                  suggestion: 'Check top/margin-top values' });
  if (bounds.bottom > vp.clientHeight + T) issues.push({ type: 'offscreen-bottom', severity: 'medium', message: `Element extends ${Math.round(bounds.bottom - vp.clientHeight)}px below viewport fold`,  suggestion: 'Add max-height or overflow: auto' });
  return issues;
}

export function checkOverflow(styles: Map<string, string>): Issue[] {
  const issues: Issue[] = [];
  if (styles.get('overflow') === 'hidden')
    issues.push({ type: 'overflow-hidden', severity: 'low', message: 'overflow: hidden may clip child content', suggestion: 'Change to overflow: auto if content is being clipped' });
  return issues;
}

// ── z-index / stacking context checks ────────────────────────────────────────

export function checkZIndex(styles: Map<string, string>): Issue[] {
  const issues: Issue[] = [];
  const zRaw = styles.get('z-index') ?? 'auto';
  const position = styles.get('position') ?? 'static';
  const zNum = parseInt(zRaw, 10);

  // z-index has no effect on static elements
  if (!isNaN(zNum) && position === 'static') {
    issues.push({
      type: 'zindex-no-effect',
      severity: 'high',
      message: `z-index: ${zNum} has no effect — element has position: static`,
      suggestion: 'Add position: relative (or absolute/fixed/sticky) for z-index to take effect',
    });
  }

  // Suspiciously high z-index — usually a sign of a stacking context war
  if (!isNaN(zNum) && zNum >= 9999) {
    issues.push({
      type: 'zindex-magic-number',
      severity: 'medium',
      message: `z-index: ${zNum} is a magic number — element may still be trapped in a stacking context`,
      suggestion: 'Check parent elements for: transform, opacity < 1, filter, isolation: isolate, will-change — these create stacking contexts that trap z-index',
    });
  }

  return issues;
}

// ── Properties that create stacking contexts ──────────────────────────────────

export function checkStackingContextCreators(styles: Map<string, string>): {
  creates: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  const position = styles.get('position') ?? 'static';
  const zIndex = styles.get('z-index') ?? 'auto';
  const opacity = parseFloat(styles.get('opacity') ?? '1');
  const transform = styles.get('transform') ?? 'none';
  const filter = styles.get('filter') ?? 'none';
  const isolation = styles.get('isolation') ?? 'auto';
  const mixBlend = styles.get('mix-blend-mode') ?? 'normal';
  const willChange = styles.get('will-change') ?? 'auto';
  const contain = styles.get('contain') ?? 'none';

  if (['absolute', 'relative', 'fixed', 'sticky'].includes(position) && zIndex !== 'auto')
    reasons.push(`position: ${position} + z-index: ${zIndex}`);
  if (opacity < 1) reasons.push(`opacity: ${opacity}`);
  if (transform !== 'none') reasons.push(`transform: ${transform}`);
  if (filter !== 'none') reasons.push(`filter: ${filter}`);
  if (isolation === 'isolate') reasons.push('isolation: isolate');
  if (mixBlend !== 'normal') reasons.push(`mix-blend-mode: ${mixBlend}`);
  if (willChange.includes('transform') || willChange.includes('opacity')) reasons.push(`will-change: ${willChange}`);
  if (contain !== 'none' && contain !== '') reasons.push(`contain: ${contain}`);

  return { creates: reasons.length > 0, reasons };
}

// ── Flexbox/Grid checks ───────────────────────────────────────────────────────

export function checkFlexGrid(styles: Map<string, string>): Issue[] {
  const issues: Issue[] = [];
  const display = styles.get('display') ?? '';

  if (display === 'flex' || display === 'inline-flex') {
    const minWidth = styles.get('min-width') ?? 'auto';
    // flex children with no min-width: 0 can overflow their container
    if (minWidth === 'auto') {
      const overflow = styles.get('overflow') ?? 'visible';
      if (overflow === 'visible') {
        issues.push({
          type: 'flex-min-width',
          severity: 'low',
          message: 'Flex container children default to min-width: auto which can cause overflow',
          suggestion: 'Add min-width: 0 to flex children that should shrink below their content size',
        });
      }
    }

    const height = styles.get('height') ?? 'auto';
    const alignItems = styles.get('align-items') ?? 'stretch';
    if (height === '0px' || height === '0') {
      issues.push({
        type: 'flex-zero-height',
        severity: 'high',
        message: 'Flex container has height: 0 — children may be invisible',
        suggestion: 'Set an explicit height, min-height, or ensure a parent provides height',
      });
    }

    if (alignItems === 'stretch') {
      const explicitHeight = styles.get('height');
      if (!explicitHeight || explicitHeight === 'auto') {
        issues.push({
          type: 'flex-stretch-no-height',
          severity: 'low',
          message: 'align-items: stretch (default) with no explicit height — container height depends on content',
          suggestion: 'Set an explicit height on the flex container if you need consistent item sizing',
        });
      }
    }
  }

  if (display === 'grid' || display === 'inline-grid') {
    const gridTemplateColumns = styles.get('grid-template-columns') ?? '';
    const gridTemplateRows = styles.get('grid-template-rows') ?? '';
    if (!gridTemplateColumns && !gridTemplateRows) {
      issues.push({
        type: 'grid-no-template',
        severity: 'medium',
        message: 'Grid container has no grid-template-columns or grid-template-rows defined',
        suggestion: 'Define grid-template-columns (e.g. repeat(3, 1fr)) to create a proper grid layout',
      });
    }
  }

  return issues;
}

// ── Responsive / sizing checks ────────────────────────────────────────────────

export function checkResponsive(styles: Map<string, string>, bounds: Bounds, vp: { clientWidth: number }): Issue[] {
  const issues: Issue[] = [];
  const width = styles.get('width') ?? '';

  // Fixed pixel width on an element that is nearly as wide as the viewport
  const pxMatch = width.match(/^(\d+(?:\.\d+)?)px$/);
  if (pxMatch && bounds.width > vp.clientWidth * 0.85) {
    issues.push({
      type: 'fixed-width-large',
      severity: 'medium',
      message: `Fixed width of ${width} is ${Math.round((bounds.width / vp.clientWidth) * 100)}% of viewport — will break on smaller screens`,
      suggestion: 'Use max-width instead of width, or switch to a relative unit like % or vw',
    });
  }

  // Very small touch target (uses border-box bounds, see WCAG 2.5.5)
  if (bounds.width > 0 && bounds.height > 0 && (bounds.width < 44 || bounds.height < 44)) {
    issues.push({
      type: 'small-touch-target',
      severity: 'medium',
      message: `Element is ${bounds.width}×${bounds.height}px — below the 44×44px minimum touch target size (WCAG 2.5.5)`,
      suggestion: 'Increase padding or min-width/min-height to at least 44px for touch accessibility',
    });
  }

  return issues;
}

// ── Accessibility checks (from computed styles) ───────────────────────────────

export function checkAccessibilityStyles(styles: Map<string, string>, tagName?: string): Issue[] {
  const issues: Issue[] = [];

  // pointer-events: none makes elements unclickable
  if (styles.get('pointer-events') === 'none') {
    issues.push({
      type: 'pointer-events-none',
      severity: 'medium',
      message: 'pointer-events: none — element is not clickable/interactive',
      suggestion: 'Remove pointer-events: none if the element should be interactive',
    });
  }

  // user-select: none on interactive elements
  if (styles.get('user-select') === 'none' || styles.get('-webkit-user-select') === 'none') {
    issues.push({
      type: 'user-select-none',
      severity: 'low',
      message: 'user-select: none prevents text selection — may frustrate users trying to copy content',
      suggestion: 'Remove user-select: none from text content; keep it only on UI controls like buttons',
    });
  }

  // cursor: default on something that looks interactive.
  // Only flag elements that are genuinely interactive (button/a/[role=button])
  // — computed styles alone can't tell, so we require a tagName hint.
  const cursor = styles.get('cursor') ?? '';
  if (cursor === 'default') {
    const interactiveTag = tagName && /^(a|button|summary|label)$/i.test(tagName);
    if (interactiveTag) {
      issues.push({
        type: 'missing-pointer-cursor',
        severity: 'low',
        message: `Interactive <${tagName}> element has cursor: default`,
        suggestion: "Add cursor: pointer to indicate the element is interactive",
      });
    }
  }

  return issues;
}

// ── Color parsing & contrast ──────────────────────────────────────────────────

// CSS named colors → { r, g, b }. Covers the full CSS3 named-color list.
const NAMED_COLORS: Record<string, RGB> = {
  aliceblue: { r: 240, g: 248, b: 255 }, antiquewhite: { r: 250, g: 235, b: 215 },
  aqua: { r: 0, g: 255, b: 255 }, aquamarine: { r: 127, g: 255, b: 212 },
  azure: { r: 240, g: 255, b: 255 }, beige: { r: 245, g: 245, b: 220 },
  bisque: { r: 255, g: 228, b: 196 }, black: { r: 0, g: 0, b: 0 },
  blanchedalmond: { r: 255, g: 235, b: 205 }, blue: { r: 0, g: 0, b: 255 },
  blueviolet: { r: 138, g: 43, b: 226 }, brown: { r: 165, g: 42, b: 42 },
  burlywood: { r: 222, g: 184, b: 135 }, cadetblue: { r: 95, g: 158, b: 160 },
  chartreuse: { r: 127, g: 255, b: 0 }, chocolate: { r: 210, g: 105, b: 30 },
  coral: { r: 255, g: 127, b: 80 }, cornflowerblue: { r: 100, g: 149, b: 237 },
  cornsilk: { r: 255, g: 248, b: 220 }, crimson: { r: 220, g: 20, b: 60 },
  cyan: { r: 0, g: 255, b: 255 }, darkblue: { r: 0, g: 0, b: 139 },
  darkcyan: { r: 0, g: 139, b: 139 }, darkgoldenrod: { r: 184, g: 134, b: 11 },
  darkgray: { r: 169, g: 169, b: 169 }, darkgreen: { r: 0, g: 100, b: 0 },
  darkgrey: { r: 169, g: 169, b: 169 }, darkkhaki: { r: 189, g: 183, b: 107 },
  darkmagenta: { r: 139, g: 0, b: 139 }, darkolivegreen: { r: 85, g: 107, b: 47 },
  darkorange: { r: 255, g: 140, b: 0 }, darkorchid: { r: 153, g: 50, b: 204 },
  darkred: { r: 139, g: 0, b: 0 }, darksalmon: { r: 233, g: 150, b: 122 },
  darkseagreen: { r: 143, g: 188, b: 143 }, darkslateblue: { r: 72, g: 61, b: 139 },
  darkslategray: { r: 47, g: 79, b: 79 }, darkslategrey: { r: 47, g: 79, b: 79 },
  darkturquoise: { r: 0, g: 206, b: 209 }, darkviolet: { r: 148, g: 0, b: 211 },
  deeppink: { r: 255, g: 20, b: 147 }, deepskyblue: { r: 0, g: 191, b: 255 },
  dimgray: { r: 105, g: 105, b: 105 }, dimgrey: { r: 105, g: 105, b: 105 },
  dodgerblue: { r: 30, g: 144, b: 255 }, firebrick: { r: 178, g: 34, b: 34 },
  floralwhite: { r: 255, g: 250, b: 240 }, forestgreen: { r: 34, g: 139, b: 34 },
  fuchsia: { r: 255, g: 0, b: 255 }, gainsboro: { r: 220, g: 220, b: 220 },
  ghostwhite: { r: 248, g: 248, b: 255 }, gold: { r: 255, g: 215, b: 0 },
  goldenrod: { r: 218, g: 165, b: 32 }, gray: { r: 128, g: 128, b: 128 },
  green: { r: 0, g: 128, b: 0 }, greenyellow: { r: 173, g: 255, b: 47 },
  grey: { r: 128, g: 128, b: 128 }, honeydew: { r: 240, g: 255, b: 240 },
  hotpink: { r: 255, g: 105, b: 180 }, indianred: { r: 205, g: 92, b: 92 },
  indigo: { r: 75, g: 0, b: 130 }, ivory: { r: 255, g: 255, b: 240 },
  khaki: { r: 240, g: 230, b: 140 }, lavender: { r: 230, g: 230, b: 250 },
  lavenderblush: { r: 255, g: 240, b: 245 }, lawngreen: { r: 124, g: 252, b: 0 },
  lemonchiffon: { r: 255, g: 250, b: 205 }, lightblue: { r: 173, g: 216, b: 230 },
  lightcoral: { r: 240, g: 128, b: 128 }, lightcyan: { r: 224, g: 255, b: 255 },
  lightgoldenrodyellow: { r: 250, g: 250, b: 210 }, lightgray: { r: 211, g: 211, b: 211 },
  lightgreen: { r: 144, g: 238, b: 144 }, lightgrey: { r: 211, g: 211, b: 211 },
  lightpink: { r: 255, g: 182, b: 193 }, lightsalmon: { r: 255, g: 160, b: 122 },
  lightseagreen: { r: 32, g: 178, b: 170 }, lightskyblue: { r: 135, g: 206, b: 250 },
  lightslategray: { r: 119, g: 136, b: 153 }, lightslategrey: { r: 119, g: 136, b: 153 },
  lightsteelblue: { r: 176, g: 196, b: 222 }, lightyellow: { r: 255, g: 255, b: 224 },
  lime: { r: 0, g: 255, b: 0 }, limegreen: { r: 50, g: 205, b: 50 },
  linen: { r: 250, g: 240, b: 230 }, magenta: { r: 255, g: 0, b: 255 },
  maroon: { r: 128, g: 0, b: 0 }, mediumaquamarine: { r: 102, g: 205, b: 170 },
  mediumblue: { r: 0, g: 0, b: 205 }, mediumorchid: { r: 186, g: 85, b: 211 },
  mediumpurple: { r: 147, g: 112, b: 219 }, mediumseagreen: { r: 60, g: 179, b: 113 },
  mediumslateblue: { r: 123, g: 104, b: 238 }, mediumspringgreen: { r: 0, g: 250, b: 154 },
  mediumturquoise: { r: 72, g: 209, b: 204 }, mediumvioletred: { r: 199, g: 21, b: 133 },
  midnightblue: { r: 25, g: 25, b: 112 }, mintcream: { r: 245, g: 255, b: 250 },
  mistyrose: { r: 255, g: 228, b: 225 }, moccasin: { r: 255, g: 228, b: 181 },
  navajowhite: { r: 255, g: 222, b: 173 }, navy: { r: 0, g: 0, b: 128 },
  oldlace: { r: 253, g: 245, b: 230 }, olive: { r: 128, g: 128, b: 0 },
  olivedrab: { r: 107, g: 142, b: 35 }, orange: { r: 255, g: 165, b: 0 },
  orangered: { r: 255, g: 69, b: 0 }, orchid: { r: 218, g: 112, b: 214 },
  palegoldenrod: { r: 238, g: 232, b: 170 }, palegreen: { r: 152, g: 251, b: 152 },
  paleturquoise: { r: 175, g: 238, b: 238 }, palevioletred: { r: 219, g: 112, b: 147 },
  papayawhip: { r: 255, g: 239, b: 213 }, peachpuff: { r: 255, g: 218, b: 185 },
  peru: { r: 205, g: 133, b: 63 }, pink: { r: 255, g: 192, b: 203 },
  plum: { r: 221, g: 160, b: 221 }, powderblue: { r: 176, g: 224, b: 230 },
  purple: { r: 128, g: 0, b: 128 }, rebeccapurple: { r: 102, g: 51, b: 153 },
  red: { r: 255, g: 0, b: 0 }, rosybrown: { r: 188, g: 143, b: 143 },
  royalblue: { r: 65, g: 105, b: 225 }, saddlebrown: { r: 139, g: 69, b: 19 },
  salmon: { r: 250, g: 128, b: 114 }, sandybrown: { r: 244, g: 164, b: 96 },
  seagreen: { r: 46, g: 139, b: 87 }, seashell: { r: 255, g: 245, b: 238 },
  sienna: { r: 160, g: 82, b: 45 }, silver: { r: 192, g: 192, b: 192 },
  skyblue: { r: 135, g: 206, b: 235 }, slateblue: { r: 106, g: 90, b: 205 },
  slategray: { r: 112, g: 128, b: 144 }, slategrey: { r: 112, g: 128, b: 144 },
  snow: { r: 255, g: 250, b: 250 }, springgreen: { r: 0, g: 255, b: 127 },
  steelblue: { r: 70, g: 130, b: 180 }, tan: { r: 210, g: 180, b: 140 },
  teal: { r: 0, g: 128, b: 128 }, thistle: { r: 216, g: 191, b: 216 },
  tomato: { r: 255, g: 99, b: 71 }, turquoise: { r: 64, g: 224, b: 208 },
  violet: { r: 238, g: 130, b: 238 }, wheat: { r: 245, g: 222, b: 179 },
  white: { r: 255, g: 255, b: 255 }, whitesmoke: { r: 245, g: 245, b: 245 },
  yellow: { r: 255, g: 255, b: 0 }, yellowgreen: { r: 154, g: 205, b: 50 },
  // CSS Color 4 additions
  transparent: { r: 0, g: 0, b: 0 }, currentcolor: { r: 0, g: 0, b: 0 },
};

function clamp255(n: number): number {
  if (n < 0) return 0;
  if (n > 255) return 255;
  return Math.round(n);
}

function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

/**
 * Parse any CSS color string to { r, g, b } (0–255). Returns null if the
 * value is unparseable by this parser (caller decides what to do).
 *
 * Supports:
 *   - rgb() / rgba(), legacy comma AND modern space syntax, with optional alpha
 *   - hsl() / hsla() (hue in deg/turn/rad; s/l as %)
 *   - hwb() (CSS Color 4)
 *   - #rgb, #rgba, #rrggbb, #rrggbbaa
 *   - CSS named colors (including `transparent`)
 *
 * Note: `currentcolor` and `oklch()`/`lab()`/`color-mix()` are not resolved
 * here — they need context the parser doesn't have. They return null.
 */
export function parseColor(color: string): RGB | null {
  if (!color) return null;
  const c = color.trim().toLowerCase();

  // Named color (incl. transparent / currentcolor)
  if (NAMED_COLORS[c]) return { ...NAMED_COLORS[c] };

  // Hex — 3, 4, 6, or 8 digits
  const hex = c.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hex) {
    const v = hex[1];
    if (v.length === 3) {
      return {
        r: parseInt(v[0] + v[0], 16),
        g: parseInt(v[1] + v[1], 16),
        b: parseInt(v[2] + v[2], 16),
      };
    }
    if (v.length === 6) {
      const n = parseInt(v, 16);
      return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
    }
    if (v.length === 8) {
      const n = parseInt(v, 16);
      return { r: (n >> 24) & 0xff, g: (n >> 16) & 0xff, b: (n >> 8) & 0xff };
    }
    if (v.length === 4) {
      return {
        r: parseInt(v[0] + v[0], 16),
        g: parseInt(v[1] + v[1], 16),
        b: parseInt(v[2] + v[2], 16),
      };
    }
  }

  // rgb()/rgba() — legacy comma OR modern space syntax
  // Legacy: rgb(255, 0, 0) | rgba(255, 0, 0, 0.5)
  const rgbComma = c.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
  if (rgbComma) {
    return {
      r: clamp255(+rgbComma[1]),
      g: clamp255(+rgbComma[2]),
      b: clamp255(+rgbComma[3]),
    };
  }
  // Modern: rgb(255 0 0) | rgb(255 0 0 / 0.5) | rgb(100% 0% 0%)
  const rgbSpace = c.match(/^rgba?\(\s*([\d.]+)(%?)\s+([\d.]+)(%?)\s+([\d.]+)(%?)/);
  if (rgbSpace) {
    const pct = (n: number, isPct: boolean) => isPct ? (n / 100) * 255 : n;
    return {
      r: clamp255(pct(+rgbSpace[1], rgbSpace[2] === '%')),
      g: clamp255(pct(+rgbSpace[3], rgbSpace[4] === '%')),
      b: clamp255(pct(+rgbSpace[5], rgbSpace[6] === '%')),
    };
  }

  // hsl()/hsla() — legacy comma OR modern space syntax. Hue in deg/turn/rad/grad
  const hslMatch = c.match(/^hsla?\(\s*([-\d.]+)(deg|rad|turn|grad|g)?\s*[ ,]\s*([\d.]+)%\s*[ ,]\s*([\d.]+)%/);
  if (hslMatch) {
    const h = normalizeHue(parseFloat(hslMatch[1]), hslMatch[2]);
    const s = parseFloat(hslMatch[3]) / 100;
    const l = parseFloat(hslMatch[4]) / 100;
    return hslToRgb(h, s, l);
  }

  // hwb(H S% L%[/a])
  const hwbMatch = c.match(/^hwb\(\s*([-\d.]+)(deg|rad|turn|grad|g)?\s+([\d.]+)%\s+([\d.]+)%/);
  if (hwbMatch) {
    const h = normalizeHue(parseFloat(hwbMatch[1]), hwbMatch[2]);
    const w = parseFloat(hwbMatch[3]) / 100;
    const bk = parseFloat(hwbMatch[4]) / 100;
    return hwbToRgb(h, w, bk);
  }

  return null;
}

function normalizeHue(value: number, unit?: string): number {
  // Normalize to [0,1) turns
  let turns: number;
  switch (unit) {
    case 'turn': turns = value; break;
    case 'rad':  turns = value / (2 * Math.PI); break;
    case 'grad':
    case 'g':    turns = value / 400; break;
    default:     turns = value / 360; break; // deg or unitless
  }
  // Wrap into [0,1)
  turns = turns - Math.floor(turns);
  return turns;
}

function hslToRgb(h: number /* 0..1 turns */, s: number, l: number): RGB {
  if (s === 0) {
    const v = clamp255(l * 255);
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: clamp255(hue2rgb(p, q, h + 1 / 3) * 255),
    g: clamp255(hue2rgb(p, q, h) * 255),
    b: clamp255(hue2rgb(p, q, h - 1 / 3) * 255),
  };
}

function hwbToRgb(h: number, w: number, b: number): RGB {
  if (w + b >= 1) {
    const gray = w / (w + b);
    const v = clamp255(gray * 255);
    return { r: v, g: v, b: v };
  }
  const base = hslToRgb(h, 1, 0.5);
  return {
    r: clamp255(base.r * (1 - w - b) + w * 255),
    g: clamp255(base.g * (1 - w - b) + w * 255),
    b: clamp255(base.b * (1 - w - b) + w * 255),
  };
}

/** Relative luminance per WCAG 2.1 */
export function relativeLuminance(r: number, g: number, b: number): number {
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** Contrast ratio between two colours (1–21) */
export function contrastRatio(c1: RGB, c2: RGB): number {
  const l1 = relativeLuminance(c1.r, c1.g, c1.b);
  const l2 = relativeLuminance(c2.r, c2.g, c2.b);
  const lighter = Math.max(l1, l2);
  const darker  = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Whether a color string represents a fully-transparent background. Used to
 * decide whether to walk ancestors for the effective background.
 */
export function isTransparent(colorStr: string | undefined): boolean {
  if (!colorStr) return true;
  const c = colorStr.trim().toLowerCase();
  if (c === 'transparent') return true;
  if (c === 'rgba(0, 0, 0, 0)' || c === 'rgba(0,0,0,0)') return true;
  // Modern syntax rgba(0 0 0 / 0)
  if (/^rgba?\(\s*0+\s+0+\s+0+\s*\/\s*0(\.0+)?\)/.test(c)) return true;
  // 8-digit hex with zero alpha #rrggbb00
  const m = c.match(/^#[0-9a-f]{8}$/i);
  if (m && (parseInt(c.slice(7, 9), 16) & 0xff) === 0) return true;
  // 4-digit hex with zero alpha #rgb0
  const m4 = c.match(/^#[0-9a-f]{4}$/i);
  if (m4) {
    const a = parseInt(c.slice(3, 4) + c.slice(3, 4), 16);
    if (a === 0) return true;
  }
  return false;
}

export function checkColorContrast(styles: Map<string, string>): Issue[] {
  const issues: Issue[] = [];
  const colorStr = styles.get('color');
  const bgStr    = styles.get('background-color');
  const fontSizeStr = styles.get('font-size') ?? '16px';
  const fontWeight  = styles.get('font-weight') ?? '400';

  if (!colorStr || !bgStr) return issues;
  // Transparent backgrounds are handled by the caller via ancestor walk —
  // don't emit a (wrong) contrast result here.
  if (isTransparent(bgStr)) return issues;

  const fg = parseColor(colorStr);
  const bg = parseColor(bgStr);
  if (!fg || !bg) return issues;

  const ratio = contrastRatio(fg, bg);
  const fontSize = parseFloat(fontSizeStr);
  const isBold = parseInt(fontWeight, 10) >= 700;
  const isLargeText = fontSize >= 18 || (isBold && fontSize >= 14);

  // WCAG AA thresholds
  const minAA = isLargeText ? 3.0 : 4.5;
  // WCAG AAA thresholds
  const minAAA = isLargeText ? 4.5 : 7.0;

  if (ratio < minAA) {
    issues.push({
      type: 'contrast-fail-aa',
      severity: 'high',
      message: `Color contrast ratio is ${ratio.toFixed(2)}:1 — fails WCAG AA (minimum ${minAA}:1 for ${isLargeText ? 'large' : 'normal'} text)`,
      suggestion: `Increase contrast between text color (${colorStr}) and background (${bgStr}). Use a contrast checker to find a compliant combination.`,
    });
  } else if (ratio < minAAA) {
    issues.push({
      type: 'contrast-fail-aaa',
      severity: 'low',
      message: `Color contrast ratio is ${ratio.toFixed(2)}:1 — passes WCAG AA but fails AAA (${minAAA}:1)`,
      suggestion: 'Consider increasing contrast for better readability, especially for users with low vision.',
    });
  }

  return issues;
}

// ── Authored-styles (CSS variable) detection ─────────────────────────────────

/**
 * Detect unresolved CSS variables by inspecting *authored* (as-written)
 * declarations, not resolved computed values. Chrome resolves var() at
 * compute time, so by the time we read `getComputedStyleForNode` the
 * `var(--x)` text is gone — replaced by the resolved value or the property's
 * initial value. To actually catch unresolved vars we have to read the
 * matched rules (CSS.getMatchedStylesForNode) and look for var() there.
 *
 * `ruleDeclarations` is a list of { property, value } pairs from matched
 * rules. We flag any value that still contains `var(--...)` *and* whose
 * computed value equals the property's initial value — strong signal that
 * the variable never resolved.
 */
export function checkAuthoredVars(
  ruleDeclarations: { property: string; value: string }[],
  computedStyles: Map<string, string>,
): Issue[] {
  const issues: Issue[] = [];
  // A representative set of properties + their CSS initial values. If a var()
  // declaration resolves to the initial value, it likely failed to resolve.
  const initials: Record<string, string> = {
    'color': 'rgb(0, 0, 0)',            // canvasText — effectively black
    'background-color': 'rgba(0, 0, 0, 0)',
    'border-color': 'rgb(0, 0, 0)',
    'border-top-color': 'rgb(0, 0, 0)',
    'border-right-color': 'rgb(0, 0, 0)',
    'border-bottom-color': 'rgb(0, 0, 0)',
    'border-left-color': 'rgb(0, 0, 0)',
    'fill': 'rgb(0, 0, 0)',
    'stroke': 'none',
    'box-shadow': 'none',
    'text-shadow': 'none',
    'width': 'auto',
    'height': 'auto',
    'margin': '0px',
    'padding': '0px',
  };

  const seen = new Set<string>();
  for (const decl of ruleDeclarations) {
    const value = decl.value?.trim() ?? '';
    // value contains var(--x) and possibly a fallback
    const varMatch = value.match(/var\(\s*(--[\w-]+)/);
    if (!varMatch) continue;

    const prop = decl.property;
    const varName = varMatch[1];

    // Has a fallback? e.g. var(--x, #fff)
    const hasFallback = /var\([^)]+,\s*\S+/.test(value);

    // If the declaration includes a fallback, only flag when the computed
    // value equals an "unresolved" sentinel — but we can't reliably know
    // that, so we still report it as a warning (lower severity) so the dev
    // can confirm. Without a fallback, flag if computed == initial.
    const computed = computedStyles.get(prop);
    const looksUnresolved = computed === initials[prop];

    const key = `${prop}:${varName}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (!hasFallback && looksUnresolved) {
      issues.push({
        type: 'unresolved-css-var',
        severity: 'high',
        message: `Property "${prop}" uses an unresolved CSS variable ${varName} — computed value fell back to the initial (${computed})`,
        suggestion: `Define ${varName} on :root or a parent element. Check spelling and scope.`,
      });
    } else if (!hasFallback) {
      // No fallback but computed isn't obviously initial — still worth surfacing
      issues.push({
        type: 'uses-css-var',
        severity: 'low',
        message: `Property "${prop}" references ${varName} without a fallback`,
        suggestion: `Add a fallback: ${prop}: var(${varName}, <default>)`,
      });
    }
  }

  return issues;
}

// Legacy alias kept for backwards-compat — now a no-op against computed styles.
// Use checkAuthoredVars() instead.
export function checkCustomProperties(_styles: Map<string, string>): Issue[] {
  return [];
}

// ── Utilities ─────────────────────────────────────────────────────────────────

export function sortBySeverity(issues: Issue[]): Issue[] {
  const rank = { high: 0, medium: 1, low: 2 } as const;
  return [...issues].sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export interface SelectorValidation { valid: boolean; error?: string; }

/**
 * Validate a CSS selector string.
 *
 * NOTE: we intentionally do NOT fully parse the selector grammar here. Full
 * selector validation would duplicate a chunk of the CSS spec and still be
 * wrong sometimes. Instead we reject obvious garbage early and let CDP's
 * DOM.querySelector produce a precise error for anything more exotic.
 *
 * We DO accept escaped leading characters (e.g. `\.digit`, `\31`) which the
 * previous implementation rejected as "starts with a digit".
 */
export function validateSelector(selector: string): SelectorValidation {
  if (!selector?.trim())
    return { valid: false, error: 'Selector must be a non-empty string' };

  const trimmed = selector.trim();

  // Reject unescaped leading digit (escaped is fine: "\31 foo", "\.foo")
  if (/^\d/.test(trimmed) && !/^\\/.test(trimmed))
    return { valid: false, error: 'Selector cannot start with an unescaped digit' };

  // Reject leading braces / obviously not a selector
  if (/^\s*[{}]/.test(trimmed))
    return { valid: false, error: 'Selector cannot start with "{" or "}"' };

  // Reject obvious junk: mismatched braces, stray semicolons
  const open  = (trimmed.match(/\{/g) ?? []).length;
  const close = (trimmed.match(/\}/g) ?? []).length;
  if (open !== close)
    return { valid: false, error: 'Selector has mismatched braces' };
  if (/;/.test(trimmed) && !/[{]/.test(trimmed))
    return { valid: false, error: 'Unexpected ";" in selector' };

  return { valid: true };
}
