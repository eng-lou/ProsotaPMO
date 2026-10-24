"""Desktop workers must not inherit the backend's parent-lifetime stdin pipe."""
import json
import os
from pathlib import Path
import subprocess
import sys

from fastapi import HTTPException


def run_worker(module, source: Path, output: Path, timeout: int):
    env = dict(os.environ)
    env["PYTHONPATH"] = os.pathsep.join(sys.path)
    env["PYTHONUTF8"] = "1"
    try:
        result = subprocess.run(
            [sys.executable, str(Path(module.__file__).resolve()), str(source), str(output)],
            env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
            timeout=timeout, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(504, "Local IFC processing timed out.")
    except OSError:
        raise HTTPException(503, "The local IFC processor could not start.")
    if result.returncode:
        report = output.with_suffix(".error.json")
        if report.exists():
            failure = json.loads(report.read_text(encoding="utf-8"))
            if failure.get("kind") == "snapshot":
                raise HTTPException(422, failure["message"])
        raise HTTPException(503, "The local IFC processor failed. No planning data was imported.")
    if not output.is_file():
        raise HTTPException(503, "The local IFC processor returned no result.")
