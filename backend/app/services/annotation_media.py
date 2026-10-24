"""Check uploaded bytes before publishing project-owned callout media."""
import tempfile
from pathlib import Path
from app.services import object_storage

MAX_MEDIA_BYTES = 50 * 1024 * 1024


def matches_type(header, mime):
    return {
        "image/png": header.startswith(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg": header.startswith(b"\xff\xd8\xff"),
        "image/webp": header[:4] == b"RIFF" and header[8:12] == b"WEBP",
        "video/mp4": header[4:8] == b"ftyp",
        "video/webm": header.startswith(b"\x1aE\xdf\xa3"),
    }.get(mime, False)


def publish_media(row):
    key = row.storage_key + ".pending"
    if not 1 <= object_storage.head_object_size(key) <= MAX_MEDIA_BYTES:
        raise ValueError("Choose an image or video under 50 MB")
    with tempfile.TemporaryDirectory(prefix="prosota-callout-") as folder:
        file = Path(folder) / "media"
        object_storage.download_to_path(key, file)
        with file.open("rb") as stream:
            if not matches_type(stream.read(32), row.content_type):
                raise ValueError("The file does not match its image/video format")
        object_storage.upload_from_path(row.storage_key, file, row.content_type)
