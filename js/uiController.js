/**
 * uiController.js
 * DOM manipulation: sidebar controls, wind widget, results panel,
 * leg cards, waypoint ETA list, loading states.
 * Includes unit conversion for speed (kn / m/s / km/h) and distance (NM / km).
 */

import { buildBoatCompassSVG } from './boatCompass.js';
import { t, getCurrentLanguage } from './i18n.js';

// ─── Unit Conversion ──────────────────────────────────────────────

/** Convert knots to the requested speed unit. */
export function convertSpeed(kn, unit) {
  if (unit === 'ms')  return kn * 0.514444;
  if (unit === 'kmh') return kn * 1.852;
  return kn; // 'kn' default
}

/** Convert nautical miles to the requested distance unit. */
export function convertDistance(nm, unit) {
  if (unit === 'km') return nm * 1.852;
  return nm; // 'nm' default
}

/** Human-readable label for speed unit. */
export function speedLabel(unit) {
  if (unit === 'ms')  return 'm/s';
  if (unit === 'kmh') return 'km/h';
  return 'kn';
}

/** Human-readable label for distance unit. */
export function distLabel(unit) {
  return unit === 'km' ? 'km' : 'NM';
}

/** Format a speed value with appropriate decimals for its unit. */
function fmtSpeed(kn, unit) {
  const v = convertSpeed(kn, unit);
  return unit === 'ms' ? v.toFixed(2) : v.toFixed(1);
}

/** Format a distance in NM with appropriate decimals. */
function fmtDist(nm, unit) {
  const v = convertDistance(nm, unit);
  return v < 10 ? v.toFixed(2) : v.toFixed(1);
}

// ─── Generic Formatters ────────────────────────────────────────────

export function formatDuration(seconds) {
  const totalMin = Math.round(seconds / 60);
  const days  = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins  = totalMin % 60;
  if (days > 0)  return `${days}${t('time.dayShort')} ${hours}${t('time.hourShort')} ${mins}${t('time.minuteShort')}`;
  if (hours > 0) return `${hours}${t('time.hourShort')} ${mins}${t('time.minuteShort')}`;
  return `${mins}${t('time.minuteShort')}`;
}

export function formatDateTime(date) {
  if (!(date instanceof Date) || isNaN(date)) return '—';
  const lang = getCurrentLanguage();
  return date.toLocaleString(lang, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

export function degreesToCompass(deg) {
  const dirs = [
    t('dir.n'), t('dir.nne'), t('dir.ne'), t('dir.ene'),
    t('dir.e'), t('dir.ese'), t('dir.se'), t('dir.sse'),
    t('dir.s'), t('dir.ssw'), t('dir.sw'), t('dir.wsw'),
    t('dir.w'), t('dir.wnw'), t('dir.nw'), t('dir.nnw')
  ];
  return dirs[Math.round(deg / 22.5) % 16];
}

function i18nFallback(key, fallback) {
  const translated = t(key);
  return translated === key ? fallback : translated;
}

// ─── Initialise UI ────────────────────────────────────────────────
/**
 * Wire up all sidebar controls.
 * @param {object} state
 * @param {object} callbacks { onBoatChange, onDepartureChange, onTackChange,
 *                             onCalculate, onClear, onUnitsChange }
 */
export function initUI(state, callbacks) {
  // ── Departure: separate date + time inputs (Fix #5) ──────────────
  const dateInput = document.getElementById('departure-date');
  const timeInput = document.getElementById('departure-time-input');

  function syncDeparture() {
    const d = dateInput.value;
    const t = timeInput.value || '00:00';
    if (!d) return;
    const dt = new Date(`${d}T${t}`);
    if (!isNaN(dt)) {
      state.departureTime = dt;
      callbacks.onDepartureChange(dt);
    }
  }

  dateInput.addEventListener('change', syncDeparture);
  timeInput.addEventListener('change', syncDeparture);

  // ── Boat selector ─────────────────────────────────────────────────
  document.getElementById('boat-select').addEventListener('change', e => {
    state.selectedBoat = e.target.value;
    callbacks.onBoatChange(e.target.value);
  });

  // ── Tacking buttons ───────────────────────────────────────────────
  document.querySelectorAll('.tack-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tack-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.tackFrequency = btn.dataset.value;
      callbacks.onTackChange(btn.dataset.value);
    });
  });

  // ── Unit toggles (Fix #6) ─────────────────────────────────────────
  document.querySelectorAll('#speed-unit-toggle .unit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#speed-unit-toggle .unit-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.units.speed = btn.dataset.unit;
      callbacks.onUnitsChange(state.units);
    });
  });

  document.querySelectorAll('#dist-unit-toggle .unit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#dist-unit-toggle .unit-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.units.distance = btn.dataset.unit;
      callbacks.onUnitsChange(state.units);
    });
  });

  // ── Calculate ─────────────────────────────────────────────────────
  document.getElementById('calculate-btn').addEventListener('click', callbacks.onCalculate);

  // ── Clear ─────────────────────────────────────────────────────────
  document.getElementById('clear-btn').addEventListener('click', callbacks.onClear);

  // ── Close results panel ────────────────────────────────────────────
  document.getElementById('close-panel-btn').addEventListener('click', () => {
    document.getElementById('results-panel').classList.remove('visible');
  });
}

