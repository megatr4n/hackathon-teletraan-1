# FIRMS evidence report

The historical PDF exports the selected API query and inclusive UTC period. It uses archived FIRMS observations from the verified Parquet release, never scenario-generated demo values. The existing synthetic demo export remains labeled separately.

## User workflow

1. Open the application with `VITE_FIRMS_API` configured and select an area, period and orbital pass.
2. Use **Export Statistical Report (PDF)** for charts, tables and methods.
3. Use **Export Report Evidence (JSON)** for the exact response and derived data. Keep this alongside the PDF for independent checking.

Both exports validate the daily series against platform summaries before downloading. A stale backend without the new response fields produces an actionable error rather than a partial historical report. The JSON and PDF are separate downloads to avoid a browser multiple-download permission prompt. Query ID, period and manifest hash identify the same immutable selection; generation timestamps may differ.

The report follows the selected area, not the extent of the map viewport. In particular, `ua-east` is the configured regional bounding box `[22, 44, 40.5, 52.5]`, **not just the Chernobyl exclusion zone or wildfire perimeter**. Bounds and this distinction are printed in the PDF. A circle or custom polygon produces a different exact spatial selection.

## Count graph requested for the export

- Raw MODIS uses Terra through **2002-07-03** and Aqua from **2002-07-04**. If the selected platform has no records on the UTC date, the result is null. Overpasses are not deduplicated into unique fires.
- Harmonized MODIS uses Terra records through **2002-07-03** and Aqua records from **2002-07-04**. Multiply that platform's daily detection count by `K_COUNT[pass]` from `config/modis_viirs_coefficients.csv`. The estimate is null on days without records from the selected platform.
- S-NPP VIIRS = observed VIIRS detection records, available from the archive boundary **2012-01-20**. No value is drawn before that boundary; gaps remain null. MODIS is never substituted into this series.
- The chart shows raw MODIS and a single harmonized series across the Terra-to-Aqua transition. From the VIIRS archive start, a third series shows observed VIIRS.
- Up to 120 requested days: daily observations. Longer periods: calendar-month mean daily values, divided by each series' **own number of days with records**. Partial months are retained. A month crossing the Terra-to-Aqua transition uses the estimate from the correct platform on each day. The evidence JSON records the selected platform for each date and the number of available estimates for each month. No smoothing or invented zeros are used.
- The monthly bin containing an archive boundary is placed on or after that date. Other monthly bins are plotted at the midpoint of their requested dates.

Configured count coefficients (unchanged by this implementation):

| Pass | K_COUNT |
| --- | ---: |
| all | 6.73297434273044 |
| day | 4.9919362253313935 |
| night | 18.82703433766624 |

The historical panel, calendar and report use the same daily platform rule. The all-pass coefficient is 6.73297434273044 for both platforms in their respective periods. The day and night filters use their respective coefficients.

## PDF contents

1. Selection, UTC period, actual bounds, source release, manifest SHA-256 and query ID.
2. Raw and harmonized MODIS (Terra to Aqua) and observed VIIRS detection series.
3. Raw FRP in separate Aqua, S-NPP and Terra panels, with a shared vertical scale.
4. Detection-record availability by platform and counts of missing FRP records.
5. Period totals, valid and missing FRP records, means, median, 95th percentile, peaks and the selected day.
6. Matched-day sensor differences and the five highest raw MODIS FRP days.
7. Seasonal Z-scores with unavailable-status counts and selected-day reference sample sizes.
8. Annual count ledger, paginated for long periods.
9. Formulas, limitations and links to official NASA field definitions.

Tables show at most two decimal places for derived values and FRP; observations and calculations retain full numerical precision in evidence JSON. Raw record counts are integers. The report uses a bundled Unicode font and vector charts, with no screenshot of the map or added chart library.

## Scientific definitions and limitations

FRP is power in MW. Summing sampled FRP readings across overpasses or days does not yield fire radiative energy. This report does not convert FRP to FRE, emissions, losses or burned area. Missing records do not mean confirmed absence of fire or guaranteed satellite coverage. Invalid FRP remains missing while its record still contributes to detection counts.

Means and quantiles use valid observed daily values only. Quantiles interpolate linearly between sorted observations at index `(n - 1) * q`. Peaks use the maximum observed daily sum. Acquisition coverage is unavailable; reported record-day fractions are not acquisition completeness.

