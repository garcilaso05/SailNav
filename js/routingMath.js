/**
 * routingMath.js
 * Core navigation physics: Haversine, bearings, True Wind Angle,
 * polar curve interpolation, VMG tacking, 200 m segment chunking.
 */

const R_EARTH = 6371000; // metres

// ─── Utilities ────────────────────────────────────────────────────
export const toRad = d => d * Math.PI / 180;
export const toDeg = r => r * 180 / Math.PI;

/** Wrap angle to [0, 360) */
export const wrap360 = a => ((a % 360) + 360) % 360;

/** Smallest signed difference between two headings, result in (-180, 180] */
export function angleDiff(a, b) {
  let d = (a - b + 360) % 360;
  if (d > 180) d -= 360;
  return d;
}

// ─── Haversine Distance ────────────────────────────────────────────
/** Returns distance in metres between two lat/lon points. */
export function haversineDistance(lat1, lon1, lat2, lon2) {
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lon2 - lon1);
  const a = Math.sin(Δφ / 2) ** 2
          + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R_EARTH * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Forward Azimuth (Initial Bearing) ─────────────────────────────
/** Returns initial bearing in degrees [0, 360) from point A to point B. */
export function bearing(lat1, lon1, lat2, lon2) {
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2)
          - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return wrap360(toDeg(Math.atan2(y, x)));
}

// ─── Destination Point ─────────────────────────────────────────────
/** Given start lat/lon, distance (metres) and bearing (°), return new [lat, lon]. */
export function destinationPoint(lat, lon, distance, brng) {
  const φ1 = toRad(lat), λ1 = toRad(lon);
  const θ  = toRad(brng);
  const δ  = distance / R_EARTH;
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) +
    Math.cos(φ1) * Math.sin(δ) * Math.cos(θ)
  );
  const λ2 = λ1 + Math.atan2(
    Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
    Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
  );
  return [toDeg(φ2), toDeg(((λ2 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI)];
}

// ─── Spherical Interpolation ────────────────────────────────────────
/** Interpolate a point at fraction f (0–1) along the geodesic from A to B. */
export function intermediatePoint(lat1, lon1, lat2, lon2, f) {
  const φ1 = toRad(lat1), λ1 = toRad(lon1);
  const φ2 = toRad(lat2), λ2 = toRad(lon2);
  const Δφ = φ2 - φ1, Δλ = λ2 - λ1;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const d = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  if (d < 1e-10) return [lat1, lon1];
  const A = Math.sin((1 - f) * d) / Math.sin(d);
  const B = Math.sin(f * d)       / Math.sin(d);
  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const z = A * Math.sin(φ1)                 + B * Math.sin(φ2);
  return [toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))),
          toDeg(Math.atan2(y, x))];
}

// ─── True Wind Angle ───────────────────────────────────────────────
/**
 * Returns TWA in [0, 180]: the angle between the boat's heading and
 * the wind direction (FROM which wind blows, e.g. 270 = westerly wind).
 */
export function calcTWA(boatHeading, windFromDirection) {
  const diff = Math.abs(boatHeading - windFromDirection);
  return Math.min(diff, 360 - diff);
}

// ─── Polar Interpolation ───────────────────────────────────────────
/**
 * Linear interpolation on a polar curve (array of {angle, speedPercent}).
 * Returns fractional speed as a ratio of wind speed.
 */
export function interpolateSpeedPercent(twa, polars) {
  if (twa <= polars[0].angle) return polars[0].speedPercent;
  const last = polars[polars.length - 1];
  if (twa >= last.angle) return last.speedPercent;

  for (let i = 0; i < polars.length - 1; i++) {
    if (twa >= polars[i].angle && twa <= polars[i + 1].angle) {
      const t = (twa - polars[i].angle) / (polars[i + 1].angle - polars[i].angle);
      return polars[i].speedPercent + t * (polars[i + 1].speedPercent - polars[i].speedPercent);
    }
  }
  return last.speedPercent;
}

// ─── Chunk-level speed & time ─────────────────────────────────────
/**
 * Calculate travel time and boat speed for a small straight segment.
 * Does NOT handle tacking — call this on each individual tack leg.
 *
 * @returns { timeSeconds, boatSpeedKts, twa, speedPercent }
 */
export function chunkCalc(distMetres, windSpeedKts, windDir, boatHeading, boat) {
  const twa = calcTWA(boatHeading, windDir);
  const speedPercent = interpolateSpeedPercent(twa, boat.polars);
  const boatSpeedKts = Math.max(0.05, windSpeedKts * speedPercent);
  // 1 kn = 0.514444 m/s
  const timeSeconds = distMetres / (boatSpeedKts * 0.514444);
  return { timeSeconds, boatSpeedKts, twa, speedPercent };
}