// ─── Boat Selector ────────────────────────────────────────────────
export function populateBoatSelector(boats, selectedKey) {
  const sel = document.getElementById('boat-select');
  sel.innerHTML = '';
  Object.entries(boats).forEach(([key, boat]) => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = i18nFallback(`boats.${key}.name`, boat.name);
    if (key === selectedKey) opt.selected = true;
    sel.appendChild(opt);
  });
  updateBoatSpecs(boats[selectedKey], selectedKey);
}

export function updateBoatSpecs(boat, boatKey = null) {
  const el = document.getElementById('boat-specs');
  if (!boat) { el.classList.add('hidden'); return; }

  const maxPct  = Math.max(...boat.polars.map(p => p.speedPercent));
  const peakAng = boat.polars.find(p => p.speedPercent === maxPct)?.angle ?? '—';

  const description = boatKey
    ? i18nFallback(`boats.${boatKey}.description`, boat.description ?? '')
    : (boat.description ?? '');

  el.innerHTML = `
    <div class="spec-chip">
      <span class="spec-chip-label">${t('boat.noGoZone')}</span>
      <span class="spec-chip-value">&lt; ${boat.minTackAngle}°</span>
    </div>
    <div class="spec-chip">
      <span class="spec-chip-label">${t('boat.bestAngle')}</span>
      <span class="spec-chip-value">${peakAng}° ${t('boat.twa')}</span>
    </div>
    <div class="spec-chip" style="grid-column:1/-1">
      <span class="spec-chip-label">${t('boat.description')}</span>
      <span class="spec-chip-value" style="font-size:11px;font-weight:400;color:var(--text-1)">${description}</span>
    </div>
  `;
  el.classList.remove('hidden');
}

// ─── Wind Widget ──────────────────────────────────────────────────
/**
 * Update sidebar wind compass and readings.
 * @param {{ windSpeed, windDirection, windGusts }} wx   (always in knots from API)
 * @param {{ speed: string }}                       units
 */
