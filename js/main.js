/**
 * main.js
 * Application entry point.
 * Owns app state and orchestrates mapModule, weatherApi,
 * routingMath, and uiController.
 *
 * Fixes applied:
 *  #3 — Right-click on waypoint deletes it and all following
 *  #4 — Hover tooltip with coordinates + forecast wind
 *  #5 — Departure read from separate date + time inputs
 *  #6 — Unit conversion state; results re-render on unit change
 */

import {
  initMap, addWaypointMarker, redrawMarkers,
  drawDirectRoute, renderRouteResult,
  clearAllLayers, clearRouteLayers,
  fitToWaypoints, getMarkerList
} from './mapModule.js';

import { fetchWeather, getCurrentWind, clearWeatherCache } from './weatherApi.js';

import { calculateFullRoute } from './routingMath.js';

import {
  initUI, populateBoatSelector, updateBoatSpecs,
  updateWindWidget, updateWaypointCounter, setCalculateEnabled,
  showLoading, hideLoading, hideMapHint,
  showResultsPanel, hideResultsPanel, refreshResultsUnits,
  showWaypointTooltip, hideWaypointTooltip,
  showForecastStrip, hideForecastStrip, refreshForecastUnits
} from './uiController.js';
import { initI18n, t } from './i18n.js';
import { initRouteExport, setExportEnabled, closeExportModal } from './routeExport.js';

// ══════════════════════════════════════════════════════════════════
// APP STATE
// ══════════════════════════════════════════════════════════════════
const state = {
  waypoints:      [],          // { lat, lon }
  markers:        [],          // Leaflet marker instances (parallel to waypoints)
  boats:          {},
  selectedBoat:   'sailboat',
  departureTime:  new Date(),
  tackFrequency:  'medium',
  weatherCache:   new Map(),   // "lat,lon" → API response
  routeResult:    null,
  isCalculating:  false,
  hintDismissed:  false,
  units: {
    speed:    'kn',   // 'kn' | 'ms' | 'kmh'
    distance: 'nm'    // 'nm' | 'km'
  }
};

// ══════════════════════════════════════════════════════════════════
// BOOT
// ══════════════════════════════════════════════════════════════════
async function init() {
  await initI18n();

  // Load vessel profiles
  let boats;
  try {
    const r = await fetch('./data/boats.json');
    boats = await r.json();
  } catch (e) {
    console.warn('Could not load boats.json, using fallback data.', e);
    boats = FALLBACK_BOATS;
  }
  state.boats       = boats;
  state.selectedBoat = Object.keys(boats)[0];

  // Default departure: now + 1 h, rounded to whole hour
  const now = new Date();
  now.setHours(now.getHours() + 1, 0, 0, 0);
  state.departureTime = now;

  // Fill split date + time inputs (Fix #5)
  const yyyy = now.getFullYear();
  const mm   = String(now.getMonth() + 1).padStart(2, '0');
  const dd   = String(now.getDate()).padStart(2, '0');
  const hh   = String(now.getHours()).padStart(2, '0');
  const min  = String(now.getMinutes()).padStart(2, '0');
  document.getElementById('departure-date').value        = `${yyyy}-${mm}-${dd}`;
  document.getElementById('departure-time-input').value  = `${hh}:${min}`;

  // Wire controls
  initUI(state, {
    onBoatChange:      handleBoatChange,
    onDepartureChange: t => { state.departureTime = t; },
    onTackChange:      v => { state.tackFrequency = v; },
    onCalculate:       handleCalculate,
    onClear:           handleClear,
    onUnitsChange:     handleUnitsChange  // Fix #6
  });

  populateBoatSelector(state.boats, state.selectedBoat);

  // Initialise Leaflet map
  initMap('map', { onMapClick: handleMapClick });

  initRouteExport({
    getData: () => {
      if (!state.routeResult || state.waypoints.length < 2) return null;
      const boat = state.boats[state.selectedBoat];
      return {
        routeResult: state.routeResult,
        waypoints: state.waypoints,
        boatKey: state.selectedBoat,
        boatName: boat?.name ?? state.selectedBoat,
        departureTime: state.departureTime,
        units: state.units
      };
    }
  });

  // Re-render dynamic text fragments whenever language changes.
  window.addEventListener('i18n:changed', handleLanguageChange);
}

