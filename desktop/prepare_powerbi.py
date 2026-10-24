"""Refresh only the bundled visual resources, from our built pbiviz."""
from pathlib import Path
import json
import zipfile

root = Path(__file__).resolve().parent
guid = "prosotaPowerBI06AB2DAB71384B63AC389556E181B50B"
metadata = json.loads((root.parent / "prosotaPowerBI/pbiviz.json").read_text())
version = metadata["visual"]["version"]
package = root.parent / f"prosotaPowerBI/dist/{guid}.{version}.pbiviz"
target = root / "powerbi-template/Prosota.Report/CustomVisuals" / guid
with zipfile.ZipFile(package) as archive:
    for name in ("package.json", f"resources/{guid}.pbiviz.json"):
        destination = target / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(archive.read(name))
