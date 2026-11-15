from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from app.routes import historical
from app.services import historical_data

app = FastAPI(
    title="TELETRAAN-1 // NASA FIRMS PyroHarmonizer API",
    description="High-performance Earth Observation & Wildfire Analytical Server",
    version="2.2.0"
)

# CORS setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=4096, compresslevel=3)

# Register routes
app.include_router(historical.router)

@app.get("/")
@app.get("/health/live")
def health_check():
    return {
        "system": "TELETRAAN-1",
        "status": "ONLINE",
        "version": "2.2.0",
        "engine": "DuckDB"
    }


@app.get("/health/ready")
def readiness():
    release = historical.get_release()
    try:
        start, end = historical_data.RANGES["modis"]
        release.paths(historical_data.SENSOR, start, end, "observations")
        historical_data.geography_file("countries")
    except (historical_data.DatasetUnavailable, OSError, ValueError) as error:
        raise HTTPException(503, "Historical data or geography is unavailable") from error
    return {"status": "READY", "dataset_release": release.id}
