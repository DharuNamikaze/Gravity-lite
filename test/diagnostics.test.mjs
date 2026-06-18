// diagnostics.test.mjs — unit tests for src/diagnostics.ts pure functions.
//
// No test framework: a tiny assert harness so we don't need a dependency.
// Run with: `npm test` (compiles TS first, then runs this against dist/).

import {
  parseColor, contrastRatio, relativeLuminance, isTransparent,
  extractBounds, extractPadding, borderBoxBounds,
  checkFlexGrid, checkZIndex, checkStackingContextCreators,
  checkAccessibilityStyles, checkColorContrast, checkResponsive,
  checkAuthoredVars, checkVisibility, checkOffscreen,
  validateSelector, sortBySeverity,
} from '../dist/diagnostics.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error(`  ✗ ${msg}`); }
}
function eq(a, b, msg) { assert(Object.is(a, b), `${msg} — expected ${b}, got ${a}`); }
function approx(a, b, eps, msg) { assert(Math.abs(a - b) < eps, `${msg} — expected ~${b}, got ${a}`); }
const map = (obj) => new Map(Object.entries(obj));

// ── parseColor: hex variants ──────────────────────────────────────────────────
console.log('parseColor — hex');
eq(parseColor('#000000')?.r, 0, '#000000 r');
eq(parseColor('#000')?.b, 0, '#000 b');
eq(parseColor('#ffffff')?.g, 255, '#ffffff g');
eq(parseColor('#fff')?.r, 255, '#fff r');
eq(parseColor('#ff8800')?.r, 255, '#ff8800 r');
eq(parseColor('#ff8800')?.g, 136, '#ff8800 g');
eq(parseColor('#ff8800')?.b, 0, '#ff8800 b');
eq(parseColor('#ff8800aa')?.r, 255, '#rrggbbaa r (alpha ignored for rgb)');
eq(parseColor('#f80a')?.g, 136, '#rgba g');

// ── parseColor: rgb / rgba (comma + space syntax) ────────────────────────────
console.log('parseColor — rgb/rgba');
eq(parseColor('rgb(255, 0, 0)')?.r, 255, 'rgb() comma r');
eq(parseColor('rgb(255, 0, 0)')?.b, 0, 'rgb() comma b');
eq(parseColor('rgba(255, 0, 0, 0.5)')?.r, 255, 'rgba() comma r');
eq(parseColor('rgb(255 0 0)')?.g, 0, 'rgb() space g');
eq(parseColor('rgb(255 0 0 / 0.5)')?.b, 0, 'rgb() space+alpha b');
eq(parseColor('rgb(100% 0% 0%)')?.r, 255, 'rgb() percent r');

// ── parseColor: hsl / hsla (deg + units) ─────────────────────────────────────
console.log('parseColor — hsl');
{
  const red = parseColor('hsl(0, 100%, 50%)');
  eq(red?.r, 255, 'hsl(0) r');
  eq(red?.g, 0, 'hsl(0) g');
  const green = parseColor('hsl(120, 100%, 50%)');
  approx(green?.g, 255, 1, 'hsl(120) g');
  approx(green?.r, 0, 1, 'hsl(120) r');
  const blue = parseColor('hsl(240deg, 100%, 50%)');
  approx(blue?.b, 255, 1, 'hsl(240deg) b');
  const turn = parseColor('hsl(0.5turn, 100%, 50%)');
  approx(turn?.b, 255, 1, 'hsl(0.5turn) b');
  // modern space syntax with alpha
  const spaceAlpha = parseColor('hsl(0 100% 50% / 0.5)');
  eq(spaceAlpha?.r, 255, 'hsl space+alpha r');
}

// ── parseColor: hwb ───────────────────────────────────────────────────────────
console.log('parseColor — hwb');
{
  const white = parseColor('hwb(0 100% 0%)');
  eq(white?.r, 255, 'hwb white r');
  eq(white?.g, 255, 'hwb white g');
  const black = parseColor('hwb(0 0% 100%)');
  eq(black?.r, 0, 'hwb black r');
}

// ── parseColor: named colors + edge cases ─────────────────────────────────────
console.log('parseColor — named + edges');
eq(parseColor('red')?.r, 255, 'named red');
eq(parseColor('RED')?.r, 255, 'named red uppercase');
eq(parseColor('transparent')?.r, 0, 'transparent');
assert(parseColor('rebeccapurple')?.r === 102, 'rebeccapurple');
assert(parseColor('not-a-color') === null, 'unparseable returns null');
assert(parseColor('oklch(0.7 0.1 200)') === null, 'oklch unsupported (returns null)');
assert(parseColor('color-mix(in srgb, red, blue)') === null, 'color-mix unsupported');

