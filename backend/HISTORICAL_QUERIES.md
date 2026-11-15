# FIRMS historical query storage

Uvicorn workers share query metadata through a local directory. By default the
API uses `teletraan-firms-queries` in Python's system temporary directory. Set
`FIRMS_QUERY_DIR` to an absolute directory to choose its location. Point every
worker to the same writable directory on the server. Keep this state separate
from the read-only FIRMS release. Independent hosts with separate filesystems
need request affinity.

Query IDs expire after two hours. When a worker serves a different release or
geometry version, clients receive HTTP 410 and must create the query again.

## Historical fire zones

Build the global index once for the installed, verified release. The command reads the archive in place.

```powershell
$env:FIRMS_DATA_ROOT = '<verified-release-directory>'
python backend/scripts/build_fire_zones.py
```

The builder writes a release-specific GeoJSON under `data/work/fire-zones`. Set `FIRMS_ZONE_DIR` on both the builder and API to use another index directory. Rebuild after updating the release or the zone methodology. The generated index stays outside Git. The API starts with a verified release alone. The fire-zones endpoint returns HTTP 503 until its index is available.

`POST /api/v2/fire-zones` accepts an `area` using the same country, administrative region, ecoregion, preset, circle, or polygon schema as `POST /api/v2/queries`. It returns whole historical zone polygons intersecting the selection, with the source period and the range of years with detections supporting each polygon. The map's **Historical fire zones** control switches the map from daily detections to these polygons. Calendar dates and pass filters do not affect them.

The index uses vegetation-fire detections with MODIS confidence of at least 30 over the full MODIS period in the release. Each calendar year contributes at most one occurrence per approximately 5 km sampling cell across Terra and Aqua. Candidates must appear in at least 60% of archive calendar years and fall in the worldwide top 10% of observed cells by years with detections. A tied group at the cutoff is retained only if the entire group fits. At least three nearby candidates are needed for a cluster or a nested band. The 80% and 90% recurrence thresholds define the inner bands. Polygons follow concave envelopes around representative detection locations with fixed display margins of 4, 3, and 2 km. These margins are heuristic, and the partial first calendar year contributes where observations exist.

Use the layer for preliminary site screening. The boundaries show historical recurrence of satellite detections. Parcel-level assessment and future fire probability require additional evidence, including vegetation, terrain, and local hazard modelling.
