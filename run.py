"""Start Teletraan One and its historical API on localhost."""

import json
import os
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, build_opener


ROOT = Path(__file__).resolve().parent
FRONTEND = ROOT / "frontend"
VENV = ROOT / ".venv"
PYTHON = VENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
PIP = VENV / ("Scripts/pip.exe" if os.name == "nt" else "bin/pip")
VITE = FRONTEND / "node_modules/vite/bin/vite.js"
HOST = "127.0.0.1"
API_PORT = 8000
SITE_PORT = 5173
API_URL = f"http://{HOST}:{API_PORT}"
SITE_URL = f"http://{HOST}:{SITE_PORT}"


def tool(name):
    executable = shutil.which(name)
    if not executable:
        raise RuntimeError(f"{name} was not found. Install Node.js with npm and reopen your terminal.")
    return executable


def prepare_dependencies():
    if not PYTHON.is_file() or not PIP.is_file():
        print("Creating the local Python environment…", flush=True)
        subprocess.run([sys.executable, "-m", "venv", str(VENV)], check=True)
    requirements = ROOT / "backend/requirements.txt"
    installed = VENV / ".teletraan-requirements.txt"
    expected = requirements.read_bytes()
    if not installed.is_file() or installed.read_bytes() != expected:
        print("Installing the API dependencies…", flush=True)
        subprocess.run([str(PYTHON), "-m", "pip", "install", "-r", str(requirements)], check=True)
        installed.write_bytes(expected)
    if not VITE.is_file():
        print("Installing the frontend dependencies…", flush=True)
        subprocess.run([
            tool("npm"), "exec", "--yes", "--package=pnpm@11.25.0", "--", "pnpm", "install", "--frozen-lockfile",
        ], cwd=FRONTEND, check=True)


def wait_for_api(api):
    opener = build_opener(ProxyHandler({}))
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline and api.poll() is None:
        try:
            with opener.open(API_URL + "/health/ready", timeout=2):
                return
        except HTTPError as error:
            with error:
                detail = json.load(error)["detail"]
            message = detail.get("message") if isinstance(detail, dict) else detail
            raise RuntimeError(f"Historical data unavailable. {message}") from error
        except (URLError, TimeoutError):
            time.sleep(0.25)
    raise RuntimeError("The historical API did not start. See the API log above.")


def main():
    processes = []
    try:
        node = tool("node")
        for port in (API_PORT, SITE_PORT):
            with socket.socket() as probe:
                if probe.connect_ex((HOST, port)) == 0:
                    raise RuntimeError(f"Port {port} is already in use. Stop the existing server and try again.")
        prepare_dependencies()

        env = {**os.environ, "VITE_FIRMS_API": API_URL, "PYTHONDONTWRITEBYTECODE": "1"}
        env.pop("FIRMS_DATA_ROOT", None)  # The local launcher uses data-path.txt.
        api = subprocess.Popen([
            str(PYTHON), "-m", "uvicorn", "app.main:app", "--app-dir", "backend",
            "--host", HOST, "--port", str(API_PORT),
        ], cwd=ROOT, env=env)
        processes.append(api)
        wait_for_api(api)

        web = subprocess.Popen([
            node, str(VITE), "--configLoader", "runner", "--host", HOST, "--port", str(SITE_PORT), "--strictPort",
        ], cwd=FRONTEND, env=env)
        processes.append(web)
        print(f"Open {SITE_URL} when Vite is ready. Press Ctrl+C here to stop the site and API.", flush=True)
        while all(process.poll() is None for process in processes):
            time.sleep(0.25)
        raise RuntimeError("A local server stopped. See the log above.")
    except KeyboardInterrupt:
        return 0
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(error, file=sys.stderr)
        return 1
    finally:
        for process in reversed(processes):
            if process.poll() is None:
                process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


if __name__ == "__main__":
    sys.exit(main())