// ── contrast + luminance ──────────────────────────────────────────────────────
console.log('contrast / luminance');
approx(relativeLuminance(255, 255, 255), 1.0, 0.001, 'white luminance');
approx(relativeLuminance(0, 0, 0), 0.0, 0.001, 'black luminance');
approx(contrastRatio(parseColor('#000'), parseColor('#fff')), 21, 0.1, 'black vs white = 21');
const contrastFail = contrastRatio(parseColor('#aaaaaa'), parseColor('#ffffff'));
assert(contrastFail < 2.5 && contrastFail > 2.0, 'gray on white ≈ 2.3');

// ── isTransparent ─────────────────────────────────────────────────────────────
console.log('isTransparent');
assert(isTransparent('transparent'), 'transparent keyword');
assert(isTransparent('rgba(0, 0, 0, 0)'), 'rgba 0 comma');
assert(isTransparent('rgba(0 0 0 / 0)'), 'rgba 0 space');
assert(isTransparent('#00000000'), '8-hex zero alpha');
assert(isTransparent('#0000'), '4-hex zero alpha');
assert(!isTransparent('#ffffff'), 'white not transparent');
assert(!isTransparent('rgb(0, 0, 0)'), 'solid black not transparent');
assert(isTransparent(undefined), 'undefined treated transparent');

// ── extractBounds + extractPadding (border-box) ──────────────────────────────
console.log('box model');
{
  // Element: 100x60 border-box at (10,20), with 5px padding all sides,
  // so content box is 90x50 at (15,25).
  const model = {
    border:  [10, 20, 110, 20, 110, 80, 10, 80],
    padding: [15, 25, 105, 25, 105, 75, 15, 75],
    content: [15, 25, 105, 25, 105, 75, 15, 75],
    width: 90, height: 50,
  };
  const b = extractBounds(model);
  eq(b.width, 100, 'border-box width');
  eq(b.height, 60, 'border-box height');
  eq(b.left, 10, 'border-box left');
  eq(b.top, 20, 'border-box top');
  const p = extractPadding(model);
  eq(p.top, 5, 'padding top');
  eq(p.right, 5, 'padding right');
  eq(p.bottom, 5, 'padding bottom');
  eq(p.left, 5, 'padding left');
}
{
  // Test-page BUG 8: 20x20 touch target → must be flagged as too small
  const b = borderBoxBounds({ border: [0, 0, 20, 0, 20, 20, 0, 20], content: [0, 0, 20, 0, 20, 20, 0, 20], width: 20, height: 20 });
  const issues = checkResponsive(map({ width: '20px' }), b, { clientWidth: 1000 });
  assert(issues.some(i => i.type === 'small-touch-target'), '20x20 flagged small-touch-target');
}

// ── checkAccessibilityStyles — cursor false-positive removed ─────────────────
console.log('accessibility cursor');
{
  // A flex <div> with cursor:default must NOT be flagged anymore.
  const issues = checkAccessibilityStyles(map({ cursor: 'default', display: 'flex' }));
  assert(!issues.some(i => i.type === 'missing-pointer-cursor'), 'plain flex div not flagged');
  // A <button> with cursor:default SHOULD be flagged.
  const btn = checkAccessibilityStyles(map({ cursor: 'default' }), 'button');
  assert(btn.some(i => i.type === 'missing-pointer-cursor'), 'button flagged');
  // <a> too
  const a = checkAccessibilityStyles(map({ cursor: 'default' }), 'a');
  assert(a.some(i => i.type === 'missing-pointer-cursor'), 'anchor flagged');
}

// ── checkColorContrast — transparent bg returns no issues (caller walks up) ──
console.log('contrast check');
{
  const issues = checkColorContrast(map({ color: '#222', 'background-color': 'transparent' }));
  eq(issues.length, 0, 'transparent bg → defer to ancestor walk');
}
{
  // Test-page BUG 7: #aaaaaa on #ffffff must fail AA
  const issues = checkColorContrast(map({ color: '#aaaaaa', 'background-color': '#ffffff', 'font-size': '16px', 'font-weight': '400' }));
  assert(issues.some(i => i.type === 'contrast-fail-aa'), 'gray-on-white fails AA');
}
{
  // Black on white passes everything
  const issues = checkColorContrast(map({ color: '#000000', 'background-color': '#ffffff', 'font-size': '16px', 'font-weight': '400' }));
  eq(issues.length, 0, 'black-on-white passes');
}