export function updateWindWidget(wx, units = { speed: 'kn' }) {
  const section = document.getElementById('wind-section');
  if (!wx) { section.style.display = 'none'; return; }
  section.style.display = '';

  const spd = convertSpeed(wx.windSpeed, units.speed);
  const gst = convertSpeed(wx.windGusts, units.speed);
  const dec = units.speed === 'ms' ? 2 : 1;

  document.getElementById('w-speed').textContent     = spd.toFixed(dec);
  document.getElementById('w-dir').textContent       = wx.windDirection.toFixed(0);
  document.getElementById('w-gusts').textContent     = gst.toFixed(dec);
  document.getElementById('w-speed-unit').textContent = speedLabel(units.speed);
  document.getElementById('w-gusts-unit').textContent = speedLabel(units.speed);

  const arrowGroup = document.getElementById('wind-arrow-group');
  if (arrowGroup) {
    arrowGroup.setAttribute('transform', `rotate(${wx.windDirection}, 40, 40)`);
  }
}

// ─── Waypoint Counter ─────────────────────────────────────────────
export function updateWaypointCounter(count) {
  const el = document.getElementById('wp-count-label');
  if (count === 0) {
    el.textContent = t('waypoints.none');
  } else if (count === 1) {
    el.textContent = t('waypoints.one');
  } else {
    el.textContent = t('waypoints.many', { count });
  }
}

// ─── Calculate Button State ───────────────────────────────────────
export function setCalculateEnabled(enabled) {
  document.getElementById('calculate-btn').disabled = !enabled;
}

// ─── Loading State ────────────────────────────────────────────────
export function showLoading(message = t('loading.computing')) {
  const overlay = document.getElementById('loading-overlay');
  document.getElementById('loading-text').textContent = message;
  overlay.classList.add('visible');
}

export function hideLoading() {
  document.getElementById('loading-overlay').classList.remove('visible');
}

// ─── Map Hint ─────────────────────────────────────────────────────
export function hideMapHint() {
  const hint = document.getElementById('map-hint');
  hint.classList.add('fade-out');
  setTimeout(() => hint.style.display = 'none', 400);
}

// ─── Waypoint Tooltip (Fix #4) ────────────────────────────────────
/**
 * Show the floating tooltip near the mouse with waypoint info + boat compass.
 * @param {object}     wp          { lat, lon }
 * @param {object}     wx          Wind data at that point (knots) — null if not yet fetched
 * @param {number}     index       Waypoint index (0 = start)
 * @param {number}     total       Total waypoints
 * @param {object}     units       Current { speed, distance }
 * @param {MouseEvent} domEvent    Native mouse event for position
 * @param {number}     [boatHeading=0]  Compass bearing the boat is heading (degrees)
 */
export function showWaypointTooltip(wp, wx, index, total, units, domEvent, boatHeading = 0) {
  const tooltip = document.getElementById('wp-tooltip');
  const header  = tooltip.querySelector('.wpt-header');
  const body    = tooltip.querySelector('.wpt-body');

  const label = index === 0
    ? `⚓ ${t('tooltip.start')}`
    : index === total - 1
      ? t('tooltip.destination', { index })
      : t('tooltip.waypoint', { index });
  header.textContent = label;

  const windFromDeg = wx ? wx.windDirection : 270;
  const compassSVG  = buildBoatCompassSVG(windFromDeg, boatHeading);

  const windLine = wx
    ? `<div class="wpt-row"><span>${t('tooltip.wind')}</span><strong>${fmtSpeed(wx.windSpeed, units.speed)} ${speedLabel(units.speed)} / ${wx.windDirection.toFixed(0)}° (${degreesToCompass(wx.windDirection)})</strong></div>
       <div class="wpt-row"><span>${t('tooltip.gusts')}</span><strong>${fmtSpeed(wx.windGusts, units.speed)} ${speedLabel(units.speed)}</strong></div>`
    : `<div class="wpt-row"><span>${t('tooltip.wind')}</span><strong>${t('tooltip.loading')}</strong></div>`;

  body.innerHTML = `
    <div class="wpt-compass">${compassSVG}</div>
    <div class="wpt-row"><span>${t('tooltip.lat')}</span><strong>${wp.lat.toFixed(5)}°</strong></div>
    <div class="wpt-row"><span>${t('tooltip.lon')}</span><strong>${wp.lon.toFixed(5)}°</strong></div>
    ${windLine}
  `;

  // Position tooltip relative to map-wrapper
  const mapWrapper = document.getElementById('map-wrapper');
  const rect = mapWrapper.getBoundingClientRect();
  const x = domEvent.clientX - rect.left;
  const y = domEvent.clientY - rect.top;

  // Flip to left if too close to right edge
  const TW = 200;
  if (x + TW + 20 > rect.width) {
    tooltip.style.left = (x - TW - 14) + 'px';
    tooltip.style.transform = 'translate(0, -50%)';
  } else {
    tooltip.style.left = x + 'px';
    tooltip.style.transform = 'translate(14px, -50%)';
  }
  tooltip.style.top = y + 'px';
  tooltip.classList.add('visible');
}

