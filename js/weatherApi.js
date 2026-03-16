/**
 * weatherApi.js
 * Fetches wind forecast from Open-Meteo API and caches results.
 * Uses both minutely_15 (high res) and hourly as fallback.
 */

const BASE_URL = 'https://api.open-meteo.com/v1/forecast';
const cache = new Map();

/**
 * Build the request URL for a given coordinate.
 */
function buildUrl(lat, lon) {
  const params = new URLSearchParams({
    latitude:        lat.toFixed(5),
    longitude:       lon.toFixed(5),
    hourly:          'wind_speed_10m,wind_direction_10m,wind_gusts_10m',
    minutely_15:     'wind_speed_10m,wind_direction_10m',
    wind_speed_unit: 'kn',
    timezone:        'UTC',
    forecast_days:   '7'
  });
  return `${BASE_URL}?${params}`;
}

/**
 * Fetch weather data for a coordinate.
 * Results are cached by rounded lat/lon (3 decimal places ≈ 100 m precision).
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<object>} Raw Open-Meteo API response
 */
export async function fetchWeather(lat, lon) {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;

  if (cache.has(key)) {
    return cache.get(key);
  }

  const url = buildUrl(lat, lon);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Open-Meteo API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(`Open-Meteo: ${data.reason}`);
  }

  cache.set(key, data);
  return data;
}

/**
 * Extract wind conditions at a specific timestamp from cached API data.
 * Prefers minutely_15 resolution; falls back to hourly.
 *
 * @param {object} apiData  Open-Meteo response object
 * @param {Date}   timestamp
 * @returns {{ windSpeed: number, windDirection: number, windGusts: number }}
 */
export function getWindAtTime(apiData, timestamp) {
  const ts = timestamp.getTime();

  function search(timeArr, speedArr, dirArr, gustArr) {
    if (!timeArr?.length || !speedArr?.length) return null;
    let best = 0, bestDiff = Infinity;
    for (let i = 0; i < timeArr.length; i++) {
      const t = new Date(timeArr[i] + 'Z').getTime(); // ensure UTC parse
      const diff = Math.abs(t - ts);
      if (diff < bestDiff) { bestDiff = diff; best = i; }
      if (diff > bestDiff) break; // times are sorted; can early-exit
    }
    return {
      windSpeed:     speedArr[best] ?? 8,
      windDirection: dirArr[best]   ?? 270,
      windGusts:     gustArr ? (gustArr[best] ?? speedArr[best] * 1.3) : speedArr[best] * 1.3
    };
  }

  // Prefer high-res 15-minute data
  const m15 = apiData?.minutely_15;
  if (m15?.time) {
    const r = search(m15.time, m15.wind_speed_10m, m15.wind_direction_10m, null);
    if (r) return r;
  }

  // Hourly fallback
  const h = apiData?.hourly;
  if (h?.time) {
    const r = search(h.time, h.wind_speed_10m, h.wind_direction_10m, h.wind_gusts_10m);
    if (r) return r;
  }

  // Final safety default
  return { windSpeed: 8, windDirection: 270, windGusts: 12 };
}

/**
 * Get the current (or nearest future) wind at the first waypoint.
 * Useful for the sidebar wind widget.
 */
export function getCurrentWind(apiData) {
  return getWindAtTime(apiData, new Date());
}

/**
 * Clear the weather cache (e.g. after route reset).
 */
export function clearWeatherCache() {
  cache.clear();
}
