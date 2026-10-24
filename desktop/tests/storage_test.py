import sys
from pathlib import Path
import tempfile
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import local_storage as storage


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        storage.configure(Path(self.folder.name), "test-session-secret", "http://127.0.0.1:12345")

    def tearDown(self):
        self.folder.cleanup()

    def test_rejects_escape_and_wrong_signatures(self):
        for key in ("../escape", "/absolute", "C:/escape", "a\\..\\escape"):
            with self.assertRaises(ValueError):
                storage.path_for(key)
        expiry = int(time.time()) + 60
        sig = storage.signature("model3d/a.ifc", "PUT", expiry)
        self.assertTrue(storage.verify("model3d/a.ifc", "PUT", expiry, sig))
        self.assertFalse(storage.verify("model3d/b.ifc", "PUT", expiry, sig))
        self.assertFalse(storage.verify("model3d/a.ifc", "GET", expiry, sig))
        self.assertFalse(storage.verify("model3d/a.ifc", "PUT", 1, sig))

    def test_missing_file_matches_cloud_storage_contract(self):
        from botocore.exceptions import ClientError
        with self.assertRaises(ClientError):
            storage.head_object_size("model3d/missing.ifc")
        storage.upload_bytes("model3d/a.ifc", b"IFC")
        self.assertEqual(storage.head_object_size("model3d/a.ifc"), 3)
        storage.delete_object("model3d/a.ifc")
        storage.delete_object("model3d/a.ifc")


if __name__ == "__main__":
    unittest.main()