// ══════════════════════════════════════════════════════════════════
// MAP CLICK — Add waypoint
// ══════════════════════════════════════════════════════════════════
function handleMapClick(latlng) {
  if (state.isCalculating) return;

  if (!state.hintDismissed) {
    hideMapHint();
    state.hintDismissed = true;
  }

  const wp  = { lat: latlng.lat, lon: latlng.lng };
  const idx = state.waypoints.length;          // capture index now (before push)
  state.waypoints.push(wp);

  const total  = state.waypoints.length;
  const marker = addWaypointMarker(latlng, idx, total);

  // ── FIX #3: right-click deletes this waypoint + all following ──
  marker.on('contextmenu', e => {
    e.originalEvent.preventDefault();
    L.DomEvent.stopPropagation(e);
    handleDeleteFromIndex(idx);
  });

  // ── FIX #4: hover tooltip with coordinates + wind + compass ───────
  marker.on('mouseover', e => {
    const wx = getWeatherForWaypoint(wp);
    const hdg = getWaypointHeading(idx);
    showWaypointTooltip(wp, wx, idx, state.waypoints.length, state.units, e.originalEvent, hdg);
  });

  marker.on('mousemove', e => {
    const wx = getWeatherForWaypoint(wp);
    const hdg = getWaypointHeading(idx);
    showWaypointTooltip(wp, wx, idx, state.waypoints.length, state.units, e.originalEvent, hdg);
  });

  marker.on('mouseout', () => hideWaypointTooltip());

  state.markers.push(marker);

  updateWaypointCounter(total);
  setCalculateEnabled(total >= 2);

  // Live preview polyline
  if (total >= 2) {
    clearRouteLayers();
    drawDirectRoute(state.waypoints.map(w => [w.lat, w.lon]));
  }

  // Pre-fetch weather in background
  prefetchWeather(wp.lat, wp.lon);
}

// ══════════════════════════════════════════════════════════════════
// FIX #3 — Delete waypoint from index to end
// ══════════════════════════════════════════════════════════════════
function handleDeleteFromIndex(fromIdx) {
  // Remove markers from map
  for (let i = fromIdx; i < state.markers.length; i++) {
    state.markers[i].remove();
  }

  // Truncate state arrays
  state.waypoints.splice(fromIdx);
  state.markers.splice(fromIdx);

  const total = state.waypoints.length;
  updateWaypointCounter(total);
  setCalculateEnabled(total >= 2);

  // Redraw the preview route with remaining points
  clearRouteLayers();
  if (total >= 2) {
    drawDirectRoute(state.waypoints.map(w => [w.lat, w.lon]));
  }

  // If results panel was open, hide it (route is stale)
  if (state.routeResult) {
    state.routeResult = null;
    hideResultsPanel();
    hideForecastStrip();
    closeExportModal();
    setExportEnabled(false);
  }

  hideWaypointTooltip();
}

// ══════════════════════════════════════════════════════════════════
// BOAT CHANGE
// ══════════════════════════════════════════════════════════════════
function handleBoatChange(key) {
  state.selectedBoat = key;
  updateBoatSpecs(state.boats[key], key);
}

function handleLanguageChange() {
  populateBoatSelector(state.boats, state.selectedBoat);
  updateWaypointCounter(state.waypoints.length);

  if (state.waypoints.length > 0) {
    const wx = getWeatherForWaypoint(state.waypoints[0]);
    if (wx) updateWindWidget(wx, state.units);
  }

  refreshResultsUnits(state.routeResult, state.departureTime, state.units);
  refreshForecastUnits(state.routeResult, state.departureTime, state.units);
}

// ══════════════════════════════════════════════════════════════════
// FIX #6 — Units change
// ══════════════════════════════════════════════════════════════════
function handleUnitsChange(units) {
  state.units = { ...units };

  // Update wind widget display
  if (state.waypoints.length > 0) {
    const wx = getWeatherForWaypoint(state.waypoints[0]);
    if (wx) updateWindWidget(wx, state.units);
  }

  // Re-render results panel + forecast if open
  refreshResultsUnits(state.routeResult, state.departureTime, state.units);
  refreshForecastUnits(state.routeResult, state.departureTime, state.units);
}

