import { t, getCurrentLanguage } from './i18n.js';
import { formatDuration } from './uiController.js';

let getExportData = null;
let modal = null;
let formatSelect = null;
let previewPanel = null;
let textPreview = null;
let statusEl = null;
let exportButton = null;
let latestPayload = null;

function ensureModal() {
  if (modal) return;

  modal = document.createElement('div');
  modal.id = 'export-modal';
  modal.className = 'export-modal';
  modal.innerHTML = `
    <div class="export-backdrop" data-close="true"></div>
    <div class="export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-title">
      <div class="export-head">
        <h3 id="export-title" class="export-title"></h3>
        <button id="export-close-btn" class="icon-btn" type="button">×</button>
      </div>

      <div class="export-summary" id="export-summary"></div>

      <div class="export-body">
        <div class="export-visual" id="export-visual"></div>

        <div class="export-controls">
          <label for="export-format" class="export-label" id="export-format-label"></label>
          <select id="export-format" class="field-input field-select">
            <option value="json">JSON</option>
            <option value="gpx">GPX</option>
          </select>

          <pre id="export-preview" class="export-preview"></pre>
        </div>
      </div>

      <div class="export-actions">
        <button id="export-image-btn" class="primary-btn" type="button"></button>
        <button id="export-download-btn" class="primary-btn" type="button"></button>
        <button id="export-copy-btn" class="secondary-btn" type="button"></button>
        <button id="export-share-btn" class="secondary-btn" type="button"></button>
      </div>

      <p id="export-status" class="export-status" aria-live="polite"></p>
    </div>
  `;

  document.body.appendChild(modal);

  formatSelect = modal.querySelector('#export-format');
  previewPanel = modal.querySelector('#export-visual');
  textPreview = modal.querySelector('#export-preview');
  statusEl = modal.querySelector('#export-status');

  modal.querySelector('[data-close="true"]').addEventListener('click', closeExportModal);
  modal.querySelector('#export-close-btn').addEventListener('click', closeExportModal);

  formatSelect.addEventListener('change', () => {
    renderTextPreview();
    clearStatus();
  });

  modal.querySelector('#export-download-btn').addEventListener('click', handleDownload);
  modal.querySelector('#export-image-btn').addEventListener('click', handleDownloadImage);
  modal.querySelector('#export-copy-btn').addEventListener('click', handleCopy);
  modal.querySelector('#export-share-btn').addEventListener('click', handleShare);

  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal?.classList.contains('open')) closeExportModal();
  });

  window.addEventListener('i18n:changed', () => {
    if (modal?.classList.contains('open')) {
      renderModalText();
      renderSummary();
      renderVisualPreview();
      renderTextPreview();
    }
  });
}

function renderModalText() {
  modal.querySelector('#export-title').textContent = t('export.title');
  modal.querySelector('#export-close-btn').setAttribute('title', t('common.close'));
  modal.querySelector('#export-format-label').textContent = t('export.format');
  modal.querySelector('#export-image-btn').textContent = t('export.downloadImage');
  modal.querySelector('#export-download-btn').textContent = t('export.download');
  modal.querySelector('#export-copy-btn').textContent = t('export.copy');
  modal.querySelector('#export-share-btn').textContent = t('export.share');
}

function clearStatus() {
  if (statusEl) statusEl.textContent = '';
}

function setStatus(msgKey, params = {}) {
  if (!statusEl) return;
  statusEl.textContent = t(msgKey, params);
}

function flattenRoutePoints(routeResult) {
  const pts = [];

  routeResult.segments.forEach(seg => {
    const segPts = seg.needsTacking && Array.isArray(seg.tackPoints) && seg.tackPoints.length > 1
      ? seg.tackPoints
      : [seg.from, seg.to];

    segPts.forEach(([lat, lon]) => {
      const prev = pts[pts.length - 1];
      if (!prev || prev[0] !== lat || prev[1] !== lon) {
        pts.push([lat, lon]);
      }
    });
  });

  return pts;
}

function buildExportObject(data) {
  const { routeResult, waypoints, boatKey, boatName, departureTime, units } = data;
  const points = flattenRoutePoints(routeResult);

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    locale: getCurrentLanguage(),
    boat: {
      key: boatKey,
      name: boatName
    },
    departureTime: departureTime.toISOString(),
    units,
    summary: {
      totalDistanceNM: routeResult.totalDistanceNM,
      sailedDistanceNM: routeResult.totalActualDistanceNM,
      totalTimeSeconds: routeResult.totalTimeSeconds,
      arrivalTime: routeResult.arrivalTime?.toISOString?.() ?? String(routeResult.arrivalTime)
    },
    waypoints,
    routeTrack: points,
    segments: routeResult.segments
  };
}

