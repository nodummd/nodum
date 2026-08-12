"""Markdown link/tag extraction (Obsidian-compatible).

Wikilink forms handled (see docs/research/obsidian-core-spec.md):
    [[Target]]  [[path/Target]]  [[Target|alias]]  [[Target#Heading]]
    [[Target#Heading|alias]]  [[Target#^block]]  ![[Target]] (embed)

Tags: inline ``#tag`` with Unicode letters/digits/_/-//, must contain at
least one non-numeric character; nested ``#a/b``. Not matched inside code.

Code fences, inline code spans, and YAML frontmatter are excluded before
extraction so ``[[x]]`` inside code never becomes a link.
"""

import re
from dataclasses import dataclass

_FRONTMATTER_RE = re.compile(r"\A---\n.*?\n(?:---|\.\.\.)\n", re.DOTALL)
_FENCED_CODE_RE = re.compile(r"^(```|~~~).*?^\1[^\S\n]*$", re.DOTALL | re.MULTILINE)
_INLINE_CODE_RE = re.compile(r"`[^`\n]+`")

_WIKILINK_RE = re.compile(r"(!?)\[\[([^\[\]\n]+?)\]\]")

# A tag: letters/digits/underscore/hyphen/slash, at least one non-digit overall.
_TAG_RE = re.compile(r"(?<![\w#])#([\w/-]*[^\W\d][\w/-]*)", re.UNICODE)


@dataclass(frozen=True)
class WikiLink:
    """One extracted wikilink occurrence."""

    target: str  # note title or path as written, without heading/block/alias parts
    heading: str | None  # "Heading" from [[Target#Heading]] (deepest when chained)
    block_id: str | None  # "block" from [[Target#^block]]
    alias: str | None  # display alias after |
    is_embed: bool  # ![[...]]


def strip_non_content(markdown: str) -> str:
    """Remove frontmatter, fenced code blocks, and inline code spans.

    Replaced regions keep their length as spaces? No — length preservation is
    not needed by callers; simple removal is enough for link/tag harvesting.
    """
    text = _FRONTMATTER_RE.sub("", markdown)
    text = _FENCED_CODE_RE.sub("", text)
    return _INLINE_CODE_RE.sub("", text)


def extract_wikilinks(markdown: str) -> list[WikiLink]:
    """Extract every wikilink occurrence from markdown body text."""
    text = strip_non_content(markdown)
    links: list[WikiLink] = []
    for match in _WIKILINK_RE.finditer(text):
        is_embed = match.group(1) == "!"
        inner = match.group(2).strip()
        if not inner:
            continue

        alias: str | None = None
        if "|" in inner:
            inner, alias = inner.split("|", 1)
            inner = inner.strip()
            alias = alias.strip() or None

        heading: str | None = None
        block_id: str | None = None
        if "#" in inner:
            target_part, frag = inner.split("#", 1)
            target = target_part.strip()
            frag = frag.strip()
            if frag.startswith("^"):
                block_id = frag[1:] or None
            elif frag:
                # [[Note#H1#H2]] → deepest heading wins for anchor purposes
                heading = frag.split("#")[-1].strip() or None
        else:
            target = inner

        if not target:
            continue  # [[#Heading]] — same-note link, no graph edge
        links.append(WikiLink(target=target, heading=heading, block_id=block_id, alias=alias, is_embed=is_embed))
    return links


def extract_tags(markdown: str) -> set[str]:
    """Extract inline tags (lowercased for case-insensitive matching)."""
    text = strip_non_content(markdown)
    tags: set[str] = set()
    for match in _TAG_RE.finditer(text):
        tag = match.group(1).strip("/")
        if tag:
            tags.add(tag.lower())
    return tags


def frontmatter_tags(properties: dict) -> set[str]:
    """Tags from the parsed frontmatter ``tags`` property (str or list)."""
    raw = properties.get("tags")
    if isinstance(raw, str):
        items = [raw]
    elif isinstance(raw, list):
        items = [str(t) for t in raw]
    else:
        return set()
    return {t.strip().lstrip("#").strip("/").lower() for t in items if t and str(t).strip()}


def frontmatter_aliases(properties: dict) -> list[str]:
    """Aliases from the parsed frontmatter ``aliases`` (or ``alias``) property.

    Accepts a YAML list or a comma-separated string. Deduped case-insensitively
    (original casing kept for display), capped at 20 entries of <=255 chars.
    """
    raw = properties.get("aliases", properties.get("alias"))
    if isinstance(raw, str):
        items = [part.strip() for part in raw.split(",")]
    elif isinstance(raw, list):
        items = [str(a).strip() for a in raw]
    else:
        return []
    out: list[str] = []
    seen: set[str] = set()
    for alias in items:
        if alias and len(alias) <= 255 and alias.lower() not in seen:
            seen.add(alias.lower())
            out.append(alias)
    return out[:20]