// ─── Tacking Route Generator ───────────────────────────────────────
/**
 * Generates a zig-zag tacking route from start to end when the direct
 * bearing is in the no-go zone (TWA < boat.minTackAngle).
 *
 * @param {number} tackLength  Length of each tack leg in metres.
 * @returns {Array<[lat, lon]>} Ordered array including start point.
 */
export function generateTackingRoute(
  startLat, startLon, endLat, endLon,
  windDir, minTackAngle, tackLength
) {
  const pts = [[startLat, startLon]];
  let [curLat, curLon] = [startLat, startLon];

  // Two possible close-hauled headings (port and starboard tack)
  const hPort  = wrap360(windDir - minTackAngle); // e.g. wind=0° → 315°
  const hStbd  = wrap360(windDir + minTackAngle); // e.g. wind=0° → 45°

  // Choose starting tack: whichever has smaller angular diff to destination bearing
  const destBrng = bearing(startLat, startLon, endLat, endLon);
  const dPort = Math.abs(angleDiff(hPort, destBrng));
  const dStbd = Math.abs(angleDiff(hStbd, destBrng));

  let curH  = dStbd <= dPort ? hStbd : hPort;
  let altH  = curH === hStbd ? hPort : hStbd;

  const MAX_ITER = 200;

  for (let i = 0; i < MAX_ITER; i++) {
    const dist = haversineDistance(curLat, curLon, endLat, endLon);

    // Close enough — snap to destination
    if (dist < 30) {
      pts.push([endLat, endLon]);
      break;
    }

    // Check if we can now sail directly (out of no-go zone)
    const db  = bearing(curLat, curLon, endLat, endLon);
    const twa = calcTWA(db, windDir);
    if (twa >= minTackAngle) {
      pts.push([endLat, endLon]);
      break;
    }

    // Sail this tack leg
    const step = Math.min(tackLength, dist * 2.5);
    const [nLat, nLon] = destinationPoint(curLat, curLon, step, curH);
    pts.push([nLat, nLon]);
    [curLat, curLon] = [nLat, nLon];

    // Alternate tack
    [curH, altH] = [altH, curH];
  }

  return pts;
}

// ─── Weather Time Lookup ───────────────────────────────────────────
/**
 * Find the wind conditions at a given timestamp from an API response object.
 * Prefers minutely_15 data; falls back to hourly.
 */
export function getWindAtTime(apiData, timestamp) {
  const ts = timestamp instanceof Date ? timestamp.getTime() : new Date(timestamp).getTime();

  const trySource = (timeArr, speedArr, dirArr, gustArr) => {
    if (!timeArr || !speedArr || !dirArr) return null;
    let best = 0, bestDiff = Infinity;
    for (let i = 0; i < timeArr.length; i++) {
      const diff = Math.abs(new Date(timeArr[i]).getTime() - ts);
      if (diff < bestDiff) { bestDiff = diff; best = i; }
    }
    return {
      windSpeed:    speedArr[best] ?? 10,
      windDirection: dirArr[best]  ?? 270,
      windGusts:    gustArr ? (gustArr[best] ?? speedArr[best] * 1.3) : speedArr[best] * 1.3
    };
  };

  // Prefer high-res minutely_15
  if (apiData?.minutely_15) {
    const m = apiData.minutely_15;
    const r = trySource(m.time, m.wind_speed_10m, m.wind_direction_10m, null);
    if (r) return r;
  }

  // Fall back to hourly
  if (apiData?.hourly) {
    const h = apiData.hourly;
    const r = trySource(h.time, h.wind_speed_10m, h.wind_direction_10m, h.wind_gusts_10m);
    if (r) return r;
  }

  // Default safety values
  return { windSpeed: 10, windDirection: 270, windGusts: 14 };
}

// ─── Full Route Calculation ────────────────────────────────────────
/**
 * Master calculation: processes all waypoint pairs, handles tacking,
 * breaks each leg into ≤200 m chunks, accumulates time with wind forecast.
 *
 * @param {Array<[lat,lon]>} waypoints
 * @param {Array<object>}    weatherData  One Open-Meteo API response per waypoint
 * @param {object}           boat         Boat profile from boats.json
 * @param {Date}             departureTime
 * @param {string}           tackFrequency  'few'|'medium'|'many'
 * @returns {object}         Full route result object
 */
