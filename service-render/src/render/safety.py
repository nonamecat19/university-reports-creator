"""Ingest hardening for uploaded docx files (NFR-09)."""

from __future__ import annotations

import io
import zipfile


class UnsafeDocxError(ValueError):
    pass


def check_zip_safe(data: bytes, max_decompressed_bytes: int) -> None:
    """Validates the upload is a well-formed ZIP/OOXML and its uncompressed
    size doesn't blow past the cap — a defense against zip bombs. Raises
    UnsafeDocxError on any violation."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise UnsafeDocxError("file is not a valid ZIP/OOXML archive") from exc

    bad = zf.testzip()
    if bad is not None:
        raise UnsafeDocxError(f"corrupt entry in archive: {bad}")

    total = sum(info.file_size for info in zf.infolist())
    if total > max_decompressed_bytes:
        raise UnsafeDocxError(
            f"decompressed size {total} exceeds cap {max_decompressed_bytes} (possible zip bomb)"
        )

    names = zf.namelist()
    if "word/document.xml" not in names:
        raise UnsafeDocxError("archive is not a Word OOXML document (missing word/document.xml)")


def has_macros(data: bytes) -> bool:
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        return False
    return any(name == "word/vbaProject.bin" for name in zf.namelist())
