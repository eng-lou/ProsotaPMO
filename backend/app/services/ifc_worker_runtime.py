"""Run native IFC workers with the same import paths as the API runtime."""
import json
import logging
import os
from pathlib import Path
import subprocess
import sys
from fastapi import HTTPException

logger = logging.getLogger(__name__)


def run_worker(module, source: Path, output: Path, timeout: int):
    # Serverless runtimes can add dependency directories to sys.path without
    # exporting PYTHONPATH. A fresh Python interpreter otherwise loses them.
    paths = [str(Path(p or os.getcwd()).resolve()) for p in sys.path]
    env = dict(os.environ)
    env['PYTHONPATH'] = os.pathsep.join(dict.fromkeys(paths))
    env['PYTHONUTF8'] = '1'
    try:
        completed = subprocess.run([sys.executable, str(Path(module.__file__).resolve()), str(source), str(output)],
            env=env, timeout=timeout, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(504, 'IFC processing timed out. No planning data was imported. Try again with a smaller file.') from exc
    except OSError as exc:
        logger.error('IFC worker could not start: %s', type(exc).__name__)
        raise HTTPException(503, 'The server could not start its IFC processor. This is a server issue, not an invalid IFC file.') from exc
    if completed.returncode:
        report = output.with_suffix('.error.json')
        if report.exists():
            failure = json.loads(report.read_text(encoding='utf-8'))
            if failure.get('kind') == 'snapshot':
                raise HTTPException(422, failure['message'])
        # Log only the failure category, never model entities or signed URLs.
        stderr = completed.stderr or b''
        category = 'missing dependency' if b'ModuleNotFoundError' in stderr or b'ImportError' in stderr else 'worker failure'
        logger.error('IFC worker failed: %s (exit %s)', category, completed.returncode)
        raise HTTPException(503, 'The server IFC processor failed to run. Your file has not been rejected and no planning data was imported. Please retry after the server fix is deployed.')
    if not output.is_file():
        raise HTTPException(503, 'The server IFC processor returned no result. No planning data was imported.')
