import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from workspace_backup import validate_archive, recover_interrupted_restore


class BackupTests(unittest.TestCase):
    def test_integrity_and_traversal(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            def make(name, checksum=None):
                contents = {"database.dump": b"dump", name: b"model"}
                with zipfile.ZipFile(root / "test.zip", "w") as archive:
                    for key, data in contents.items():
                        archive.writestr(key, data)
                    archive.writestr("manifest.json", json.dumps({
                        "format": "prosota-desktop-backup", "version": 1,
                        "files": {k: checksum or hashlib.sha256(v).hexdigest() for k, v in contents.items()}
                    }))
            target = root / "output"
            target.mkdir()
            make("files/model.ifc")
            validate_archive(root / "test.zip", target)
            self.assertEqual((target / "files/model.ifc").read_bytes(), b"model")
            make("../escape")
            with self.assertRaises(ValueError):
                validate_archive(root / "test.zip", target)
            make("files/model.ifc", "invalid")
            with self.assertRaises(ValueError):
                validate_archive(root / "test.zip", target)

    def test_interrupted_swap_recovers_original(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for path in ("rollback/database", "staging/files", "database", "files"):
                (root / path).mkdir(parents=True)
            (root / "rollback/database/original").write_text("old")
            (root / "restore-journal.json").write_text(json.dumps({
                "staging": "staging", "rollback": "rollback", "existing": ["database", "files"]
            }))
            recover_interrupted_restore(root)
            self.assertTrue((root / "database/original").exists())
            self.assertTrue((root / "staging/database-interrupted").exists())
            self.assertFalse((root / "restore-journal.json").exists())


if __name__ == "__main__":
    unittest.main()
