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


def _strip_fenced_code(text: str) -> str:
    """Remove fenced code blocks in a single linear pass.

    This replaces ``^(```|~~~).*?^\\1[^\\S\\n]*$`` with DOTALL|MULTILINE, which
    backtracked quadratically: an opening fence with no valid closing fence
    made ``.*?`` expand across the whole remaining document before failing, and
    the engine then retried from every subsequent fence. Measured at exactly 4x
    per doubling — 3s at 80KB, extrapolating to ~35 minutes at the 2MB note
    cap. Because link/tag extraction is synchronous CPU work inside an async
    handler, that froze the entire uvicorn worker, not just the one request.

    Semantics preserved from the regex: the fence must start at column 0, and
    the closing line must contain only the same marker plus trailing blanks.

    One deliberate change: an unterminated fence now swallows the rest of the
    document rather than being ignored, which is what CommonMark and Obsidian
    both do.
    """
    out: list[str] = []
    fence: str | None = None
    # split("\n"), not splitlines(): splitlines() also breaks on \v, \f, \x85
    # and U+2028/9, which MULTILINE ^/$ do not treat as line boundaries. A note
    # with a form feed inside a code block would otherwise close the fence
    # early and leak [[links]] out of code.
    for line in text.split("\n"):
        if fence is None:
            if line.startswith(("```", "~~~")):
                fence = line[:3]
                continue
            out.append(line)
        elif line.startswith(fence) and not line[len(fence) :].strip(" \t"):
            fence = None
    return "\n".join(out)


def strip_non_content(markdown: str) -> str:
    """Remove frontmatter, fenced code blocks, and inline code spans.

    Replaced regions keep their length as spaces? No — length preservation is
    not needed by callers; simple removal is enough for link/tag harvesting.
    """
    text = _FRONTMATTER_RE.sub("", markdown)
    text = _strip_fenced_code(text)
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


def remove_wikilinks(markdown: str, targets: set[str]) -> tuple[str, int]:
    """Remove ``[[wikilink]]`` occurrences whose target matches (case-insensitive).

    The inverse of appending a link. Embeds (``![[...]]``) are left alone —
    deleting one deletes content, not a connection. Links inside frontmatter,
    fenced code and inline code are protected, mirroring extract_wikilinks.
    A list line left holding nothing but its bullet is dropped entirely.
    Returns the new markdown and how many links were removed.
    """
    wanted = {t.strip().lower() for t in targets if t and t.strip()}
    if not wanted:
        return markdown, 0

    fm = _FRONTMATTER_RE.match(markdown)
    head = markdown[: fm.end()] if fm else ""
    body = markdown[fm.end() :] if fm else markdown

    out: list[str] = []
    removed = 0
    fence: str | None = None
    for line in body.split("\n"):
        if fence is None and line.startswith(("```", "~~~")):
            fence = line[:3]
            out.append(line)
            continue
        if fence is not None:
            if line.startswith(fence) and not line[len(fence) :].strip(" \t"):
                fence = None
            out.append(line)
            continue
        protected = [m.span() for m in _INLINE_CODE_RE.finditer(line)]
        spans: list[tuple[int, int]] = []
        for m in _WIKILINK_RE.finditer(line):
            if m.group(1) == "!":
                continue
            if any(a <= m.start() < b for a, b in protected):
                continue
            inner = m.group(2).strip()
            if "|" in inner:
                inner = inner.split("|", 1)[0].strip()
            if "#" in inner:
                inner = inner.split("#", 1)[0].strip()
            if inner.lower() in wanted:
                spans.append(m.span())
        if not spans:
            out.append(line)
            continue
        removed += len(spans)
        for a, b in reversed(spans):
            line = line[:a] + line[b:]
        if line.strip() in ("", "-", "*", "+"):
            continue  # the line was only the link (maybe a list bullet) — drop it
        out.append(line.rstrip())
    return head + "\n".join(out), removed
