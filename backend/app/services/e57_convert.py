from __future__ import annotations

from pathlib import Path

import numpy as np
import pye57


# E57 -> XYZ conversion, done server-side (2026-08-20, per a real 14.4GB,
# 105-scan MatterPak export from Maro — a single-scan MatterPak cloud.xyz
# export, by contrast, runs ~500MB). The original design (see e57.ts's own
# now-superseded header) converted client-side in the browser via a WASM
# port — fine for a file that size, but a real export this large would
# need its entire converted text held as one JS string in a browser tab's
# memory, which has no safe way to work. Converting here instead, where
# there's real memory/disk headroom and the result can be written
# incrementally to disk, sidesteps that entirely — see site_capture.py's
# own convert_capture for how this gets called off the request's event
# loop (pye57/numpy are both synchronous, CPU/IO-bound calls; run_in_
# threadpool keeps a multi-minute conversion from freezing every other
# request the whole time).
#
# Reads and writes scan-by-scan (2026-08-20, confirmed against the real
# file: ~5-6.5M points per scan, 105 scans) rather than ever loading the
# whole multi-hundred-million-point cloud into memory at once.
# `read_scan()` (not `read_scan_raw()`) applies each scan's own registered
# pose automatically (pye57's own README distinguishes the two), so points
# across scans land in one common, correctly-merged coordinate frame
# without any manual rotation/translation math here — and already filters
# out invalid points via `cartesianInvalidState`, so nothing else needs to
# check that field.
#
# np.savetxt, not a hand-rolled faster formatter (2026-08-20) — genuinely
# not the fastest way to write ~6.5M rows of text, but correct and simple
# to verify is worth more here than shaving off render time on a rare,
# one-time, already-long conversion; worth revisiting only if a real
# conversion run proves painfully slow in practice.
def convert_e57_to_xyz(e57_path: Path, xyz_path: Path) -> int:
    e57 = pye57.E57(str(e57_path))
    total_points = 0
    with open(xyz_path, "w") as out:
        for i in range(e57.scan_count):
            fields = e57.get_header(i).point_fields
            has_color = "colorRed" in fields and "colorGreen" in fields and "colorBlue" in fields
            # ignore_missing_fields=True (2026-08-20) — confirmed directly
            # against a hand-built synthetic E57 missing
            # cartesianInvalidState (no colour/intensity/row-column either)
            # that read_scan() otherwise hard-fails on with a ValueError;
            # a real MatterPak export always carries it (confirmed against
            # Maro's own file), but nothing here should assume every E57
            # producer does.
            data = e57.read_scan(i, colors=has_color, ignore_missing_fields=True)
            x, y, z = data["cartesianX"], data["cartesianY"], data["cartesianZ"]
            count = len(x)
            if count == 0:
                continue
            if has_color:
                r, g, b = data["colorRed"], data["colorGreen"], data["colorBlue"]
            else:
                # A scan with no captured colour (rare, but the point
                # fields genuinely don't guarantee it) gets a flat
                # mid-grey rather than failing the whole conversion over
                # one scan's own missing attribute.
                r = g = b = np.full(count, 200, dtype=np.uint8)
            rows = np.column_stack([x, y, z, r, g, b])
            np.savetxt(out, rows, fmt="%.6f %.6f %.6f %d %d %d")
            total_points += count
    return total_points
