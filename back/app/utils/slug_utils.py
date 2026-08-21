"""URL slugs for community titles — linear-time, no regex backtracking."""

import unicodedata

_MAX_SLUG_LENGTH = 100


def slugify(title: str) -> str:
    """A lowercase, hyphenated, ascii-ish slug. Never empty: URLs are
    id-first and the slug is cosmetic, so an untranslatable title ("???")
    degrades to "topic" rather than an empty path segment."""
    normalized = unicodedata.normalize("NFKD", title)
    out: list[str] = []
    last_dash = True  # suppress leading dashes
    for ch in normalized:
        if unicodedata.combining(ch):
            continue  # Ü → U + combining mark: keep the U, skip the mark
        if ch.isalnum() and ch.isascii():
            out.append(ch.lower())
            last_dash = False
        elif not last_dash:
            out.append("-")
            last_dash = True
        if len(out) >= _MAX_SLUG_LENGTH:
            break
    slug = "".join(out).strip("-")
    return slug or "topic"
