# TELETRAAN-1

Wildfire mission control and historical NASA FIRMS data access. See the
[frontend setup](frontend/README.md) and [API query storage guide](backend/HISTORICAL_QUERIES.md).
The [historical report guide](docs/HISTORICAL_REPORT.md) documents PDF charts,
harmonized count estimates and the reproducible evidence export.

## Historical data

[Download teletraan-data-v1.zip from Google Drive](https://drive.google.com/file/d/1sw6DNckrXZRQNZCQqir76tpSXErcL8oL/view).
The portable Parquet release contains 392,568,931 canonical MODIS and S-NPP
observations. See the [release manifest](docs/data-release/RELEASE.json) and
[archive SHA-256](docs/data-release/teletraan-data-v1.zip.sha256).

From the repository root, install the downloaded archive:

```sh
python backend/scripts/import_data_release.py --archive /path/to/teletraan-data-v1.zip --output /path/to/firms-data
```

The importer verifies the manifest, file sizes, and checksums before publishing
the release directory. Set `FIRMS_DATA_ROOT` to that directory
(`/path/to/firms-data/teletraan-data-v1`) before starting the API.
