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

// ── Box model helpers ─────────────────────────────────────────────────────────

export function extractBounds(model: { content: number[]; width: number; height: number }): Bounds {
  const c = model.content;
  return {
    left:   Math.round(Math.min(c[0], c[6])),
    top:    Math.round(Math.min(c[1], c[3])),
    right:  Math.round(Math.max(c[2], c[4])),
    bottom: Math.round(Math.max(c[5], c[7])),
    width:  Math.round(model.width),
    height: Math.round(model.height),
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
  if (bounds.right  > vp.clientWidth  + T) issues.push({ type: 'offscreen-right',  severity: 'high',   message: `Element extends ${bounds.right - vp.clientWidth}px beyond right edge`,    suggestion: 'Add max-width: 100% or overflow: hidden to parent' });
  if (bounds.left   < -T)                  issues.push({ type: 'offscreen-left',   severity: 'high',   message: `Element starts ${Math.abs(bounds.left)}px left of viewport`,               suggestion: 'Check left/margin-left values' });
  if (bounds.top    < -T)                  issues.push({ type: 'offscreen-top',    severity: 'high',   message: `Element starts ${Math.abs(bounds.top)}px above viewport`,                  suggestion: 'Check top/margin-top values' });
  if (bounds.bottom > vp.clientHeight + T) issues.push({ type: 'offscreen-bottom', severity: 'medium', message: `Element extends ${bounds.bottom - vp.clientHeight}px below viewport fold`,  suggestion: 'Add max-height or overflow: auto' });
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

  // Very small touch target
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

export function checkAccessibilityStyles(styles: Map<string, string>): Issue[] {
  const issues: Issue[] = [];

  // pointer-events: none makes elements unclikable
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

  // cursor: default on something that looks interactive
  const cursor = styles.get('cursor') ?? '';
  if (cursor === 'default') {
    const display = styles.get('display') ?? '';
    if (display === 'inline-flex' || display === 'flex') {
      issues.push({
        type: 'missing-pointer-cursor',
        severity: 'low',
        message: 'Flex element has cursor: default — if this is a button/link, set cursor: pointer',
        suggestion: "Add cursor: pointer to indicate the element is interactive",
      });
    }
  }

  return issues;
}

// ── Color contrast check (pure math, no CDP needed) ──────────────────────────

/**
 * Parse any CSS color string to { r, g, b } (0–255).
 * Supports: rgb(...), rgba(...), #rrggbb, #rgb
 */
export function parseColor(color: string): { r: number; g: number; b: number } | null {
  // rgb / rgba
  const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgbMatch) return { r: +rgbMatch[1], g: +rgbMatch[2], b: +rgbMatch[3] };

  // #rrggbb
  const hex6 = color.match(/^#([0-9a-f]{6})$/i);
  if (hex6) {
    const v = parseInt(hex6[1], 16);
    return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
  }

  // #rgb
  const hex3 = color.match(/^#([0-9a-f]{3})$/i);
  if (hex3) {
    const r = parseInt(hex3[1][0] + hex3[1][0], 16);
    const g = parseInt(hex3[1][1] + hex3[1][1], 16);
    const b = parseInt(hex3[1][2] + hex3[1][2], 16);
    return { r, g, b };
  }

  return null;
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
export function contrastRatio(c1: { r: number; g: number; b: number }, c2: { r: number; g: number; b: number }): number {
  const l1 = relativeLuminance(c1.r, c1.g, c1.b);
  const l2 = relativeLuminance(c2.r, c2.g, c2.b);
  const lighter = Math.max(l1, l2);
  const darker  = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function checkColorContrast(styles: Map<string, string>): Issue[] {
  const issues: Issue[] = [];
  const colorStr = styles.get('color');
  const bgStr    = styles.get('background-color');
  const fontSizeStr = styles.get('font-size') ?? '16px';
  const fontWeight  = styles.get('font-weight') ?? '400';

  if (!colorStr || !bgStr) return issues;

  const fg = parseColor(colorStr);
  const bg = parseColor(bgStr);
  if (!fg || !bg) return issues;

  // Skip fully transparent background
  if (bgStr.includes('rgba') && bgStr.includes(', 0)')) return issues;

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

// ── CSS custom property resolver ──────────────────────────────────────────────

export function checkCustomProperties(styles: Map<string, string>): Issue[] {
  const issues: Issue[] = [];

  for (const [prop, value] of styles.entries()) {
    // A CSS variable that failed to resolve shows as the initial/empty value or the var() call itself
    if (value.includes('var(--') && value.includes(')')) {
      issues.push({
        type: 'unresolved-css-var',
        severity: 'high',
        message: `Property "${prop}" uses an unresolved CSS variable: ${value}`,
        suggestion: `Define the variable on :root or a parent element. Check spelling and scope.`,
      });
    }
  }

  return issues;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

export function sortBySeverity(issues: Issue[]): Issue[] {
  const rank = { high: 0, medium: 1, low: 2 } as const;
  return [...issues].sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export function validateSelector(selector: string): { valid: boolean; error?: string } {
  if (!selector?.trim())
    return { valid: false, error: 'Selector must be a non-empty string' };
  if (/^\d/.test(selector.trim()))
    return { valid: false, error: 'Selector cannot start with a number' };
  return { valid: true };
}