export function hideWaypointTooltip() {
  document.getElementById('wp-tooltip').classList.remove('visible');
}

// ─── Results Panel ────────────────────────────────────────────────
/**
 * Populate and reveal the results panel.
 * @param {object} result
 * @param {Date}   departureTime
 * @param {object} units  { speed: string, distance: string }
 */
export function showResultsPanel(result, departureTime, units) {
  const { speed: su, distance: du } = units;

  // ── Summary stats ─────────────────────────────────────────────────
  const distNM   = result.totalDistanceNM;
  const totalH   = result.totalTimeSeconds / 3600;
  const avgSpdKn = totalH > 0 ? (result.totalActualDistanceNM / totalH) : 0;

  document.getElementById('stat-distance').textContent      = fmtDist(distNM, du);
  document.getElementById('stat-distance-unit').textContent = distLabel(du);
  document.getElementById('stat-time').textContent          = formatDuration(result.totalTimeSeconds);
  document.getElementById('stat-speed').textContent         = fmtSpeed(avgSpdKn, su);
  document.getElementById('stat-speed-unit').textContent    = speedLabel(su);
  document.getElementById('stat-eta').textContent           = formatDateTime(result.arrivalTime);

  // ── Leg breakdown ─────────────────────────────────────────────────
  const legList = document.getElementById('leg-list');
  legList.innerHTML = '';

  result.segments.forEach((seg, i) => {
    const card = document.createElement('div');
    card.className = 'leg-card';

    const dNM   = fmtDist(seg.directDistance / 1852, du);
    const aNM   = fmtDist(seg.actualDistance / 1852, du);
    const tStr  = formatDuration(seg.timeSeconds);
    const spdStr = fmtSpeed(seg.avgBoatSpeed, su);
    const startWx = seg.startWeather ?? { windSpeed: 0, windDirection: 0 };
    const wxSpeed = Number.isFinite(startWx.windSpeed) ? startWx.windSpeed : 0;
    const wxDir   = Number.isFinite(startWx.windDirection) ? startWx.windDirection : 0;
    const wndStr = `${fmtSpeed(wxSpeed, su)} ${speedLabel(su)} ${degreesToCompass(wxDir)}`;
    const directTWA = Number.isFinite(seg.directTWA) ? seg.directTWA : 0;
    const badge = seg.needsTacking
      ? `<span class="leg-badge tacking">⚡ ${t('results.badgeTacking')}</span>`
      : `<span class="leg-badge direct">→ ${t('results.badgeDirect')}</span>`;

    card.innerHTML = `
      <div class="leg-card-header">
        <span class="leg-title">${t('results.legTitle', { leg: i + 1, wp: i + 1 })}</span>
        ${badge}
      </div>
      <div class="leg-stats">
        <div class="ls-item">
          <span class="ls-label">${t('results.direct')}</span>
          <span class="ls-value">${dNM} ${distLabel(du)}</span>
        </div>
        <div class="ls-item">
          <span class="ls-label">${t('results.sailed')}</span>
          <span class="ls-value">${aNM} ${distLabel(du)}</span>
        </div>
        <div class="ls-item">
          <span class="ls-label">${t('results.time')}</span>
          <span class="ls-value">${tStr}</span>
        </div>
        <div class="ls-item">
          <span class="ls-label">${t('results.avgSpeed')}</span>
          <span class="ls-value">${spdStr} ${speedLabel(su)}</span>
        </div>
        <div class="ls-item">
          <span class="ls-label">${t('results.wind')}</span>
          <span class="ls-value">${wndStr}</span>
        </div>
        <div class="ls-item">
          <span class="ls-label">${t('results.twa')}</span>
          <span class="ls-value">${directTWA.toFixed(0)}°</span>
        </div>
      </div>
    `;

    legList.appendChild(card);
  });

  // ── Waypoint ETAs ─────────────────────────────────────────────────
  const etaList = document.getElementById('wp-eta-list');
  etaList.innerHTML = '';

  etaList.appendChild(makeEtaItem(`⚓ ${t('results.start')}`, departureTime, 'start-dot'));

  result.waypointETAs.forEach((eta, i) => {
    const isLast = i === result.waypointETAs.length - 1;
    const label  = isLast
      ? `WP ${i + 1} - ${t('results.destination')}`
      : t('forecast.wp', { index: i + 1 });
    etaList.appendChild(makeEtaItem(label, eta, isLast ? 'dest' : ''));
  });

  document.getElementById('results-panel').classList.add('visible');
}

