from __future__ import annotations

import math
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import yaml

# Orchestrates the vendored Cloud2BIM pipeline (app/services/cloud2bim/,
# https://github.com/VaclavNezerka/Cloud2BIM, MIT license — see that
# directory's own LICENSE.cloud2bim and each vendored file's header for
# what was patched and why) — 2026-08-20, per Maro: "pointcloud to ifc" /
# "build". Run as a real subprocess, not an in-process import, so a crash
# or hang inside someone else's ~4000-line algorithm can never take down
# this app's own server process — each call gets a fresh interpreter and a
# fresh, isolated temp working directory (the vendored script itself
# writes scratch/log files to plain relative paths like "output_xyz/",
# "images/", "log.txt", never parameterized upstream, so real isolation
# across concurrent requests comes entirely from that per-call cwd).
CLOUD2BIM_DIR = Path(__file__).resolve().parent / "cloud2bim"
CLOUD2BIM_SCRIPT = CLOUD2BIM_DIR / "cloud2entities.py"

# A real conversion (thousands of morphological-operation passes across
# every detected storey) can run for minutes on a large multi-storey scan —
# generous but not unbounded, so a genuinely stuck/broken run doesn't hang
# a request forever.
CONVERSION_TIMEOUT_SECONDS = 1800


class Cloud2BimError(RuntimeError):
    pass


# ~40 bytes/line, confirmed against both a real 521MB/13.5M-point
# MatterPak export and a 9.3GB/232M-point E57 conversion (pointCloud.ts's
# own MIN_BYTES_PER_LINE carries the identical constant/reasoning for the
# frontend's own parser).
BYTES_PER_POINT_ESTIMATE = 40

# Cloud2BIM's own wall/opening detection rasterizes at pc_resolution (2cm
# by default, see generate_ifc_from_xyz's own docstring) — a scan point
# every 15mm already massively over-samples that, so diluting a huge
# capture down to roughly this many points loses nothing the 2cm
# reconstruction could have used anyway. 20M is comfortably enough
# density at 2cm resolution for a real multi-storey building footprint
# (confirmed against the 13.5M-point/521MB reference case the pipeline
# was already tuned against — this stays undiluted, at dilution_factor 1,
# for anything at or under that scale).
TARGET_POINT_COUNT = 20_000_000


# Diluting only kicks in once a capture is large enough to need it
# (2026-08-21, per a real 232M-point/9.3GB single-scan E57 export from
# Maro that ran the full 30-minute CONVERSION_TIMEOUT_SECONDS without
# finishing) — undiluted stays the default so nothing changes for the
# already-working, already-tested smaller-scan case.
def _dilution_factor_for(xyz_path: Path) -> int:
    estimated_points = xyz_path.stat().st_size / BYTES_PER_POINT_ESTIMATE
    return max(1, math.ceil(estimated_points / TARGET_POINT_COUNT))


# pc_resolution/grid_coefficient (2026-08-20) are the one thing here that
# genuinely needs real tuning against Maro's own scan density, same spirit
# as min_points_threshold already does for Progress Variance (see that
# model's own docstring) — 0.02m is a reasonable general starting point
# for a MatterPak-scale scan, not a value verified against his real data.
# Not yet exposed as a per-request parameter; if a real conversion needs
# a different value to detect walls correctly, that's the first knob to
# expose, not a code bug to chase.
def generate_ifc_from_xyz(
    xyz_path: Path, project_name: str, building_name: str,
    author_name: str = "Prosota", author_surname: str = "User",
) -> bytes:
    with tempfile.TemporaryDirectory(prefix="cloud2bim_") as tmp:
        tmp_path = Path(tmp)
        shutil.copyfile(xyz_path, tmp_path / "input.xyz")

        dilution_factor = _dilution_factor_for(xyz_path)
        config = {
            "e57_input": False,
            "e57_files": [],
            "xyz_files": ["input.xyz"],
            "dilute": dilution_factor > 1,
            "dilution_factor": dilution_factor,
            "exterior_scan": False,
            "pc_resolution": 0.02,
            "grid_coefficient": 5,
            "bfs_thickness": 0.3,
            "tfs_thickness": 0.3,
            "min_wall_length": 0.10,
            "min_wall_thickness": 0.05,
            "max_wall_thickness": 0.75,
            "exterior_walls_thickness": 0.3,
            "output_ifc": "output.ifc",
            "ifc_project_name": project_name,
            "ifc_project_long_name": f"Generated from a Reality Capture scan ({project_name})",
            "ifc_project_version": "1.0",
            "ifc_author_name": author_name,
            "ifc_author_surname": author_surname,
            "ifc_author_organization": "Prosota",
            "ifc_building_name": building_name,
            "ifc_building_type": "Building",
            "ifc_building_phase": "Existing",
            # No real project geo-anchor plumbed through here yet (unlike
            # Site Context's own real lat/lon — see site_context.py) — an
            # honest placeholder, not a guessed real-world location.
            "ifc_site_latitude": [0, 0, 0],
            "ifc_site_longitude": [0, 0, 0],
            "ifc_site_elevation": 0.0,
            "material_for_objects": "Concrete",
        }
        config_path = tmp_path / "config.yaml"
        with open(config_path, "w") as f:
            yaml.safe_dump(config, f)

        try:
            result = subprocess.run(
                [sys.executable, str(CLOUD2BIM_SCRIPT), str(config_path)],
                cwd=tmp_path, capture_output=True, text=True, timeout=CONVERSION_TIMEOUT_SECONDS,
            )
        except subprocess.TimeoutExpired as exc:
            raise Cloud2BimError(f"Conversion timed out after {CONVERSION_TIMEOUT_SECONDS}s") from exc

        output_ifc = tmp_path / "output.ifc"
        if result.returncode != 0 or not output_ifc.exists():
            tail = (result.stderr or result.stdout or "")[-4000:]
            raise Cloud2BimError(f"Cloud2BIM conversion failed (exit {result.returncode}): {tail}")

        return output_ifc.read_bytes()
