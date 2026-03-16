/**
 * forecastChart.js
 * Standalone module — no external dependencies.
 *
 * Builds an inline SVG chart showing:
 *   • Beaufort wind-force background bands
 *   • Wind speed filled area (amber)
 *   • Boat speed line (cyan dashed)
 *   • Wind direction mini-arrows sampled every ~hour
 *   • Waypoint arrival vertical markers
 *   • X-axis: time labels (adaptive to route duration)
 *   • Y-axis: speed in selected unit
 *
 * Usage:
 *   import { extractTimeSeries, buildForecastSVG } from './forecastChart.js';
 *   const series = extractTimeSeries(routeResult, departureTime);
 *   svgContainer.innerHTML = buildForecastSVG(series, routeResult.waypointETAs, departureTime, units);
 */

import { t, getCurrentLanguage } from './i18n.js';

// ─── Unit helpers (mirrored from uiController to keep module standalone) ──────
function cvtSpeed(kn, unit) {
  if (unit === 'ms')  return kn * 0.514444;
  if (unit === 'kmh') return kn * 1.852;
  return kn;
}
function speedLbl(unit) {
  if (unit === 'ms')  return 'm/s';
  if (unit === 'kmh') return 'km/h';
  return 'kn';
}
function fmtSpd(kn, unit) {
  const v = cvtSpeed(kn, unit);
  return unit === 'ms' ? v.toFixed(1) : Math.round(v).toString();
}

// ─── Beaufort thresholds (knots) ───────────────────────────────────────────────
const BEAUFORT = [
  { max:  3,  label: 'Calm',        color: 'rgba(0,212,170,0.00)' },
  { max:  7,  label: 'Light breeze',color: 'rgba(0,212,170,0.04)' },
  { max: 12,  label: 'Gentle',      color: 'rgba(100,210,140,0.06)' },
  { max: 18,  label: 'Moderate',    color: 'rgba(251,191,36,0.08)' },
  { max: 24,  label: 'Fresh',       color: 'rgba(251,150,36,0.11)' },
  { max: 31,  label: 'Strong',      color: 'rgba(251,80,50,0.13)' },
  { max: Infinity, label: 'Gale+', color: 'rgba(248,50,50,0.18)' },
];

// ─── Extract time series from routeResult ──────────────────────────────────────
/**
 * Flatten all subSegments into a chronological array of data points.
 * Returns Array<{ elapsed:number(s), windSpeed:kn, windDir:deg, boatSpeed:kn,
 *                 isWaypoint:bool, wpLabel:string|null }>
 */
export function extractTimeSeries(routeResult, departureTime) {
  const pts = [];
  let elapsed = 0;

  // Synthetic start point using first segment's starting weather
  const sw = routeResult.segments[0]?.startWeather;
  pts.push({
    elapsed: 0,
    windSpeed: sw?.windSpeed  ?? 10,
    windDir:   sw?.windDirection ?? 270,
    boatSpeed: 0,
    isWaypoint: true,
    wpLabel: t('forecast.start')
  });

  routeResult.segments.forEach((seg, si) => {
    seg.subSegments.forEach((chunk, ci) => {
      elapsed += chunk.timeSeconds;
      pts.push({
        elapsed,
        windSpeed: chunk.windSpeed,
        windDir:   chunk.windDir,
        boatSpeed: chunk.boatSpeedKts,
        isWaypoint: false,
        wpLabel: null
      });
    });
    // Tag the last point of each segment as a waypoint arrival
    if (pts.length > 0) {
      pts[pts.length - 1].isWaypoint = true;
      pts[pts.length - 1].wpLabel = si === routeResult.segments.length - 1
        ? t('forecast.destination')
        : t('forecast.wp', { index: si + 1 });
    }
  });

  return pts;
}

// ─── Downsample ────────────────────────────────────────────────────────────────
/**
 * Reduce series to at most `maxPts` points while preserving waypoint markers.
 */