function makeEtaItem(label, time, dotClass = '') {
  const el = document.createElement('div');
  el.className = 'wp-eta-item';
  el.innerHTML = `
    <div class="wp-eta-dot ${dotClass}"></div>
    <span class="wp-eta-label">${label}</span>
    <span class="wp-eta-time">${formatDateTime(time)}</span>
  `;
  return el;
}

// ─── Re-render results with new units (Fix #6) ────────────────────
/**
 * Called when units change while the results panel is already visible.
 * Re-populates the panel with converted values.
 */
export function refreshResultsUnits(result, departureTime, units) {
  if (!result) return;
  const panel = document.getElementById('results-panel');
  if (!panel.classList.contains('visible')) return;
  showResultsPanel(result, departureTime, units);
}

// ─── Reset Results ────────────────────────────────────────────────
export function hideResultsPanel() {
  document.getElementById('results-panel').classList.remove('visible');
}

// ─── Forecast Strip ───────────────────────────────────────────────
import { extractTimeSeries, buildForecastSVG } from './forecastChart.js';

/** Build and show the forecast strip with a wind chart. */
export function showForecastStrip(routeResult, departureTime, units) {
  const strip = document.getElementById('forecast-strip');
  const chart = document.getElementById('forecast-chart');
  if (!strip || !chart || !routeResult) return;

  // Attach toggle listener once
  if (!strip._toggleBound) {
    const btn = document.getElementById('forecast-toggle');
    btn?.addEventListener('click', () => {
      const open = strip.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
    });
    strip._toggleBound = true;
  }

  const series = extractTimeSeries(routeResult, departureTime);
  chart.innerHTML = buildForecastSVG(series, departureTime, units);

  strip.classList.add('ready');

  // Auto-open on first show
  if (!strip.classList.contains('open')) {
    strip.classList.add('open');
    const btn = document.getElementById('forecast-toggle');
    if (btn) btn.setAttribute('aria-expanded', 'true');
  }
}

/** Hide and reset the forecast strip. */
export function hideForecastStrip() {
  const strip = document.getElementById('forecast-strip');
  if (!strip) return;
  strip.classList.remove('ready', 'open');
  const chart = document.getElementById('forecast-chart');
  if (chart) chart.innerHTML = '';
}

/** Re-render the chart when units change (if strip is visible). */
export function refreshForecastUnits(routeResult, departureTime, units) {
  const strip = document.getElementById('forecast-strip');
  if (!strip?.classList.contains('ready')) return;
  showForecastStrip(routeResult, departureTime, units);
}