// ── checkAuthoredVars — the test-page BUG 11 case ────────────────────────────
console.log('authored var detection');
{
  // var(--missing-text-color) with NO fallback, computed value = initial (black)
  const rules = [{ property: 'color', value: 'var(--missing-text-color)' }];
  const computed = map({ color: 'rgb(0, 0, 0)' });
  const issues = checkAuthoredVars(rules, computed);
  assert(issues.some(i => i.type === 'unresolved-css-var' && i.severity === 'high'), 'unresolved var flagged high');
}
{
  // var(--x, #fff) WITH fallback → only a low-severity nudge
  const rules = [{ property: 'background-color', value: 'var(--missing-color, #fffbeb)' }];
  const computed = map({ 'background-color': 'rgb(255, 251, 235)' });
  const issues = checkAuthoredVars(rules, computed);
  assert(!issues.some(i => i.severity === 'high'), 'var with fallback not high severity');
}

// ── flex/grid ─────────────────────────────────────────────────────────────────
console.log('flex/grid');
{
  // Test-page BUG 12: flex with height:0
  const issues = checkFlexGrid(map({ display: 'flex', height: '0px' }));
  assert(issues.some(i => i.type === 'flex-zero-height'), 'flex height:0 flagged');
}
{
  // Test-page BUG 14: grid with no template
  const issues = checkFlexGrid(map({ display: 'grid' }));
  assert(issues.some(i => i.type === 'grid-no-template'), 'grid no-template flagged');
}

// ── stacking context creators ────────────────────────────────────────────────
console.log('stacking');
{
  const sc = checkStackingContextCreators(map({ transform: 'translateZ(0)', position: 'static' }));
  assert(sc.creates, 'transform creates stacking context');
  assert(sc.reasons.some(r => r.includes('transform')), 'transform in reasons');
}
{
  const sc = checkStackingContextCreators(map({ position: 'static' }));
  assert(!sc.creates, 'static + nothing → no context');
}
{
  // Test-page BUG 5: z-index on static
  const issues = checkZIndex(map({ 'z-index': '9999', position: 'static' }));
  assert(issues.some(i => i.type === 'zindex-no-effect'), 'z-index on static flagged');
  assert(issues.some(i => i.type === 'zindex-magic-number'), '9999 also flagged as magic');
}

// ── visibility / offscreen ───────────────────────────────────────────────────
console.log('visibility / offscreen');
assert(checkVisibility(map({ display: 'none' })).some(i => i.type === 'hidden-display'), 'display:none');
assert(checkVisibility(map({ visibility: 'hidden' })).some(i => i.type === 'hidden-visibility'), 'visibility:hidden');
assert(checkVisibility(map({ opacity: '0' })).some(i => i.type === 'hidden-opacity'), 'opacity:0');
{
  const b = { left: 9999, top: 0, right: 10199, bottom: 50, width: 200, height: 50 };
  const issues = checkOffscreen(b, { clientWidth: 1000, clientHeight: 800 });
  assert(issues.some(i => i.type === 'offscreen-right'), 'offscreen-right detected');
}

// ── validateSelector ─────────────────────────────────────────────────────────
console.log('selector validation');
assert(validateSelector('#id').valid, '#id valid');
assert(validateSelector('.cls').valid, '.cls valid');
assert(validateSelector('button.primary').valid, 'compound valid');
assert(!validateSelector('').valid, 'empty invalid');
assert(!validateSelector('   ').valid, 'whitespace invalid');
assert(!validateSelector('123abc').valid, 'leading digit invalid');
assert(validateSelector('\\31 foo').valid, 'escaped leading digit valid');
assert(validateSelector('.\\.digit').valid, 'escaped leading dot valid');
assert(!validateSelector('{ }').valid, 'mismatched braces invalid');
assert(!validateSelector('{foo}').valid, 'leading brace invalid');
assert(validateSelector('a > b + c ~ d').valid, 'combinators valid');

// ── sortBySeverity stability ─────────────────────────────────────────────────
console.log('sortBySeverity');
{
  const issues = [
    { severity: 'low',    type: 'a' },
    { severity: 'high',   type: 'b' },
    { severity: 'medium', type: 'c' },
    { severity: 'high',   type: 'd' },
  ];
  const sorted = sortBySeverity(issues);
  eq(sorted[0].severity, 'high', 'first is high');
  eq(sorted[sorted.length - 1].severity, 'low', 'last is low');
}

// ── summary ───────────────────────────────────────────────────────────────────
console.log('\n──────────────────────────────');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('──────────────────────────────');
if (failed > 0) process.exit(1);