// ══════════════════════════════════════════════════════════════════
// CALCULATE
// ══════════════════════════════════════════════════════════════════
async function handleCalculate() {
  if (state.waypoints.length < 2 || state.isCalculating) return;
  state.isCalculating = true;

  try {
    // ── 1. Fetch weather for all waypoints ──────────────────────────
    const weatherData = [];

    for (let i = 0; i < state.waypoints.length; i++) {
      const { lat, lon } = state.waypoints[i];
      const key = cacheKey(lat, lon);

      let wx = state.weatherCache.get(key);
      if (!wx) {
        showLoading(t('loading.fetchingWind', { current: i + 1, total: state.waypoints.length }));
        try {
          wx = await fetchWeather(lat, lon);
          state.weatherCache.set(key, wx);
        } catch (err) {
          console.error(t('messages.weatherFetchFailed', { index: i + 1 }), err);
          wx = null;
        }
      }
      weatherData.push(wx);
    }

    // ── 2. Update wind widget with start-point current wind ─────────
    if (weatherData[0]) {
      const wx = getCurrentWind(weatherData[0]);
      updateWindWidget(wx, state.units);
    }

    // ── 3. Run routing maths ────────────────────────────────────────
    showLoading(t('loading.routeWithTacking'));

    const boat   = state.boats[state.selectedBoat];
    const coords = state.waypoints.map(wp => [wp.lat, wp.lon]);

    const result = calculateFullRoute(
      coords, weatherData, boat,
      state.departureTime, state.tackFrequency
    );

    state.routeResult = result;

    // ── 4. Render on map (non-blocking for results panel) ───────────
    showLoading(t('loading.renderingRoute'));
    try {
      redrawMarkers(state.waypoints);
      renderRouteResult(result);
      fitToWaypoints(state.waypoints);

      // Re-attach marker events after redrawMarkers (markers are recreated)
      reattachMarkerEvents();
    } catch (mapErr) {
      console.error('Map render failed, continuing with results panel:', mapErr);
    }

    // ── 5. Show results panel + forecast strip ──────────────────────
    showResultsPanel(result, state.departureTime, state.units);
    setExportEnabled(true);
    try {
      showForecastStrip(result, state.departureTime, state.units);
    } catch (forecastErr) {
      console.error('Forecast strip render failed:', forecastErr);
    }

  } catch (err) {
    console.error('Route calculation failed:', err);
    alert(t('messages.routeCalcFailed', { error: err.message }));
  } finally {
    state.isCalculating = false;
    hideLoading();
  }
}

/**
 * After redrawMarkers(), re-attach contextmenu & hover events
 * because all Leaflet marker instances are replaced.
 */
function reattachMarkerEvents() {
  const newMarkers = getMarkerList();
  state.markers = newMarkers;

  newMarkers.forEach((marker, idx) => {
    const wp = state.waypoints[idx];
    if (!wp) return;

    marker.on('contextmenu', e => {
      e.originalEvent.preventDefault();
      L.DomEvent.stopPropagation(e);
      handleDeleteFromIndex(idx);
    });

    marker.on('mouseover', e => {
      const wx  = getWeatherForWaypoint(wp);
      const hdg = getWaypointHeading(idx);
      showWaypointTooltip(wp, wx, idx, state.waypoints.length, state.units, e.originalEvent, hdg);
    });
    marker.on('mousemove', e => {
      const wx  = getWeatherForWaypoint(wp);
      const hdg = getWaypointHeading(idx);
      showWaypointTooltip(wp, wx, idx, state.waypoints.length, state.units, e.originalEvent, hdg);
    });
    marker.on('mouseout', () => hideWaypointTooltip());
  });
}

// ══════════════════════════════════════════════════════════════════
// CLEAR
// ══════════════════════════════════════════════════════════════════
function handleClear() {
  state.waypoints   = [];
  state.markers     = [];
  state.routeResult = null;
  clearAllLayers();
  clearWeatherCache();
  state.weatherCache.clear();
  updateWaypointCounter(0);
  setCalculateEnabled(false);
  hideResultsPanel();
  hideForecastStrip();
  closeExportModal();
  setExportEnabled(false);
  updateWindWidget(null);
  hideWaypointTooltip();

  // Re-show hint bubble
  const hint = document.getElementById('map-hint');
  hint.style.display = '';
  hint.classList.remove('fade-out');
  state.hintDismissed = false;
}

