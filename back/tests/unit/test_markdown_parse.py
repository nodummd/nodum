"""Unit tests for wikilink/tag extraction."""

from app.utils.markdown_parse import extract_tags, extract_wikilinks, frontmatter_tags


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
