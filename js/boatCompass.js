/**
 * boatCompass.js
 * Standalone module — no external dependencies.
 *
 * Generates an inline SVG showing:
 *   • Boat hull silhouette from above (teardrop, flat stern), rotated to heading
 *   • Wind arrow: AMBER — tail on ring at wind-FROM direction, arrowhead toward center
 *   • Heading arrow: CYAN — from the bow outward in the boat's heading direction
 *   • Compass ring with N/E/S/W tick marks
 *
 * Usage:
 *   import { buildBoatCompassSVG } from './boatCompass.js';
 *   element.innerHTML = buildBoatCompassSVG(windFromDeg, boatHeadingDeg);
 */

import { t } from './i18n.js';

/**
 * @param {number} windFromDeg    Compass bearing the wind is blowing FROM (0–360)
 * @param {number} boatHeadingDeg Compass bearing the boat is heading (0–360)
 * @returns {string} Inline SVG markup
 */
export function buildBoatCompassSVG(windFromDeg, boatHeadingDeg) {
  const S  = 100;   // SVG canvas size (px)
  const C  = 50;    // Center
  const R  = 40;    // Compass ring radius

  // Unique suffix to avoid <marker> ID collisions when multiple SVGs exist on page
  const uid = Math.random().toString(36).slice(2, 6);

  // ── Helpers ─────────────────────────────────────────────────────
  const rad = d => d * Math.PI / 180;

  /** X coordinate of a point at compass bearing `deg`, `r` px from center */
  const px = (deg, r) => (C + r * Math.sin(rad(deg))).toFixed(2);

  /** Y coordinate of a point at compass bearing `deg`, `r` px from center */
  const py = (deg, r) => (C - r * Math.cos(rad(deg))).toFixed(2);

  // ── Compass ring tick marks ──────────────────────────────────────
  const TICKS = [0, 45, 90, 135, 180, 225, 270, 315];
  const ticks = TICKS.map(deg => {
    const isMajor = deg % 90 === 0;
    const inner   = R - (isMajor ? 5 : 3);
    return `<line x1="${px(deg, inner)}" y1="${py(deg, inner)}"
                  x2="${px(deg, R)}"     y2="${py(deg, R)}"
                  stroke="rgba(0,212,170,${isMajor ? '0.45' : '0.2'})"
                  stroke-width="${isMajor ? 1.5 : 1}"/>`;
  }).join('\n  ');

  // Cardinal labels
  const CARDINALS = [
    { deg: 0,   lbl: t('compass.n') },
    { deg: 90,  lbl: t('compass.e') },
    { deg: 180, lbl: t('compass.s') },
    { deg: 270, lbl: t('compass.w') },
  ];
  const cardinals = CARDINALS.map(({ deg, lbl }) => {
    const lx = (C + (R + 8) * Math.sin(rad(deg))).toFixed(1);
    const ly = (C - (R + 8) * Math.cos(rad(deg)) + 2.5).toFixed(1);
    return `<text x="${lx}" y="${ly}" text-anchor="middle"
                  font-size="6.5" font-family="monospace" font-weight="bold"
                  fill="rgba(0,212,170,0.55)">${lbl}</text>`;
  }).join('\n  ');

  // ── Wind arrow ───────────────────────────────────────────────────
  // Tail: on the ring at windFromDeg; Head: ~10 px from center (arrowhead tip there)
  const wTailX = px(windFromDeg, R - 1);
  const wTailY = py(windFromDeg, R - 1);
  const wHeadX = px(windFromDeg, 12);
  const wHeadY = py(windFromDeg, 12);

  // ── Boat heading arrow ───────────────────────────────────────────
  // Tail: at the bow tip (18 px from center in heading direction)
  // Head: extends out to near the ring
  const bowR   = 19;
  const bTailX = px(boatHeadingDeg, bowR);
  const bTailY = py(boatHeadingDeg, bowR);
  const bHeadX = px(boatHeadingDeg, R - 4);
  const bHeadY = py(boatHeadingDeg, R - 4);

  // ── Boat hull path ───────────────────────────────────────────────
  // Local coordinates: bow at (0, -18), flat stern at y=+17, beam ±11.
  // Bezier curves give the classic teardrop hull shape seen from above.
  const boatPath = [
    'M 0,-18',              // bow tip
    'C 11,-10 12,4 9,17',   // starboard curve
    'L -9,17',              // flat stern
    'C -12,4 -11,-10 0,-18', // port curve
    'Z'
  ].join(' ');

  // Cockpit detail (tiny oval near stern adds realism)
  const cockpit = 'M 0,6 C 3,5 3,12 0,12 C -3,12 -3,5 0,6 Z';

  // ── Legend rows ──────────────────────────────────────────────────
  const legendY  = S - 2;
  const legendAX = C - 18, legendBX = C + 4;
  const legend = `
  <circle cx="${legendAX - 4}" cy="${legendY - 3}" r="2" fill="#fbbf24" opacity="0.8"/>
  <text x="${legendAX}" y="${legendY}" font-size="6" fill="rgba(251,191,36,0.8)"
      font-family="monospace">${t('compass.wind')}</text>
  <line x1="${legendBX - 5}" y1="${legendY - 3}" x2="${legendBX - 1}" y2="${legendY - 3}"
        stroke="#38bdf8" stroke-width="1.5" marker-end="url(#bm-${uid})"/>
  <text x="${legendBX + 3}" y="${legendY}" font-size="6" fill="rgba(56,189,248,0.8)"
      font-family="monospace">${t('compass.heading')}</text>`;

  // ── Assemble SVG ─────────────────────────────────────────────────
  return `<svg viewBox="0 0 ${S} ${S}" width="${S}" height="${S}"
              xmlns="http://www.w3.org/2000/svg" style="display:block;margin:0 auto">
  <defs>
    <!-- Amber arrowhead for wind -->
    <marker id="wm-${uid}" markerWidth="5" markerHeight="5"
            refX="4.5" refY="2.5" orient="auto">
      <path d="M0,0 L5,2.5 L0,5 Z" fill="#fbbf24"/>
    </marker>
    <!-- Cyan arrowhead for heading -->
    <marker id="bm-${uid}" markerWidth="5" markerHeight="5"
            refX="4.5" refY="2.5" orient="auto">
      <path d="M0,0 L5,2.5 L0,5 Z" fill="#38bdf8"/>
    </marker>
  </defs>

  <!-- Compass background -->
  <circle cx="${C}" cy="${C}" r="${R}" fill="rgba(0,8,20,0.75)"
          stroke="rgba(0,212,170,0.18)" stroke-width="1"/>

  <!-- Tick marks and cardinal labels -->
  ${ticks}
  ${cardinals}

  <!-- Wind arrow (amber) — FROM wind direction, arrowhead at center -->
  <line x1="${wTailX}" y1="${wTailY}"
        x2="${wHeadX}" y2="${wHeadY}"
        stroke="#fbbf24" stroke-width="1.8" opacity="0.9"
        marker-end="url(#wm-${uid})"/>
  <circle cx="${wTailX}" cy="${wTailY}" r="2.5" fill="#fbbf24" opacity="0.6"/>

  <!-- Boat hull silhouette, rotated to heading -->
  <g transform="translate(${C},${C}) rotate(${(boatHeadingDeg % 360).toFixed(1)})">
    <path d="${boatPath}"
          fill="rgba(56,189,248,0.18)" stroke="#38bdf8" stroke-width="1.2"
          stroke-linejoin="round"/>
    <!-- Cockpit hint -->
    <path d="${cockpit}" fill="rgba(56,189,248,0.35)" stroke="none"/>
    <!-- Center dot -->
    <circle cx="0" cy="0" r="1.5" fill="#38bdf8" opacity="0.6"/>
  </g>

  <!-- Heading arrow (cyan) — from bow tip outward -->
  <line x1="${bTailX}" y1="${bTailY}"
        x2="${bHeadX}" y2="${bHeadY}"
        stroke="#38bdf8" stroke-width="1.8" opacity="0.9"
        marker-end="url(#bm-${uid})"/>

  ${legend}
</svg>`;
}
