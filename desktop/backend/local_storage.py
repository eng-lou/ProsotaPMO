"""Desktop-only implementation of the web object-storage contract."""
import hashlib
import hmac
import shutil
import time
import uuid
from pathlib import Path
from urllib.parse import quote

root: Path
secret: bytes
origin: str


def configure(directory: Path, token: str, base_url: str):
    global root, secret, origin
    root = directory.resolve()
    root.mkdir(parents=True, exist_ok=True)
    secret = token.encode()
    origin = base_url


def path_for(key: str) -> Path:
    if not key or "\\" in key or ":" in key or key.startswith("/"):
        raise ValueError("Invalid storage key")
    path = (root / key).resolve()
    if not path.is_relative_to(root) or path == root:
        raise ValueError("Invalid storage key")
    return path


def signature(key: str, method: str, expires: int) -> str:
    return hmac.new(secret, f"{method}\n{key}\n{expires}".encode(), hashlib.sha256).hexdigest()


def verify(key: str, method: str, expires: int, sig: str) -> bool:
    path_for(key)
    return expires >= time.time() and hmac.compare_digest(signature(key, method, expires), sig)


def signed_url(key: str, method: str, expires_in: int) -> str:
    path_for(key)
    expires = int(time.time()) + expires_in
    return f"{origin}/desktop-storage/{quote(key, safe='/')}?expires={expires}&sig={signature(key, method, expires)}"


def presigned_put_url(key: str, content_type: str, expires_in: int = 3600) -> str:
    return signed_url(key, "PUT", expires_in)


def presigned_get_url(key: str, expires_in: int = 3600) -> str:
    return signed_url(key, "GET", expires_in)


def head_object_size(key: str) -> int:
    try:
        return path_for(key).stat().st_size
    except FileNotFoundError:
        from botocore.exceptions import ClientError
        raise ClientError({"Error": {"Code": "NoSuchKey"}}, "HeadObject")


def download_to_path(key: str, dest: Path):
    shutil.copyfile(path_for(key), dest)


def upload_from_path(key: str, src: Path, content_type=None):
    target = path_for(key)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, target)


def upload_bytes(key: str, data: bytes, content_type=None):
    target = path_for(key)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)


def delete_object(key: str):
    path_for(key).unlink(missing_ok=True)


def generate_storage_key(prefix: str, original_name: str) -> str:
    return f"{prefix}/{uuid.uuid4()}{Path(original_name).suffix}"
