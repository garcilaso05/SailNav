/**
 * mapModule.js
 * Leaflet map initialisation, waypoint markers, route rendering,
 * tacking polylines, and 200 m chunk dot visualisation.
 */

import { t } from './i18n.js';

let map = null;
let markerLayer   = null; // L.LayerGroup for all waypoint markers
let routeLayer    = null; // L.LayerGroup for all route lines & dots
let popupRef      = null; // Currently open popup
let _markerList   = [];   // FIX #3/#4: kept in sync for reattachMarkerEvents

// ─── Init ──────────────────────────────────────────────────────────
/**
 * Initialise the Leaflet map inside `containerId`.
 *
 * @param {string}   containerId  ID of the <div> for the map
 * @param {object}   opts
 * @param {Function} opts.onMapClick  Called with {lat, lng} on map click
 */
export function initMap(containerId, { onMapClick }) {
  map = L.map(containerId, {
    center:           [40.0, 5.0],
    zoom:             6,
    zoomControl:      false,
    attributionControl: false
  });

  // Dark nautical tile layer (CartoDB Dark Matter)
  L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com">CARTO</a>',
      subdomains:  'abcd',
      maxZoom:     19,
      crossOrigin: true
    }
  ).addTo(map);

  // Attribution control — styled via CSS
  L.control.attribution({ position: 'bottomright', prefix: false }).addTo(map);

  markerLayer = L.layerGroup().addTo(map);
  routeLayer  = L.layerGroup().addTo(map);

  // Map click handler
  map.on('click', e => onMapClick(e.latlng));

  return map;
}

// ─── Waypoint Markers ──────────────────────────────────────────────
/**
 * Add a styled numbered waypoint marker to the map.
 *
 * @param {{ lat: number, lng: number }} latlng
 * @param {number} index   0-based index (0 = start anchor)
 * @param {number} total   Total waypoints currently in list
 */
export function addWaypointMarker(latlng, index, total) {
  const isStart = index === 0;
  const label   = isStart ? '⚓' : index.toString();
  const cls     = isStart ? 'start' : (index === total - 1 && total > 1 ? 'end' : '');

  const icon = L.divIcon({
    className: '',
    html:      `<div class="wp-marker ${cls}">${label}</div>`,
    iconSize:  isStart ? [38, 38] : [34, 34],
    iconAnchor: isStart ? [19, 19] : [17, 17]
  });

  const marker = L.marker([latlng.lat, latlng.lng], { icon, interactive: true })
    .addTo(markerLayer);

  _markerList.push(marker);
  return marker;
}

/**
 * Re-render all waypoint markers (used after calculation to apply final styling).
 *
 * @param {Array<{lat,lon}>} waypoints
 */
export function redrawMarkers(waypoints) {
  markerLayer.clearLayers();
  _markerList = [];
  waypoints.forEach((wp, i) => {
    addWaypointMarker({ lat: wp.lat, lng: wp.lon }, i, waypoints.length);
  });
}

/** Return the current internal marker list (used by main.js after redrawMarkers). */
export function getMarkerList() {
  return [..._markerList];
}

// ─── Route Drawing ─────────────────────────────────────────────────
/**
 * Draw a direct route polyline between an array of [lat, lon] points.
 *
 * @param {Array<{lat,lon}|[lat,lon]>} waypoints
 */
export function drawDirectRoute(waypoints) {
  const lls = waypoints.map(wp =>
    Array.isArray(wp) ? wp : [wp.lat, wp.lon]
  );
  L.polyline(lls, {
    color:   '#38bdf8',
    weight:  2.5,
    opacity: 0.75,
    dashArray: null
  }).addTo(routeLayer);
}

/**
 * Draw a tacking (zig-zag) segment in amber.
 *
 * @param {Array<[lat,lon]>} pts  Output of generateTackingRoute()
 */
export function drawTackingSegment(pts) {
  L.polyline(pts, {
    color:     '#fbbf24',
    weight:    2,
    opacity:   0.85,
    dashArray: '8, 5'
  }).addTo(routeLayer);
}

