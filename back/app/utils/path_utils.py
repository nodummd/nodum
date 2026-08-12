"""Note/folder path and title validation (Obsidian-compatible rules).

Obsidian forbids these characters in file names because they break links or
filesystems: ``* " \\ / < > : | ? # ^ [ ]``. Paths are vault-relative,
``/``-separated, and never begin or end with ``/``.
"""

import re

from app.constants.limits import MAX_FOLDER_DEPTH, MAX_PATH_LENGTH, MAX_TITLE_LENGTH

# Characters invalid in a single path segment (note title or folder name)
_INVALID_SEGMENT_CHARS = re.compile(r'[*"\\/<>:|?#^\[\]]')


def validate_segment(name: str) -> str | None:
    """Validate a single title/folder name. Returns an error message or None."""
    if not name or not name.strip():
        return "Name cannot be empty."
    if len(name) > MAX_TITLE_LENGTH:
        return f"Name is longer than {MAX_TITLE_LENGTH} characters."
    if name != name.strip():
        return "Name cannot start or end with whitespace."
    if name in (".", ".."):
        return "Name is reserved."
    match = _INVALID_SEGMENT_CHARS.search(name)
    if match:
        return f'Character "{match.group()}" is not allowed in names.'
    return None


def join_path(folder_path: str | None, name: str) -> str:
    """Build a full path from a folder path (may be None/empty) and a name."""
    return f"{folder_path}/{name}" if folder_path else name


def validate_depth(path: str) -> str | None:
    """Ensure the path does not exceed limits."""
    if len(path) > MAX_PATH_LENGTH:
        return f"Path is longer than {MAX_PATH_LENGTH} characters."
    if path.count("/") + 1 > MAX_FOLDER_DEPTH:
        return f"Folders cannot nest deeper than {MAX_FOLDER_DEPTH} levels."
    return None


def count_words(text: str) -> int:
    """Word count matching the editor status bar (whitespace-separated tokens)."""
    return len(text.split())