export function calculateFullRoute(waypoints, weatherData, boat, departureTime, tackFrequency) {
  const CHUNK = 200; // metres
  const TACK_LENGTHS = { few: 2000, medium: 800, many: 300 };
  const tackLength = TACK_LENGTHS[tackFrequency] ?? 800;

  const result = {
    segments: [],
    totalDistanceNM: 0,
    totalActualDistanceNM: 0,
    totalTimeSeconds: 0,
    waypointETAs: [],
  };

  let runningSeconds = 0;

  for (let i = 0; i < waypoints.length - 1; i++) {
    const [sLat, sLon] = waypoints[i];
    const [eLat, eLon] = waypoints[i + 1];

    const directDist = haversineDistance(sLat, sLon, eLat, eLon);
    const directBrng = bearing(sLat, sLon, eLat, eLon);

    // Determine wind at departure of this segment
    const tStart = new Date(departureTime.getTime() + runningSeconds * 1000);
    const wx0    = getWindAtTime(weatherData[i] || weatherData[0], tStart);

    const directTWA  = calcTWA(directBrng, wx0.windDirection);
    const needsTacking = directTWA < boat.minTackAngle;

    // Build the list of waypoints for this segment (tacking adds more)
    let segPts;
    if (needsTacking) {
      segPts = generateTackingRoute(
        sLat, sLon, eLat, eLon,
        wx0.windDirection, boat.minTackAngle, tackLength
      );
    } else {
      segPts = [[sLat, sLon], [eLat, eLon]];
    }

    // ── Chunk each leg of segPts ──────────────────────────────────
    let segTimeSeconds = 0;
    let segActualDist  = 0;
    const chunkPoints  = [];
    const subSegments  = [];

    for (let j = 0; j < segPts.length - 1; j++) {
      const [aLat, aLon] = segPts[j];
      const [bLat, bLon] = segPts[j + 1];
      const legDist = haversineDistance(aLat, aLon, bLat, bLon);
      const legBrng = bearing(aLat, aLon, bLat, bLon);

      const numChunks = Math.max(1, Math.ceil(legDist / CHUNK));

      for (let k = 0; k < numChunks; k++) {
        const f0 = k / numChunks;
        const f1 = (k + 1) / numChunks;
        const [cLat0, cLon0] = k === 0 ? [aLat, aLon] : intermediatePoint(aLat, aLon, bLat, bLon, f0);
        const [cLat1, cLon1] = intermediatePoint(aLat, aLon, bLat, bLon, f1);
        const chunkDist = haversineDistance(cLat0, cLon0, cLat1, cLon1);

        // Get wind at the time this chunk starts
        const chunkTime = new Date(departureTime.getTime() + (runningSeconds + segTimeSeconds) * 1000);
        const wx = getWindAtTime(weatherData[i] || weatherData[0], chunkTime);

        const { timeSeconds, boatSpeedKts, twa } = chunkCalc(
          chunkDist, wx.windSpeed, wx.windDirection, legBrng, boat
        );

        segTimeSeconds += timeSeconds;
        segActualDist  += chunkDist;

        // Record chunk midpoint for visualisation (skip first point — it's the waypoint)
        if (k > 0) chunkPoints.push([cLat0, cLon0]);

        subSegments.push({
          from:        [cLat0, cLon0],
          to:          [cLat1, cLon1],
          dist:        chunkDist,
          timeSeconds,
          boatSpeedKts,
          twa,
          windSpeed:   wx.windSpeed,
          windDir:     wx.windDirection
        });
      }
    }

    runningSeconds += segTimeSeconds;

    const eta = new Date(departureTime.getTime() + runningSeconds * 1000);
    result.waypointETAs.push(eta);

    // Aggregate wind stats for the leg
    const avgWindSpeed = subSegments.reduce((s, c) => s + c.windSpeed, 0) / subSegments.length;
    const avgBoatSpeed = subSegments.reduce((s, c) => s + c.boatSpeedKts, 0) / subSegments.length;

    result.segments.push({
      from:            [sLat, sLon],
      to:              [eLat, eLon],
      directDistance:  directDist,
      actualDistance:  segActualDist,
      directBearing:   directBrng,
      directTWA,
      needsTacking,
      tackPoints:      needsTacking ? segPts : null,
      timeSeconds:     segTimeSeconds,
      avgWindSpeed,
      avgBoatSpeed,
      chunkPoints,
      subSegments,
      startWeather:    wx0
    });

    result.totalDistanceNM       += directDist / 1852;
    result.totalActualDistanceNM += segActualDist / 1852;
    result.totalTimeSeconds       = runningSeconds;
  }

  result.arrivalTime = new Date(departureTime.getTime() + runningSeconds * 1000);
  return result;
}