function downsample(pts, maxPts = 120) {
  if (pts.length <= maxPts) return pts;
  const waypoints = pts.filter(p => p.isWaypoint);
  const step = Math.ceil(pts.length / maxPts);
  const sampled = pts.filter((_, i) => i % step === 0);
  // Re-inject waypoints that may have been skipped
  waypoints.forEach(wp => {
    if (!sampled.includes(wp)) sampled.push(wp);
  });
  sampled.sort((a, b) => a.elapsed - b.elapsed);
  return sampled;
}

// ─── X-axis label interval (seconds) ─────────────────────────────────────────
function xLabelInterval(totalSec) {
  const h = totalSec / 3600;
  if (h <= 1.5)  return  900;   // every 15 min
  if (h <= 4)    return 1800;   // every 30 min
  if (h <= 12)   return 3600;   // every hour
  if (h <= 36)   return 7200;   // every 2 h
  if (h <= 72)   return 14400;  // every 4 h
  return 21600;                  // every 6 h
}

// ─── Format a Date as HH:MM ────────────────────────────────────────────────────
function fmtHHMM(date) {
  const lang = getCurrentLanguage();
  return date.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
}
function fmtDDHH(date) {
  const lang = getCurrentLanguage();
  return date.toLocaleDateString(lang, { month: 'short', day: 'numeric' })
    + ' ' + date.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
}

// ─── Main SVG builder ─────────────────────────────────────────────────────────
/**
 * @param {Array}  rawSeries  Output of extractTimeSeries()
 * @param {Date}   departure
 * @param {object} units      { speed: 'kn'|'ms'|'kmh' }
 * @returns {string} SVG markup string (responsive via viewBox)
 */
