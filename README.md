# ⚓ SailNav — Smart Sailing Route Planner

A modular, interactive sailing route planner with live wind data, VMG polar performance, and automatic upwind tacking visualisation.

## Features

- **Live Wind Data** — Open-Meteo API (7-day forecast, hourly + 15-min resolution)
- **5 Vessel Profiles** — Cruising sailboat, Racing yacht, Catamaran, Windsurf, Dinghy
- **Polar Curve Interpolation** — Linear interpolation between True Wind Angle data points
- **200 m Route Chunking** — Every segment broken into 200 m pieces; wind updated per chunk
- **Automatic Tacking** — No-go zone detection; zig-zag VMG route drawn in amber
- **Tack Frequency Control** — Long (2 km), Medium (800 m), or Short (300 m) tack legs
- **Route Dashboard** — Total distance, time, avg speed, per-leg breakdown, waypoint ETAs
- **Dark Nautical Aesthetic** — CartoDB Dark Matter tiles, Cinzel + Chakra Petch typography

## Quick Start

> ⚠️ **Must be served over HTTP** — ES6 modules are blocked by `file://` due to browser CORS policy.

### Option 1: Node (npx serve)
```bash
cd sailnav/
npx serve .
# Open http://localhost:3000
```

### Option 2: Python
```bash
cd sailnav/
python3 -m http.server 8080
# Open http://localhost:8080
```

### Option 3: VS Code Live Server
Install the "Live Server" extension and click **Go Live**.

## Usage

1. **Drop waypoints** — Click anywhere on the map to place start (⚓) and destination points
2. **Set departure** — Choose date/time in the left sidebar
3. **Pick vessel** — Select boat profile; specs (no-go zone, best angle) are shown
4. **Tacking strategy** — Long/Medium/Short tacks for upwind legs
5. **Calculate** — Hit the button; wind data is fetched and route computed
6. **Read results** — Slide-in panel shows total stats and per-leg breakdown

## File Structure

```
sailnav/
├── index.html              # App shell (semantic HTML5)
├── css/
│   ├── main.css            # Design tokens, global reset, layout
│   ├── map.css             # Leaflet map, markers, overlays
│   └── controls.css        # Sidebar, panel, cards, buttons
├── js/
│   ├── main.js             # Entry point, state, event coordination
│   ├── mapModule.js        # Leaflet init, drawing helpers
│   ├── weatherApi.js       # Open-Meteo fetch + caching
│   ├── routingMath.js      # Haversine, TWA, polars, tacking, chunking
│   └── uiController.js     # DOM manipulation, panel population
└── data/
    └── boats.json          # Vessel polar performance profiles
```

## Core Maths

| Concept | Formula |
|---|---|
| **Distance** | Haversine: `2R·atan2(√a, √(1−a))` |
| **Bearing** | Forward azimuth: `atan2(sin·Δλ·cos φ₂, cos φ₁·sin φ₂ − sin φ₁·cos φ₂·cos Δλ)` |
| **TWA** | `min(|H−W|, 360−|H−W|)` |
| **Boat Speed** | `WS × interpolate(polars, TWA)` |
| **Chunk Time** | `distance / (BS × 0.514444)` m/s |
| **Tack Heading** | `W ± minTackAngle` |

## Adding Boats

Edit `data/boats.json`. Polar angles must be in ascending order (0–180°):

```json
"my_boat": {
  "name": "My Boat",
  "description": "Custom profile",
  "minTackAngle": 42,
  "polars": [
    { "angle": 42,  "speedPercent": 0.65 },
    { "angle": 90,  "speedPercent": 0.95 },
    { "angle": 180, "speedPercent": 0.70 }
  ]
}
```

## API

Wind data: [Open-Meteo](https://open-meteo.com/) (free, no API key required)  
Map tiles: [CartoDB](https://carto.com/) Dark Matter

## Tech Stack

- Vanilla JavaScript — ES6 Modules (no build step)
- Leaflet.js 1.9.4
- HTML5 Semantic markup
- CSS3 (custom properties, grid, flexbox)
- Open-Meteo Weather API
