# TELETRAAN-1

Wildfire mission control and historical NASA FIRMS data access.

## Run locally with historical data

1. Install Python (3.12 or 3.13 recommended) and Node.js (22.13 or newer, with npm). On Windows, select **Add Python to PATH** in the Python installer, then open a new terminal.
2. Download the project using **Code → Download ZIP** on GitHub and extract it. You can also clone the repository with Git.
3. Download and extract the data ZIP. The download and its extracted copy each take about 5.7 GB. The extracted `teletraan-data-v1` folder contains `RELEASE.json` and `artifacts`. [Download teletraan-data-v1.zip from Google Drive](https://drive.google.com/file/d/1sw6DNckrXZRQNZCQqir76tpSXErcL8oL/view)
4. Open `data-path.txt` in the project folder. Replace its contents with the path to the extracted folder on one line, then save as UTF-8. For example, on Windows:

   ```text
   C:\Users\YourName\Downloads\teletraan-data-v1
   ```

   If extraction created a folder inside another folder of the same name, choose the inner folder containing `RELEASE.json`. If you extract directly into the project's `data` folder, the existing `data/teletraan-data-v1` path already works.

5. Open a terminal in the project folder where `run.py` is located. On Windows, you can right-click an empty area in that folder and select **Open in Terminal**. Run:

   ```sh
   python run.py
   ```

   You can also use `py run.py` on Windows or `python3 run.py` on macOS and Linux. The first run installs dependencies and needs internet access. The launcher reads the data in place. Leave the terminal open while using the site. Press **Ctrl+C** there to stop both services.
6. Open the site and check the calendar. For a known example, load the Amazon scenario for August 2019. The calendar status changes from **Loading archive values…** to the calendar legend text once the historical values are available. The first request for an area can take longer because the API scans the archive. [Open Teletraan One](http://127.0.0.1:5173/) · [Check the Amazon calendar](http://127.0.0.1:5173/?scenario=amazon&from=2019-08-01&to=2019-08-31&metric=count)

If the launcher reports a data error, check that `data-path.txt` points to the folder containing `RELEASE.json` and that the ZIP finished extracting. If it reports that port `5173` or `8000` is in use, stop the earlier server and run the command again.

## Data verification and development

The portable Parquet release contains 392,568,931 canonical MODIS and S-NPP observations. Local startup checks the published manifest and the sizes of observation files. For full checksum verification, use the importer from the project folder. [Release manifest](docs/data-release/RELEASE.json) · [Archive SHA-256](docs/data-release/teletraan-data-v1.zip.sha256)

```sh
python backend/scripts/import_data_release.py --archive /path/to/teletraan-data-v1.zip --output /path/to/firms-data
```

You can point `data-path.txt` to the imported folder too. For a separately managed API, set `FIRMS_DATA_ROOT` to the verified release directory.

See the project guides for service configuration and exports. [Frontend setup](frontend/README.md) · [API query storage and fire zones](backend/HISTORICAL_QUERIES.md) · [Historical reports](docs/HISTORICAL_REPORT.md)