export function buildForecastSVG(rawSeries, departure, units) {
  if (!rawSeries || rawSeries.length < 2) {
    return '<svg viewBox="0 0 800 155" xmlns="http://www.w3.org/2000/svg">'
      + '<text x="400" y="80" text-anchor="middle" fill="rgba(0,212,170,0.4)" '
      + `font-size="14" font-family="monospace">${t('forecast.noData')}</text></svg>`;
  }

  const series   = downsample(rawSeries, 120);
  const su       = units.speed || 'kn';

  // ── Layout constants ──────────────────────────────────────────────
  const W   = 800, H = 155;
  const PAD = { top: 34, right: 22, bottom: 36, left: 52 };
  const CW  = W - PAD.left - PAD.right;   // 726
  const CH  = H - PAD.top  - PAD.bottom;  // 85

  const totalSec = series[series.length - 1].elapsed;
  const maxWindKn = Math.max(...series.map(p => p.windSpeed)) * 1.15;
  const niceMax = Math.ceil(maxWindKn / 5) * 5 || 20;   // round up to nearest 5 kn
  const maxDisp  = cvtSpeed(niceMax, su);

  // Scale functions (operate in knots, convert at label time)
  const xS = t  => PAD.left + (t / totalSec) * CW;
  const yS = kn => PAD.top  + CH - Math.min(1, kn / niceMax) * CH;

  const uid = Math.random().toString(36).slice(2, 7);

  // ── Beaufort bands ────────────────────────────────────────────────
  let prevBand = 0;
  const beaufortBands = BEAUFORT.map(bf => {
    const bandBot = yS(prevBand);
    const bandTop = yS(Math.min(bf.max, niceMax));
    prevBand = bf.max;
    if (bandTop >= bandBot) return '';
    return `<rect x="${PAD.left}" y="${bandTop}"
                  width="${CW}" height="${bandBot - bandTop}"
                  fill="${bf.color}"/>`;
  }).join('');

  // ── Y-axis grid + labels ──────────────────────────────────────────
  const yTicks = 5;
  let yGridLines = '', yLabels = '';
  for (let i = 0; i <= yTicks; i++) {
    const kn = (niceMax / yTicks) * i;
    const y  = yS(kn);
    const lv = cvtSpeed(kn, su);
    const lbl = su === 'ms' ? lv.toFixed(1) : Math.round(lv).toString();
    yGridLines += `<line x1="${PAD.left}" y1="${y}" x2="${PAD.left + CW}" y2="${y}"
                         stroke="rgba(255,255,255,0.06)" stroke-width="1"/>`;
    yLabels += `<text x="${PAD.left - 6}" y="${y + 4}"
                      text-anchor="end" font-size="9" fill="rgba(125,176,204,0.7)"
                      font-family="monospace">${lbl}</text>`;
  }
  // Y-axis unit label (rotated)
  const yAxisLabel = `<text transform="rotate(-90)" x="${-(PAD.top + CH / 2)}" y="12"
                            text-anchor="middle" font-size="9.5" fill="rgba(0,212,170,0.6)"
                            font-family="monospace">${speedLbl(su)}</text>`;

  // ── X-axis labels ─────────────────────────────────────────────────
  const interval = xLabelInterval(totalSec);
  const useFullDate = totalSec > 86400; // show date if > 24 h
  let xLabels = '';
  for (let t = 0; t <= totalSec; t += interval) {
    const x   = xS(t);
    const dt  = new Date(departure.getTime() + t * 1000);
    const lbl = useFullDate ? fmtDDHH(dt) : fmtHHMM(dt);
    xLabels += `<text x="${x}" y="${H - PAD.bottom + 14}"
                      text-anchor="middle" font-size="8.5" fill="rgba(125,176,204,0.7)"
                      font-family="monospace">${lbl}</text>
                <line x1="${x}" y1="${PAD.top}" x2="${x}" y2="${PAD.top + CH + 4}"
                      stroke="rgba(255,255,255,0.06)" stroke-width="1"/>`;
  }

  // ── Wind speed area path ──────────────────────────────────────────
  const areaTop  = series.map(p => `${xS(p.elapsed).toFixed(1)},${yS(p.windSpeed).toFixed(1)}`).join(' ');
  const areaPath = `${PAD.left},${PAD.top + CH} `
                 + areaTop
                 + ` ${xS(totalSec).toFixed(1)},${PAD.top + CH}`;

  // ── Boat speed line path ──────────────────────────────────────────
  const boatPath = series.map((p, i) =>
    `${i === 0 ? 'M' : 'L'}${xS(p.elapsed).toFixed(1)},${yS(p.boatSpeed).toFixed(1)}`
  ).join(' ');

  // ── Wind speed line (top edge of area) ───────────────────────────
  const windLine = series.map((p, i) =>
    `${i === 0 ? 'M' : 'L'}${xS(p.elapsed).toFixed(1)},${yS(p.windSpeed).toFixed(1)}`
  ).join(' ');

  // ── Wind direction arrows (one per ~hour, along arrow lane top) ───
  const arrowInterval = Math.max(1, Math.round(3600 / (totalSec / series.length)));
  const arrowLaneY    = PAD.top - 12; // above chart area
  const arrowSize     = 9;
  let windArrows = '';

  // Sample one arrow per interval along the series
  let lastArrowT = -Infinity;
  const arrowEvery = Math.max(totalSec / 18, 900); // at most 18 arrows, at least every 15 min
  series.forEach(p => {
    if (p.elapsed - lastArrowT < arrowEvery) return;
    lastArrowT = p.elapsed;
    const ax = xS(p.elapsed);
    const ay = arrowLaneY;
    const deg = p.windDir; // FROM direction: arrow tail on that side, tip toward center
    const rad = d => d * Math.PI / 180;
    // Tail coords (where wind comes FROM) → tip toward 180° opposite
    const tx = ax + arrowSize * Math.sin(rad(deg));
    const ty = ay - arrowSize * Math.cos(rad(deg));
    // Arrow tip (opposite direction)
    const hx = ax - (arrowSize * 0.5) * Math.sin(rad(deg));
    const hy = ay + (arrowSize * 0.5) * Math.cos(rad(deg));
    windArrows += `<line x1="${tx.toFixed(1)}" y1="${ty.toFixed(1)}"
                         x2="${hx.toFixed(1)}" y2="${hy.toFixed(1)}"
                         stroke="#fbbf24" stroke-width="1.5" opacity="0.75"
                         marker-end="url(#wma-${uid})"/>`;
  });

  // ── Waypoint vertical lines ───────────────────────────────────────
  let wpLines = '';
  series.filter(p => p.isWaypoint && p.elapsed > 0).forEach(p => {
    const x = xS(p.elapsed);
    const isEnd = p.wpLabel === t('forecast.destination');
    const col = isEnd ? '#fbbf24' : '#38bdf8';
    wpLines += `<line x1="${x.toFixed(1)}" y1="${PAD.top - 16}"
                      x2="${x.toFixed(1)}" y2="${PAD.top + CH}"
                      stroke="${col}" stroke-width="1" stroke-dasharray="3,3" opacity="0.6"/>
                <text x="${x.toFixed(1)}" y="${PAD.top - 18}"
                      text-anchor="middle" font-size="8" fill="${col}"
                      font-family="monospace" opacity="0.85">${p.wpLabel ?? ''}</text>`;
  });

  // ── Chart frame ───────────────────────────────────────────────────
  const frame = `<rect x="${PAD.left}" y="${PAD.top}" width="${CW}" height="${CH}"
                       fill="none" stroke="rgba(0,212,170,0.15)" stroke-width="1"/>`;

  // ── Legend ────────────────────────────────────────────────────────
  const legX = PAD.left + CW - 160, legY = PAD.top + CH - 18;
  const legend = `
    <rect x="${legX - 4}" y="${legY - 9}" width="170" height="18"
          fill="rgba(0,8,20,0.6)" rx="3"/>
    <line x1="${legX}" y1="${legY}" x2="${legX + 16}" y2="${legY}"
          stroke="rgba(251,191,36,0.7)" stroke-width="2.5"/>
    <text x="${legX + 20}" y="${legY + 4}" font-size="8.5" fill="rgba(251,191,36,0.8)"
          font-family="monospace">${t('forecast.windSpeed')}</text>
    <line x1="${legX + 82}" y1="${legY}" x2="${legX + 98}" y2="${legY}"
          stroke="rgba(56,189,248,0.7)" stroke-width="1.5" stroke-dasharray="4,3"/>
    <text x="${legX + 102}" y="${legY + 4}" font-size="8.5" fill="rgba(56,189,248,0.8)"
          font-family="monospace">${t('forecast.boatSpeed')}</text>
  `;

  // ── Assemble ──────────────────────────────────────────────────────
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"
              style="width:100%;height:100%;display:block">
  <defs>
    <!-- Amber arrowhead for wind direction -->
    <marker id="wma-${uid}" markerWidth="4" markerHeight="4"
            refX="3.5" refY="2" orient="auto">
      <path d="M0,0 L4,2 L0,4 Z" fill="#fbbf24" opacity="0.8"/>
    </marker>
    <!-- Clip chart area -->
    <clipPath id="chart-clip-${uid}">
      <rect x="${PAD.left}" y="${PAD.top - 20}"
            width="${CW}" height="${CH + 20}"/>
    </clipPath>
    <!-- Amber gradient for wind area fill -->
    <linearGradient id="wind-grad-${uid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#fbbf24" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#fbbf24" stop-opacity="0.04"/>
    </linearGradient>
  </defs>

  <!-- Beaufort bands -->
  <g clip-path="url(#chart-clip-${uid})">${beaufortBands}</g>

  <!-- Grid lines -->
  ${yGridLines}

  <!-- Waypoint markers (behind the chart) -->
  <g clip-path="url(#chart-clip-${uid})">${wpLines}</g>

  <!-- Wind speed filled area -->
  <g clip-path="url(#chart-clip-${uid})">
    <polygon points="${areaPath}"
             fill="url(#wind-grad-${uid})"/>
    <path d="${windLine}"
          fill="none" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"
          stroke-linecap="round" opacity="0.9"/>
  </g>

  <!-- Boat speed line -->
  <g clip-path="url(#chart-clip-${uid})">
    <path d="${boatPath}"
          fill="none" stroke="#38bdf8" stroke-width="1.4" stroke-dasharray="5,4"
          stroke-linejoin="round" stroke-linecap="round" opacity="0.8"/>
  </g>

  <!-- Wind direction arrows (above chart) -->
  <g>${windArrows}</g>

  <!-- Chart frame -->
  ${frame}

  <!-- Axes labels -->
  ${yAxisLabel}
  ${yLabels}
  ${xLabels}

  <!-- Legend -->
  ${legend}
</svg>`;
}
