"""Portable logical backups. Called only with the UI/backend stopped."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tempfile
import uuid
import zipfile

WORKSPACE_DIRS = ("database", "files", "Power BI reports")

def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def validate_archive(source, destination):
    """Extract only a checked archive, never trust archive paths or sizes."""
    with zipfile.ZipFile(source) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or "manifest.json" not in names:
            raise ValueError("Invalid backup manifest")
        if archive.getinfo("manifest.json").file_size > 16 * 1024 * 1024:
            raise ValueError("Backup manifest is too large")
        manifest = json.loads(archive.read("manifest.json"))
        if manifest.get("format") != "prosota-desktop-backup" or manifest.get("version") != 1:
            raise ValueError("Unsupported backup version")
        entries = manifest.get("files", {})
        if "database.dump" not in entries or set(names) != set(entries) | {"manifest.json"}:
            raise ValueError("Backup contents do not match manifest")
        total = sum(archive.getinfo(name).file_size for name in entries)
        if total > shutil.disk_usage(destination).free - 512 * 1024 * 1024:
            raise ValueError("Not enough free space to restore this backup")
        for name, checksum in entries.items():
            part = PurePosixPath(name)
            if (part.is_absolute() or ".." in part.parts or "\\" in name or ":" in name
                    or (name != "database.dump" and not name.startswith(("files/", "Power BI reports/")))
                    or name.endswith("/")):
                raise ValueError("Invalid backup file path")
            target = destination.joinpath(*part.parts)
            if not target.resolve().is_relative_to(destination.resolve()):
                raise ValueError("Invalid backup file path")
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(name) as src, target.open("wb") as dst:
                shutil.copyfileobj(src, dst)
            if digest(target) != checksum:
                raise ValueError("Backup checksum failed")
    return manifest


def create_backup(config, pg, port):
    root = Path(config["dataDir"]).resolve()
    target = Path(config["backupPath"]).resolve()
    if target.is_relative_to(root):
        raise ValueError("Save backups outside the application data folder")
    target.parent.mkdir(parents=True, exist_ok=True)
    # One dump transaction while all application writers are stopped.
    with tempfile.TemporaryDirectory(prefix="backup-", dir=root) as staging:
        staging = Path(staging)
        run_pg(pg, "pg_dump.exe", port, config["dbPassword"], [
            "--format=custom", "--no-owner", "--no-acl",
            "--exclude-table-data=public.app_settings", "--file", str(staging / "database.dump"),
        ])
        files = {"database.dump": staging / "database.dump"}
        for directory in WORKSPACE_DIRS[1:]:
            storage = root / directory
            if storage.exists():
                for item in storage.rglob("*"):
                    if item.is_symlink() or (item.is_file() and not item.resolve().is_relative_to(storage.resolve())):
                        raise ValueError("Linked storage files cannot be backed up")
                    if item.is_file():
                        files[directory + "/" + item.relative_to(storage).as_posix()] = item
        manifest = {"format": "prosota-desktop-backup", "version": 1,
                    "files": {name: digest(item) for name, item in files.items()}}
        temporary = target.with_name(target.name + "." + uuid.uuid4().hex + ".partial")
        try:
            with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
                for name, item in files.items():
                    archive.write(item, name)
                archive.writestr("manifest.json", json.dumps(manifest))
            os.replace(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)


def run_pg(pg, executable, port, password, args):
    env = dict(os.environ, PGPASSWORD=password)
    subprocess.run([str(pg / executable), "-h", "127.0.0.1", "-p", str(port),
                    "-U", "prosota", "-d", "postgres", *args],
                   env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                   stderr=subprocess.PIPE, check=True, timeout=1800,
                   creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)


def restore_backup(config):
    """Restore to a new cluster, then swap. Retain the previous workspace."""
    root = Path(config["dataDir"]).resolve()
    staging = root / ("restore-" + uuid.uuid4().hex)
    staging.mkdir()
    # On any error retain staging for diagnosis; never delete the original.
    validate_archive(Path(config["backupPath"]), staging)
    from runner import run
    run({**config, "dataDir": str(staging), "maintenance": "load-dump"})
    rollback = root / ("before-restore-" + uuid.uuid4().hex)
    rollback.mkdir()
    journal = root / "restore-journal.json"
    journal.write_text(json.dumps({"staging": staging.name, "rollback": rollback.name,
                                  "existing": [n for n in WORKSPACE_DIRS if (root / n).exists()]}))
    moved_old, moved_new = [], []
    try:
        for name in WORKSPACE_DIRS:
            if (root / name).exists():
                (root / name).rename(rollback / name)
                moved_old.append(name)
            if (staging / name).exists():
                (staging / name).rename(root / name)
                moved_new.append(name)
    except Exception:
        for name in reversed(moved_new):
            (root / name).rename(staging / name)
        for name in reversed(moved_old):
            (rollback / name).rename(root / name)
        journal.unlink(missing_ok=True)
        raise
    # Old data retained intentionally. Keys and browser preferences stay in root.
    (root / "last-restore.json").write_text(json.dumps({"previousWorkspace": str(rollback)}))
    journal.unlink()


def recover_interrupted_restore(root):
    journal = root / "restore-journal.json"
    if not journal.exists():
        return
    value = json.loads(journal.read_text())
    paths = [root / value[k] for k in ("staging", "rollback")]
    if any(p.parent.resolve() != root.resolve() or not p.is_dir() for p in paths):
        raise ValueError("Invalid restore recovery journal; original data retained")
    staging, rollback = paths
    for name in WORKSPACE_DIRS:
        old = rollback / name
        current = root / name
        if old.exists() or name not in value["existing"]:
            if current.exists():
                current.rename(staging / (name + "-interrupted"))
            if old.exists():
                old.rename(current)
    journal.unlink()