function buildGpx(data, exportObj) {
  const points = exportObj.routeTrack;
  const start = data.departureTime.toISOString();

  const trkpts = points
    .map(([lat, lon]) => `      <trkpt lat="${lat}" lon="${lon}"></trkpt>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="SailNav" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escapeXml(t('export.routeName'))}</name>
    <time>${start}</time>
  </metadata>
  <trk>
    <name>${escapeXml(`${t('export.routeName')} - ${data.boatName}`)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

function escapeXml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function calcBounds(points) {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;

  points.forEach(([lat, lon]) => {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
  });

  return { minLat, maxLat, minLon, maxLon };
}

function buildRouteSvg(points) {
  if (!points.length) {
    return `<div class="export-empty">${t('export.noRoute')}</div>`;
  }

  const W = 360;
  const H = 170;
  const PAD = 18;
  const b = calcBounds(points);
  const dx = Math.max(0.0001, b.maxLon - b.minLon);
  const dy = Math.max(0.0001, b.maxLat - b.minLat);

  const sx = (W - PAD * 2) / dx;
  const sy = (H - PAD * 2) / dy;
  const s = Math.min(sx, sy);

  const mapX = lon => PAD + (lon - b.minLon) * s;
  const mapY = lat => H - PAD - (lat - b.minLat) * s;

  const path = points
    .map(([lat, lon], i) => `${i === 0 ? 'M' : 'L'}${mapX(lon).toFixed(1)},${mapY(lat).toFixed(1)}`)
    .join(' ');

  const [sLat, sLon] = points[0];
  const [eLat, eLon] = points[points.length - 1];

  return `<svg viewBox="0 0 ${W} ${H}" class="export-svg" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="export-line-grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#38bdf8"/>
        <stop offset="100%" stop-color="#fbbf24"/>
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="${W}" height="${H}" fill="rgba(3,12,26,0.9)" />
    <path d="${path}" fill="none" stroke="url(#export-line-grad)" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="${mapX(sLon).toFixed(1)}" cy="${mapY(sLat).toFixed(1)}" r="4" fill="#00d4aa"/>
    <circle cx="${mapX(eLon).toFixed(1)}" cy="${mapY(eLat).toFixed(1)}" r="4" fill="#fbbf24"/>
  </svg>`;
}

function renderSummary() {
  const container = modal.querySelector('#export-summary');
  if (!latestPayload) {
    container.innerHTML = '';
    return;
  }

  const { routeResult, boatName } = latestPayload;

  container.innerHTML = `
    <div class="exp-chip">
      <span>${t('sidebar.vessel')}</span>
      <strong>${boatName}</strong>
    </div>
    <div class="exp-chip">
      <span>${t('sidebar.distance')}</span>
      <strong>${routeResult.totalDistanceNM.toFixed(2)} NM</strong>
    </div>
    <div class="exp-chip">
      <span>${t('results.totalTime')}</span>
      <strong>${formatDuration(routeResult.totalTimeSeconds)}</strong>
    </div>
  `;
}

function renderVisualPreview() {
  if (!latestPayload) return;
  const exportObj = buildExportObject(latestPayload);
  previewPanel.innerHTML = buildRouteSvg(exportObj.routeTrack);
}

function getCurrentFormat() {
  return formatSelect?.value === 'gpx' ? 'gpx' : 'json';
}

function getExportContent() {
  const format = getCurrentFormat();
  const exportObj = buildExportObject(latestPayload);

  if (format === 'gpx') {
    return {
      format,
      mime: 'application/gpx+xml',
      extension: 'gpx',
      content: buildGpx(latestPayload, exportObj)
    };
  }

  return {
    format,
    mime: 'application/json',
    extension: 'json',
    content: JSON.stringify(exportObj, null, 2)
  };
}

function renderTextPreview() {
  if (!latestPayload) {
    textPreview.textContent = '';
    return;
  }

  const { content } = getExportContent();
  textPreview.textContent = content;
}

function fileNameFor(ext) {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  return `sailnav-route-${stamp}.${ext}`;
}

function downloadText(content, mime, fileName) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function imageFileName() {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  return `sailnav-map-${stamp}.png`;
}

async function captureMapWithoutRouteLines(mapEl) {
  const overlayPane = mapEl.querySelector('.leaflet-overlay-pane');
  const prevVisibility = overlayPane ? overlayPane.style.visibility : '';

  if (overlayPane) {
    overlayPane.style.visibility = 'hidden';
  }

  try {
    return await window.html2canvas(mapEl, {
      useCORS: true,
      backgroundColor: null,
      allowTaint: false,
      logging: false,
      scale: 2
    });
  } finally {
    if (overlayPane) {
      overlayPane.style.visibility = prevVisibility;
    }
  }
}

function fmtDateTime(date) {
  const lang = getCurrentLanguage();
  return new Date(date).toLocaleString(lang, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

function compassDir(deg) {
  const dirs = [
    t('dir.n'), t('dir.nne'), t('dir.ne'), t('dir.ene'),
    t('dir.e'), t('dir.ese'), t('dir.se'), t('dir.sse'),
    t('dir.s'), t('dir.ssw'), t('dir.sw'), t('dir.wsw'),
    t('dir.w'), t('dir.wnw'), t('dir.nw'), t('dir.nnw')
  ];
  const n = Number.isFinite(deg) ? deg : 0;
  return dirs[Math.round(n / 22.5) % 16];
}

function waypointWindForIndex(routeResult, idx) {
  const segs = routeResult?.segments || [];
  if (!segs.length) return { windSpeed: 0, windDirection: 0 };

  if (idx < segs.length) {
    return segs[idx]?.startWeather || { windSpeed: 0, windDirection: 0 };
  }

  return segs[segs.length - 1]?.startWeather || { windSpeed: 0, windDirection: 0 };
}

function buildWaypointLegendData(payload) {
  const { waypoints, routeResult, departureTime } = payload;
  const list = [];

  waypoints.forEach((wp, idx) => {
    const eta = idx === 0
      ? new Date(departureTime)
      : routeResult?.waypointETAs?.[idx - 1] || new Date(departureTime);

    const wx = waypointWindForIndex(routeResult, idx);
    const isStart = idx === 0;
    const isEnd = idx === waypoints.length - 1;

    list.push({
      idx,
      label: isStart
        ? `⚓ ${t('results.start')}`
        : isEnd
          ? `WP ${idx} - ${t('results.destination')}`
          : t('forecast.wp', { index: idx }),
      eta,
      lat: wp.lat,
      lon: wp.lon,
      windSpeed: Number.isFinite(wx.windSpeed) ? wx.windSpeed : 0,
      windDirection: Number.isFinite(wx.windDirection) ? wx.windDirection : 0,
      color: isStart ? '#00d4aa' : (isEnd ? '#fbbf24' : '#38bdf8')
    });
  });

  return list;
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function composeMapLegendImage(mapCanvas, legendData) {
  const mapW = mapCanvas.width;
  const mapH = mapCanvas.height;

  const colW = 290;
  const cardH = 96;
  const gapY = 10;
  const pad = 16;
  const headerH = 72;
  const innerH = mapH - headerH - pad * 2;
  const perCol = Math.max(1, Math.floor(innerH / (cardH + gapY)));
  const cols = Math.max(1, Math.ceil(legendData.length / perCol));
  const legendW = cols * colW + (cols - 1) * 12 + pad * 2;

  const out = document.createElement('canvas');
  out.width = mapW + legendW;
  out.height = mapH;

  const ctx = out.getContext('2d');

  // Base map
  ctx.drawImage(mapCanvas, 0, 0);

  // Legend panel background
  const lg = ctx.createLinearGradient(mapW, 0, out.width, out.height);
  lg.addColorStop(0, 'rgba(3, 12, 26, 0.97)');
  lg.addColorStop(1, 'rgba(5, 21, 37, 0.99)');
  ctx.fillStyle = lg;
  ctx.fillRect(mapW, 0, legendW, out.height);

  // Divider
  ctx.strokeStyle = 'rgba(0, 212, 170, 0.28)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(mapW + 1, 0);
  ctx.lineTo(mapW + 1, out.height);
  ctx.stroke();

  // Header
  ctx.fillStyle = '#00d4aa';
  ctx.font = '600 23px Chakra Petch';
  ctx.fillText(t('export.legendTitle'), mapW + pad, 32);

  ctx.fillStyle = 'rgba(127,176,204,0.95)';
  ctx.font = '500 14px Chakra Petch';
  ctx.fillText(t('export.legendSubtitle'), mapW + pad, 54);

  legendData.forEach((row, i) => {
    const col = Math.floor(i / perCol);
    const rowInCol = i % perCol;
    const x = mapW + pad + col * (colW + 12);
    const y = headerH + pad + rowInCol * (cardH + gapY);

    ctx.save();
    drawRoundedRect(ctx, x, y, colW, cardH, 9);
    ctx.fillStyle = 'rgba(0, 180, 140, 0.08)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 212, 170, 0.24)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = row.color;
    ctx.beginPath();
    ctx.arc(x + 13, y + 16, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#e8f5ff';
    ctx.font = '600 14px Chakra Petch';
    ctx.fillText(row.label, x + 24, y + 20);

    ctx.fillStyle = '#7fb0cc';
    ctx.font = '500 12px Chakra Petch';
    ctx.fillText(`${t('export.legendTime')}: ${fmtDateTime(row.eta)}`, x + 12, y + 40);
    ctx.fillText(`${t('export.legendCoord')}: ${row.lat.toFixed(5)}, ${row.lon.toFixed(5)}`, x + 12, y + 58);
    ctx.fillText(
      `${t('export.legendWind')}: ${row.windDirection.toFixed(0)}° ${compassDir(row.windDirection)} · ${row.windSpeed.toFixed(1)} kn`,
      x + 12,
      y + 76
    );
    ctx.restore();
  });

  return out;
}

async function handleDownloadImage() {
  const mapEl = document.getElementById('map');
  if (!mapEl) {
    setStatus('export.statusImageFailed');
    return;
  }

  if (typeof window.html2canvas !== 'function') {
    setStatus('export.statusImageMissingLib');
    return;
  }

  clearStatus();
  setStatus('export.statusImageRendering');

  try {
    const canvas = await captureMapWithoutRouteLines(mapEl);

    const legendData = buildWaypointLegendData(latestPayload);
    const composed = composeMapLegendImage(canvas, legendData);

    const blob = await new Promise(resolve => composed.toBlob(resolve, 'image/png'));
    if (!blob) {
      setStatus('export.statusImageFailed');
      return;
    }

    downloadBlob(blob, imageFileName());
    setStatus('export.statusImageReady');
  } catch (err) {
    console.error('Map image export failed:', err);
    setStatus('export.statusImageFailedCors');
  }
}

async function handleDownload() {
  if (!latestPayload) return;
  const { content, mime, extension } = getExportContent();
  downloadText(content, mime, fileNameFor(extension));
  setStatus('export.statusDownloaded');
}

async function handleCopy() {
  if (!latestPayload) return;
  const { content, format } = getExportContent();
  try {
    await navigator.clipboard.writeText(content);
    setStatus('export.statusCopied', { format: format.toUpperCase() });
  } catch (err) {
    console.error('Clipboard copy failed:', err);
    setStatus('export.statusCopyFailed');
  }
}

async function handleShare() {
  if (!latestPayload) return;

  const { content, mime, extension } = getExportContent();
  const title = t('export.routeName');
  const text = t('export.shareText');

  try {
    if (navigator.share && navigator.canShare) {
      const file = new File([content], fileNameFor(extension), { type: mime });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ title, text, files: [file] });
        setStatus('export.statusShared');
        return;
      }
    }

    if (navigator.share) {
      await navigator.share({ title, text, url: window.location.href });
      setStatus('export.statusShared');
      return;
    }

    await navigator.clipboard.writeText(content);
    setStatus('export.statusCopied', { format: getCurrentFormat().toUpperCase() });
  } catch (err) {
    if (err?.name === 'AbortError') return;
    console.error('Share failed:', err);
    setStatus('export.statusShareFailed');
  }
}

export function setExportEnabled(enabled) {
  if (!exportButton) return;
  exportButton.disabled = !enabled;
}

export function closeExportModal() {
  if (!modal) return;
  modal.classList.remove('open');
}

export function openExportModal() {
  if (!getExportData) return;

  latestPayload = getExportData();
  if (!latestPayload) {
    setStatus('export.noData');
    return;
  }

  ensureModal();
  renderModalText();
  renderSummary();
  renderVisualPreview();
  renderTextPreview();
  clearStatus();

  modal.classList.add('open');
}

export function initRouteExport({ getData }) {
  getExportData = getData;
  exportButton = document.getElementById('export-route-btn');

  ensureModal();

  if (exportButton) {
    exportButton.addEventListener('click', openExportModal);
    exportButton.disabled = true;
  }
}