Count comparison diagnostics include **only dates with both Aqua MODIS and VIIRS values**, using the same matched dates for raw Aqua and adjusted Aqua. Here `e` is the difference between the Aqua count (raw or adjusted) and VIIRS.

- MAE = mean absolute difference in counts.
- Mean difference = mean signed difference in counts.
- WAPE = `100 * sum(abs(e)) / sum(VIIRS)`.
- Relative bias = `100 * sum(e) / sum(VIIRS)`.

No pairs or a zero VIIRS denominator yields `N/A`, never zero error. VIIRS is a comparison sensor, not ground truth. These diagnostics are conditional sample agreement, not a holdout evaluation or proof of worldwide accuracy. Coefficient uncertainty is not known, so no confidence interval is invented.

Seasonal Z-scores come from `modis-observed-frp-seasonal-v1`: raw daily MODIS FRP, a calendar-day window of +/-7 days, the target year excluded, at least eight other reference years and sample standard deviation. The existing backend method handles the year boundary and leap-year calendar. For long periods the chart shows the mean of available daily Z-scores in each month, not a newly computed monthly Z-score. No risk probability or harm estimate is derived from it.

## API additions

`GET /api/v2/queries/{query_id}/report-data?date=YYYY-MM-DD&start=YYYY-MM-DD&end=YYYY-MM-DD`

Existing `day`, `period`, provenance and `methodology` fields are retained. Additions:

- `report_start`, `report_end`: resolved inclusive report bounds.
- `area`: exact original area request, including custom geometry when supplied.
- `area_bounds`: west, south, east, north of the effective selection.
- `series`: one ordered `CalendarDay` for **every requested date**, including gaps, with per-platform counts, FRP, pass breakdown, record status and Z-score metadata.

The selected day may lie outside the report subperiod, but must lie inside the parent query. PDF labels it separately. Missing bounds default to the parent query. Reversed/out-of-query bounds return HTTP 422. Both frontend and backend must be deployed for this export version; no migration or data regeneration is required.

Evidence JSON uses `report_version: firms-evidence-v3`, the unchanged source response and deterministic derivations (count formula, selected and available coefficients, daily counts, chart bins, denominators and comparison statistics). It contains no access token or FIRMS API key.

## Verification and preview

From the repository root:

```sh
PYTHONPATH=backend python -m unittest discover -s backend/tests -v
```

From `frontend`:

```sh
node tests/report-analysis.test.mjs
npx tsc -b
NODE_OPTIONS=--max-old-space-size=8192 npm run build
node scripts/render-historical-report.mjs response.json report.pdf 'Actual area label'
```

The renderer uses the exact browser PDF builder and bundled font, producing a PDF and evidence JSON without a running browser or simulated data. A saved `/report-data` response is required. Render with Poppler for visual QA.

Implementation checks include the 2002 Aqua and 2012 VIIRS boundaries, Terra-to-Aqua switching for all three orbital-pass coefficients and agreement between the panel and report, missing VIIRS without fallback, missing FRP with valid counts, partial months, observed-day denominators, matched-day diagnostics, malformed/stale payload rejection, and the API-to-Parquet report period contract.

A real archive verification on the `ua-east` preset for April 2020 independently queried raw Parquet with DuckDB and matched all 90 platform/day records:

| Platform | Detections | Sum sampled FRP (MW) |
| --- | ---: | ---: |
| Aqua | 6,978 | 270,452.70 |
| S-NPP | 38,590 | 339,391.69 |
| Terra | 5,748 | 216,175.10 |

These figures cover the full configured regional box. They must not be described as the Chernobyl fire's totals.

## Sources

- [NASA FIRMS MODIS field definitions](https://firms.modaps.eosdis.nasa.gov/content/descriptions/FIRMS_MODIS_Firehotspots.html)
- [NASA FIRMS VIIRS field definitions](https://firms.modaps.eosdis.nasa.gov/content/descriptions/FIRMS_VIIRS_Firehotspots.html)
- Local release provenance: `docs/data-release/RELEASE.json`.
- Project coefficients: `config/modis_viirs_coefficients.csv`.

The full production build and TypeScript check passed. The production build needed an 8 GiB Node heap limit on the verification machine; this is a build-process setting, not an increase in browser memory use. Poppler rendering and text-bound checks covered all pages of the 10-page archive and 9-page monthly examples. Browser clicking/download UI was not automated; previews use the exact export renderer.
