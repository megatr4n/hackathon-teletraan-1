from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes import historical

app = FastAPI(
    title="TELETRAAN-1 // NASA FIRMS PyroHarmonizer API",
    description="High-performance Earth Observation & Wildfire Analytical Server",
    version="2.2.0"
)

# CORS setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routes
app.include_router(historical.router)

@app.get("/")
def health_check():
    return {
        "system": "TELETRAAN-1",
        "status": "ONLINE",
        "version": "2.2.0",
        "engine": "DuckDB"
    }
