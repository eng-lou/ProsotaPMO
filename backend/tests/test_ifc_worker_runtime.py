import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from fastapi import HTTPException
from app.services.ifc_worker_runtime import run_worker


class WorkerRuntimeTests(unittest.TestCase):
    def test_child_inherits_runtime_only_dependency_paths(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); deps = root/'deps'; deps.mkdir()
            (deps/'prosota_worker_test_dependency.py').write_text('VALUE = "loaded"', encoding='utf-8')
            script = root/'worker.py'; output = root/'output.json'
            script.write_text('import sys\nfrom pathlib import Path\nfrom prosota_worker_test_dependency import VALUE\nPath(sys.argv[2]).write_text(VALUE)\n', encoding='utf-8')
            # Reproduce a server runtime that modifies sys.path, not PYTHONPATH.
            with patch.object(sys, 'path', [str(deps), *sys.path]):
                old = subprocess.run([sys.executable, str(script), 'unused', str(output)], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
                self.assertNotEqual(old.returncode, 0)
                run_worker(SimpleNamespace(__file__=str(script)), root/'source', output, 10)
            self.assertEqual(output.read_text(), 'loaded')

    def test_dependency_failure_is_not_reported_as_invalid_snapshot(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            with patch('app.services.ifc_worker_runtime.subprocess.run', return_value=SimpleNamespace(returncode=1, stderr=b'ModuleNotFoundError: missing dependency')):
                with self.assertRaises(HTTPException) as error:
                    run_worker(SimpleNamespace(__file__=__file__), root/'source', root/'result', 10)
                self.assertEqual(error.exception.status_code, 503)
                self.assertIn('has not been rejected', error.exception.detail)

    def test_snapshot_validation_and_timeout_are_distinct(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); output=root/'result.json'
            output.with_suffix('.error.json').write_text(json.dumps({'kind':'snapshot','message':'No Prosota snapshot found.'}), encoding='utf-8')
            with patch('app.services.ifc_worker_runtime.subprocess.run', return_value=SimpleNamespace(returncode=1, stderr=b'')):
                with self.assertRaises(HTTPException) as error: run_worker(SimpleNamespace(__file__=__file__), root/'source', output, 10)
                self.assertEqual(error.exception.status_code,422)
            with patch('app.services.ifc_worker_runtime.subprocess.run', side_effect=subprocess.TimeoutExpired('worker',10)):
                with self.assertRaises(HTTPException) as error: run_worker(SimpleNamespace(__file__=__file__), root/'source', output, 10)
                self.assertEqual(error.exception.status_code,504)
