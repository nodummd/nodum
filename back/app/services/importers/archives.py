"""Reading the containers exports arrive in: zip, tar, and loose files.

Every one of these is attacker-controlled input, so the readers here are
bounded rather than trusting. A zip bomb, a tar that writes to `/etc`, and a
1 GB single entry inside a 2 MB archive are all things people actually upload —
sometimes by accident, from a corrupted export.
"""

from __future__ import annotations

import io
import posixpath
import tarfile
import zipfile
from typing import TYPE_CHECKING

from app.constants.limits import MAX_IMPORT_ZIP_SIZE_BYTES

from .base import ImportError_, UploadedFile

if TYPE_CHECKING:
    from collections.abc import Iterator

#: Junk the desktop OSes sprinkle through archives.
_JUNK = ("__MACOSX", ".DS_Store", "Thumbs.db", ".Spotlight-V100", "desktop.ini")

#: Uncompressed output is capped at a multiple of the compressed input. A
#: legitimate markdown export compresses well but not absurdly; 200x catches a
#: zip bomb long before it exhausts the worker's memory.
_MAX_EXPANSION = 200


def is_zip(data: bytes) -> bool:
    return data[:4] in (b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08")


def is_tar(data: bytes) -> bool:
    # ustar magic sits at offset 257; also accept gzip, which JEX may use.
    return data[257:262] == b"ustar" or data[:2] == b"\x1f\x8b"


def is_junk(path: str) -> bool:
    normalised = posixpath.normpath(path)
    return (
        normalised.startswith(("..", "/"))
        or any(part in normalised for part in _JUNK)
        or posixpath.basename(normalised).startswith("._")
    )


def read_zip(data: bytes) -> Iterator[tuple[str, bytes]]:
    """Yield (path, bytes) for every real file in a zip.

    Directory entries, junk and anything escaping the archive root are dropped;
    the total uncompressed size is bounded.
    """
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise ImportError_("That file is not a readable zip archive.") from exc

    budget = max(len(data) * _MAX_EXPANSION, MAX_IMPORT_ZIP_SIZE_BYTES)
    spent = 0
    for entry in archive.infolist():
        if entry.is_dir() or is_junk(entry.filename):
            continue
        spent += entry.file_size
        if spent > budget:
            raise ImportError_("That archive expands to far more data than it should — refusing it.")
        try:
            yield posixpath.normpath(entry.filename), archive.read(entry)
        except (zipfile.BadZipFile, RuntimeError, OSError):
            # One unreadable member (encrypted, truncated) should not lose the
            # other four thousand notes.
            continue


def read_tar(data: bytes) -> Iterator[tuple[str, bytes]]:
    """Yield (path, bytes) for every real file in a tar — Joplin's JEX."""
    try:
        # Closed by the `with archive:` block below; ruff cannot see across
        # the try/except that has to wrap the open itself.
        archive = tarfile.open(fileobj=io.BytesIO(data))  # noqa: SIM115
    except tarfile.TarError as exc:
        raise ImportError_("That file is not a readable tar archive.") from exc

    budget = max(len(data) * _MAX_EXPANSION, MAX_IMPORT_ZIP_SIZE_BYTES)
    spent = 0
    with archive:
        for member in archive:
            # Symlinks and device nodes have no meaning in a note import and
            # are how tar extraction becomes arbitrary file access.
            if not member.isfile() or is_junk(member.name):
                continue
            spent += member.size
            if spent > budget:
                raise ImportError_("That archive expands to far more data than it should — refusing it.")
            handle = archive.extractfile(member)
            if handle is None:
                continue
            yield posixpath.normpath(member.name), handle.read()


def iter_files(uploads: list[UploadedFile]) -> Iterator[tuple[str, bytes]]:
    """Flatten an upload into (path, bytes), unpacking archives transparently.

    Callers get the same stream whether the person dropped a zip, a tar, a
    folder, or four loose files — which is why no converter has to care which
    of those happened.
    """
    for name, data in uploads:
        if not data:
            continue
        if is_zip(data):
            yield from read_zip(data)
        elif is_tar(data) and name.lower().endswith((".tar", ".jex", ".tgz", ".tar.gz")):
            yield from read_tar(data)
        elif not is_junk(name):
            yield posixpath.normpath(name), data


def decode(data: bytes) -> str:
    """Bytes → text, for exports that are not honest about their encoding.

    Windows-era exports are frequently cp1252 mislabelled as UTF-8; replacing
    undecodable bytes keeps the note rather than failing the whole import.
    """
    for encoding in ("utf-8-sig", "utf-8"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("cp1252", errors="replace")