// ══════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════
function cacheKey(lat, lon) {
  return `${lat.toFixed(3)},${lon.toFixed(3)}`;
}

/**
 * Compute the compass bearing a boat at waypoint `idx` would be heading.
 * Uses bearing toward the next waypoint; falls back to bearing from the
 * previous one; falls back to 0 (north) if only one point exists.
 */
function getWaypointHeading(idx) {
  const wps = state.waypoints;
  if (wps.length < 2) return 0;
  if (idx < wps.length - 1) {
    return calcBearing(wps[idx].lat, wps[idx].lon, wps[idx + 1].lat, wps[idx + 1].lon);
  }
  if (idx > 0) {
    return calcBearing(wps[idx - 1].lat, wps[idx - 1].lon, wps[idx].lat, wps[idx].lon);
  }
  return 0;
}

/** Inline forward azimuth — avoids re-importing routingMath just for this. */
function calcBearing(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI / 180;
  const toDeg = r => r * 180 / Math.PI;
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((toDeg(Math.atan2(y, x)) % 360) + 360) % 360;
}

/** Get current wind for a waypoint from cache (null if not yet fetched). */
function getWeatherForWaypoint(wp) {
  const raw = state.weatherCache.get(cacheKey(wp.lat, wp.lon));
  if (!raw) return null;
  return getCurrentWind(raw);
}

async function prefetchWeather(lat, lon) {
  const key = cacheKey(lat, lon);
  if (state.weatherCache.has(key)) {
    if (state.waypoints.length === 1) {
      const wx = getCurrentWind(state.weatherCache.get(key));
      updateWindWidget(wx, state.units);
    }
    return;
  }

  try {
    const raw = await fetchWeather(lat, lon);
    state.weatherCache.set(key, raw);
    if (state.waypoints.length === 1 && raw) {
      updateWindWidget(getCurrentWind(raw), state.units);
    }
  } catch (e) {
    console.warn('Background weather prefetch failed:', e);
  }
}

// ══════════════════════════════════════════════════════════════════
// FALLBACK BOAT DATA
// ══════════════════════════════════════════════════════════════════
const FALLBACK_BOATS = {
  sailboat: {
    name: 'Cruising Sailboat', description: 'All-purpose cruiser',
    minTackAngle: 45,
    polars: [
      { angle: 45,  speedPercent: 0.60 }, { angle: 75,  speedPercent: 0.88 },
      { angle: 90,  speedPercent: 0.92 }, { angle: 110, speedPercent: 0.96 },
      { angle: 150, speedPercent: 0.82 }, { angle: 180, speedPercent: 0.65 }
    ]
  },
  yacht: {
    name: 'Racing Yacht', description: 'High-performance racer',
    minTackAngle: 35,
    polars: [
      { angle: 35,  speedPercent: 0.75 }, { angle: 70,  speedPercent: 1.05 },
      { angle: 90,  speedPercent: 1.10 }, { angle: 135, speedPercent: 1.05 },
      { angle: 180, speedPercent: 0.78 }
    ]
  },
  catamaran: {
    name: 'Catamaran', description: 'Fast multihull',
    minTackAngle: 50,
    polars: [
      { angle: 50,  speedPercent: 0.70 }, { angle: 90,  speedPercent: 1.20 },
      { angle: 110, speedPercent: 1.35 }, { angle: 180, speedPercent: 0.85 }
    ]
  }
};

// ══════════════════════════════════════════════════════════════════
// BOOT
// ══════════════════════════════════════════════════════════════════
init().catch(err => {
  console.error('SailNav init failed:', err);
  document.body.innerHTML = `<div style="color:#f87171;padding:40px;font-family:monospace">
    ❌ ${t('messages.initFailed', { error: err.message })}<br><br>
    ${t('messages.serveHttp')}<br>
    ${t('messages.tryServe', { option1: 'npx serve .', option2: 'python3 -m http.server 8080' })}
  </div>`;
});
