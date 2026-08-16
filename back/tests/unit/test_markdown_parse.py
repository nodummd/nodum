"""Unit tests for wikilink/tag extraction."""

from app.utils.markdown_parse import extract_tags, extract_wikilinks, frontmatter_tags, strip_non_content


def test_basic_wikilink() -> None:
    links = extract_wikilinks("See [[My Note]] for details.")
    assert len(links) == 1
    assert links[0].target == "My Note"
    assert not links[0].is_embed


def test_all_wikilink_forms() -> None:
    md = (
        "[[Plain]] [[path/Nested Note]] [[Aliased|shown text]] "
        "[[With Heading#Section]] [[Both#Sec|alias]] [[Block^ref]] "
        "[[BlockProper#^blockid]] ![[Embedded]] ![[img.png]]"
    )
    links = extract_wikilinks(md)
    by_target = {link.target: link for link in links}

    assert "Plain" in by_target
    assert "path/Nested Note" in by_target
    assert by_target["Aliased"].alias == "shown text"
    assert by_target["With Heading"].heading == "Section"
    assert by_target["Both"].heading == "Sec"
    assert by_target["Both"].alias == "alias"
    assert by_target["BlockProper"].block_id == "blockid"
    assert by_target["Embedded"].is_embed
    assert by_target["img.png"].is_embed


def test_links_in_code_ignored() -> None:
    md = "Real [[Link]]\n\n```\n[[NotALink]]\n```\n\nAnd `[[AlsoNot]]` inline."
    targets = {link.target for link in extract_wikilinks(md)}
    assert targets == {"Link"}


def test_links_in_frontmatter_ignored() -> None:
    md = '---\ntitle: x\nrelated: "[[NotALink]]"\n---\n\n[[Real]]'
    targets = {link.target for link in extract_wikilinks(md)}
    assert targets == {"Real"}


def test_same_note_heading_link_skipped() -> None:
    assert extract_wikilinks("Jump to [[#Section]]") == []


def test_tags_extraction() -> None:
    md = "Work on #projects/nodum and #Getting-Started but not#this or #123.\n\n```\n#not-a-tag\n```"
    tags = extract_tags(md)
    assert tags == {"projects/nodum", "getting-started"}


def test_frontmatter_tags() -> None:
    assert frontmatter_tags({"tags": ["Alpha", "#beta/gamma "]}) == {"alpha", "beta/gamma"}
    assert frontmatter_tags({"tags": "solo"}) == {"solo"}
    assert frontmatter_tags({}) == set()


def test_fenced_code_stripping_is_linear() -> None:
    """Guards against the quadratic regex this replaced.

    The old `^(```|~~~).*?^\\1[^\\S\\n]*$` backtracked at 4x per doubling: 3s
    for 80KB, extrapolating to ~35 minutes at the 2MB note cap — and since
    link extraction runs synchronously inside an async handler, one POST froze
    the whole worker. 400k unterminated fences is the worst case; linear
    scanning does it in well under a second.
    """
    import time

    payload = "```x\n" * 400_000
    started = time.perf_counter()
    strip_non_content(payload)
    assert time.perf_counter() - started < 2.0


def test_unterminated_fence_swallows_the_rest() -> None:
    """CommonMark/Obsidian behaviour, and a deliberate change from the regex.

    The old pattern needed a matching closing fence, so it stripped nothing
    here and [[B]] became a link. An unterminated fence now runs to EOF.
    """
    links = extract_wikilinks("[[A]]\n```\n[[B]]\n")
    assert [link.target for link in links] == ["A"]


def test_fence_must_start_at_column_zero() -> None:
    """An indented fence is not a fence — same as the regex's ^(```|~~~)."""
    links = extract_wikilinks("   ```\n[[Indented]]\n   ```\n")
    assert [link.target for link in links] == ["Indented"]


def test_closing_fence_tolerates_trailing_blanks_only() -> None:
    links = extract_wikilinks("```\n[[Hidden]]\n```   \n[[Visible]]\n")
    assert [link.target for link in links] == ["Visible"]


def test_vertical_whitespace_does_not_close_a_fence() -> None:
    """splitlines() would break on \\f and end the block early, leaking the link."""
    links = extract_wikilinks("```\n\x0c[[StillInCode]]\n```\n[[Out]]\n")
    assert [link.target for link in links] == ["Out"]