/**
 * Draw tiny cyan dots at each 200 m chunk boundary for visual debugging.
 *
 * @param {Array<[lat,lon]>} points
 */
export function drawChunkDots(points) {
  points.forEach(([lat, lon]) => {
    L.circleMarker([lat, lon], {
      radius:      2.5,
      color:       'transparent',
      fillColor:   '#00d4aa',
      fillOpacity: 0.5,
      weight:      0
    }).addTo(routeLayer);
  });
}

// ─── Layer Management ──────────────────────────────────────────────
/**
 * Clear all route layers (polylines, dots). Keeps markers.
 */
export function clearRouteLayers() {
  if (routeLayer) routeLayer.clearLayers();
}

/**
 * Clear everything: markers + routes.
 */
export function clearAllLayers() {
  if (markerLayer) markerLayer.clearLayers();
  if (routeLayer)  routeLayer.clearLayers();
  if (popupRef) { map.closePopup(); popupRef = null; }
  _markerList = [];
}

// ─── Full Route Visualisation ──────────────────────────────────────
/**
 * Render the full computed route result on the map.
 * Replaces any existing route layers.
 *
 * @param {object} routeResult  Output of calculateFullRoute()
 */
export function renderRouteResult(routeResult) {
  clearRouteLayers();

  routeResult.segments.forEach(seg => {
    if (seg.needsTacking && seg.tackPoints?.length > 1) {
      drawTackingSegment(seg.tackPoints);
    } else {
      drawDirectRoute([seg.from, seg.to]);
    }

    // Draw chunk dot markers (skip very short routes to avoid clutter)
    if (seg.chunkPoints?.length > 0 && seg.directDistance > 500) {
      drawChunkDots(seg.chunkPoints);
    }
  });
}

// ─── Fit Bounds ────────────────────────────────────────────────────
/**
 * Fit the map view to all current waypoints with padding.
 *
 * @param {Array<{lat,lon}>} waypoints
 */
export function fitToWaypoints(waypoints) {
  if (!waypoints.length || !map) return;
  const bounds = L.latLngBounds(waypoints.map(wp => [wp.lat, wp.lon]));
  map.fitBounds(bounds, { padding: [60, 60], maxZoom: 12 });
}

// ─── Segment Popup ─────────────────────────────────────────────────
/**
 * Show an information popup at the midpoint of a segment.
 *
 * @param {object} segment  Segment data from routeResult.segments
 */
export function showSegmentPopup(segment) {
  if (!map) return;
  const [mLat, mLon] = [
    (segment.from[0] + segment.to[0]) / 2,
    (segment.from[1] + segment.to[1]) / 2
  ];

  const distNM = (segment.actualDistance / 1852).toFixed(2);
  const timeStr = formatDuration(segment.timeSeconds);
  const tackStr = segment.needsTacking ? `⚡ ${t('popup.tackingRequired')}` : `→ ${t('popup.direct')}`;
  const legIndex = segment.index !== undefined ? segment.index + 1 : '';

  const html = `
    <div class="popup-title">${t('popup.leg', { index: legIndex })}</div>
    <div class="popup-row"><span>${t('popup.route')}</span><strong>${tackStr}</strong></div>
    <div class="popup-row"><span>${t('popup.distance')}</span><strong>${distNM} NM</strong></div>
    <div class="popup-row"><span>${t('popup.duration')}</span><strong>${timeStr}</strong></div>
    <div class="popup-row"><span>${t('popup.avgSpeed')}</span><strong>${segment.avgBoatSpeed.toFixed(1)} kn</strong></div>
    <div class="popup-row"><span>${t('popup.wind')}</span><strong>${segment.startWeather.windSpeed.toFixed(0)} kn / ${segment.startWeather.windDirection.toFixed(0)}°</strong></div>
  `;

  if (popupRef) map.closePopup();
  popupRef = L.popup({ closeButton: false, className: 'sail-popup' })
    .setLatLng([mLat, mLon])
    .setContent(html)
    .openOn(map);
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}${t('time.minuteShort')}`;
  if (m === 0) return `${h}${t('time.hourShort')}`;
  return `${h}${t('time.hourShort')} ${m}${t('time.minuteShort')}`;
}
