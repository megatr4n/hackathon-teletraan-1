# TELETRAAN-1 · Wildfire Mission Control

React, TypeScript, Vite, Tailwind CSS, Kepler.gl, MapLibre, Lucide and Radix UI.

## Run

```sh
pnpm install
pnpm dev
pnpm build
pnpm preview
```

Use Node.js 22.13+ and pnpm 11. Run these commands from the frontend directory. Serve the static build from `dist/` over HTTP. Pins, including built-in scenarios, live in browser storage and include the selected area, date range, pass, camera, layers and calendar settings.

## Verification and deployment

Run the Daily Puzzle checks from the frontend directory with `node tests/daily-puzzle.test.mjs`.

Build the nginx image from the repository root with `docker build -f frontend/Dockerfile -t teletraan-frontend .`.

## Telemetry and estimates

This frontend runs in demo mode. MODIS and VIIRS values, hotspot counts and exports use synthetic observations. The FastAPI service remains a separate part of the repository. VIIRS is shown from 2012 onward, and its period averages use the covered days only. The same filtered daily observations drive the map, calendar, selected-day statistics and exports.

Update `../config/modis_viirs_coefficients.csv` and rebuild to change calibration. `src/calibration.ts` validates and maps the shared CSV headers. The original supplied row includes an extra empty field before the two daily FRP values, which the parser accepts.

- The daily map, calendar, selected-day analytics and exports use the day and night FRP multipliers. For All Passes the app adds the separately calibrated day and night FRP.
- Inclusive ranges of seven days or more apply the CSV's general FRP coefficient for the selected pass. Shorter ranges aggregate the calibrated daily values.
- Hotspot counts use the CSV coefficient for the selected pass, including the combined coefficient for All Passes. Multiplication preserves precision internally. Estimated counts are rounded for display.
- Period FRP totals sum daily power samples at a one-day step. They are displayed in MW·day. The FRE estimate below uses a separate scenario reference for the synthetic data.

The two estimated quantities use the selected day's FRP series.

- Active flaming area uses FRP divided by the radiative flux from the Stefan–Boltzmann law. Assumptions are emissivity 0.95, fire temperature 800 K and ambient temperature 300 K. This is a snapshot of estimated active burning area.
- CO₂ uses integrated fire radiative energy, 0.368 kg of dry matter per MJ and 1.626 kg of CO₂ per kg of dry matter. The demo scales its scenario's reference FRE by the selected FRP. Real emissions depend on the fuel and the observed FRP time series.

Methods: [NASA JPL MASTER FRP ATBD](https://masterprojects.jpl.nasa.gov/downloads/docs/MASTER_L3_ATBD_ETF-FRP_20251219_ver2.pdf) and [Kaiser et al. 2012, Global Fire Assimilation System](https://bg.copernicus.org/articles/9/527/2012/).

## Geographic data

- [Natural Earth](https://www.naturalearthdata.com/) for countries, administrative units, hydrography and selected protected areas. [geoBoundaries](https://www.geoboundaries.org/) supplies Ukraine's country and administrative boundaries, including Crimea.
- [WWF/RESOLVE terrestrial ecoregions](https://developers.google.com/earth-engine/datasets/catalog/RESOLVE_ECOREGIONS_2017) are simplified for browser use.
- [NASA GIBS](https://nasa-gibs.github.io/gibs-api-docs/) provides Blue Marble and daily MODIS True Color imagery where available.
- Peatland raster derivatives are from the [Greifswald Mire Centre Global Peatland Map 2.0](https://wedocs.unep.org/items/9c80f1ba-9a0e-44b3-aeb6-6b4d5f0afe47) under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/). [Harvard MAPA](https://layers.maps-huri.net/arcgis/rest/services/chornobyl/Chornobyl_Zones/MapServer/4) provides the Chornobyl Exclusion Zone. International national parks are displayed from the [UNEP-WCMC and IUCN Protected Planet map service](https://data-gis.unep-wcmc.org/server/rest/services/ProtectedSites/The_World_Database_of_Protected_Areas/MapServer).
