"""Unit tests for the import converters.

Converters are pure functions — bytes in, normalised markdown out — which is
the whole reason the subsystem is shaped this way: every source can be tested
against a realistic fixture with no database, no object store and no network.

The assertions lean towards the things that are silently wrong rather than
loudly broken: an attachment that vanishes, a link that stops resolving, a
checklist that loses its checked state. Those are the failures a person only
notices months after they have deleted the original.
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import zipfile

import pytest

from app.services import importers
from app.services.importers import (
    discord,
    evernote,
    google_keep,
    joplin,
    mail,
    notion,
    plain,
    roam,
    slack,
    standard_notes,
    telegram,
)
from app.services.importers.base import ImportError_, safe_segment, strip_notion_id, unique_path


def zip_bytes(files: dict[str, bytes | str]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, data in files.items():
            archive.writestr(name, data if isinstance(data, bytes) else data.encode("utf-8"))
    return buffer.getvalue()


def paths(result) -> set[str]:
    return {f.path for f in result.files}


def body(result, path: str) -> str:
    for f in result.files:
        if f.path == path:
            return f.data.decode("utf-8")
    raise AssertionError(f"{path} not produced; got {sorted(paths(result))}")


# ── the catalogue ───────────────────────────────────────────────────────────


def test_catalogue_is_complete_and_well_formed() -> None:
    catalog = importers.catalog()
    assert len(catalog) >= 15
    ids = [s["id"] for s in catalog]
    assert len(ids) == len(set(ids)), "duplicate source id"
    for source in catalog:
        # Every card has to be able to render: a name, a blurb, an icon and —
        # the part people actually need — instructions for the export itself.
        assert source["name"] and source["blurb"] and source["icon"]
        assert source["steps"], f"{source['id']} has no export instructions"
        assert source["accepts"], f"{source['id']} accepts no file types"
        assert source["category"] in importers.CATEGORY_LABELS
        assert source["accent"].startswith("#")


def test_every_source_has_a_working_converter() -> None:
    for source in importers.SOURCES:
        assert callable(source.converter), source.id
        # An empty upload must fail cleanly rather than raise something the API
        # would turn into a 500.
        with pytest.raises(ImportError_):
            source.converter([("empty.zip", zip_bytes({}))])


# ── helpers ─────────────────────────────────────────────────────────────────


def test_notion_id_stripping() -> None:
    assert strip_notion_id("Project Plan 1a2b3c4d5e6f7890abcdef1234567890") == "Project Plan"
    assert strip_notion_id("Notes 0123456789abcdef0123456789abcdef.md") == "Notes.md"
    # A title that merely contains hex must survive untouched.
    assert strip_notion_id("Deadbeef recipes") == "Deadbeef recipes"


def test_safe_segment_strips_path_and_windows_hazards() -> None:
    assert "/" not in safe_segment("a/b")
    assert safe_segment("  ..  ") == "Untitled"
    # Windows silently drops a trailing dot, which would collide two notes.
    assert safe_segment("Report.") == "Report"
    assert safe_segment("") == "Untitled"


def test_unique_path_keeps_every_collision() -> None:
    taken: set[str] = set()
    first = unique_path(taken, "Keep/Untitled.md")
    second = unique_path(taken, "Keep/Untitled.md")
    third = unique_path(taken, "Keep/Untitled.md")
    assert len({first, second, third}) == 3
    assert all(p.endswith(".md") for p in (first, second, third))


# ── Evernote ────────────────────────────────────────────────────────────────

ENEX_IMAGE = b"\x89PNG\r\n\x1a\nfake"


def _enex() -> bytes:
    digest = hashlib.md5(ENEX_IMAGE, usedforsecurity=False).hexdigest()
    encoded = base64.b64encode(ENEX_IMAGE).decode()
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<en-export>
  <note>
    <title>Recipe</title>
    <content><![CDATA[<en-note><div>Mix <b>flour</b> and water.</div>
    <en-media hash="{digest}" type="image/png"/></en-note>]]></content>
    <created>20240115T093000Z</created>
    <updated>20240116T101500Z</updated>
    <tag>cooking</tag>
    <tag>weekend baking</tag>
    <note-attributes><source-url>https://example.com/r</source-url></note-attributes>
    <resource>
      <data encoding="base64">{encoded}</data>
      <mime>image/png</mime>
      <resource-attributes><file-name>bread.png</file-name></resource-attributes>
    </resource>
  </note>
</en-export>""".encode()


def test_evernote_note_body_tags_and_attachment() -> None:
    result = evernote.convert([("Recipes.enex", _enex())])
    note = body(result, "Recipes/Recipe.md")

    assert "# Recipe" in note
    assert "**flour**" in note
    assert "source: evernote" in note
    # Unquoted, so YAML reads it as a real timestamp and the properties UI
    # gives a date field rather than a text box.
    assert "created: 2024-01-15T09:30:00+00:00" in note
    assert "https://example.com/r" in note
    # A label with a space must become one tag, not two.
    assert "- weekend-baking" in note
    # The <en-media> hash has to resolve back to the resource's filename, or
    # every image in a migrated library silently disappears.
    assert "![[bread.png]]" in note
    assert "Recipes/attachments/bread.png" in paths(result)


def test_evernote_unresolved_media_is_flagged_not_dropped() -> None:
    enex = b"""<?xml version="1.0"?><en-export><note><title>T</title>
    <content><![CDATA[<en-note>x<en-media hash="deadbeef" type="image/png"/></en-note>]]></content>
    </note></en-export>"""
    note = body(evernote.convert([("a.enex", enex)]), "a/T.md")
    assert "attachment missing" in note


def test_evernote_rejects_a_non_enex_upload() -> None:
    with pytest.raises(ImportError_, match="Export notes"):
        evernote.convert([("notes.txt", b"not enex")])


# ── Google Keep ─────────────────────────────────────────────────────────────


def test_google_keep_checklist_labels_and_archive_folder() -> None:
    note = {
        "title": "Shopping",
        "listContent": [
            {"text": "Milk", "isChecked": True},
            {"text": "Bread", "isChecked": False},
        ],
        "labels": [{"name": "Home errands"}],
        "isArchived": True,
        "createdTimestampUsec": 1_700_000_000_000_000,
        "userEditedTimestampUsec": 1_700_000_100_000_000,
    }
    archive = zip_bytes({"Takeout/Keep/Shopping.json": json.dumps(note)})
    result = google_keep.convert([("takeout.zip", archive)])

    text = body(result, "Google Keep/Archive/Shopping.md")
    # Checked state is the thing a naive importer loses.
    assert "- [x] Milk" in text
    assert "- [ ] Bread" in text
    assert "- Home-errands" in text
    assert "source: google-keep" in text


def test_google_keep_matches_attachments_despite_extension_mismatch() -> None:
    # Takeout genuinely does this: the JSON says .jpeg, the file is .jpg.
    note = {"title": "Photo", "textContent": "", "attachments": [{"filePath": "img.jpeg"}]}
    archive = zip_bytes({"Takeout/Keep/Photo.json": json.dumps(note), "Takeout/Keep/img.jpg": b"\xff\xd8\xff"})
    result = google_keep.convert([("t.zip", archive)])
    assert "![[img.jpg]]" in body(result, "Google Keep/Photo.md")
    assert "Google Keep/attachments/img.jpg" in paths(result)


def test_google_keep_untitled_notes_do_not_collide() -> None:
    archive = zip_bytes(
        {
            "Takeout/Keep/a.json": json.dumps({"textContent": "one"}),
            "Takeout/Keep/b.json": json.dumps({"textContent": "two"}),
        }
    )
    result = google_keep.convert([("t.zip", archive)])
    assert result.note_count == 2
    assert len(paths(result)) == 2


# ── Notion ──────────────────────────────────────────────────────────────────


def test_notion_strips_ids_and_rewrites_links_to_wikilinks() -> None:
    hex_a = "1a2b3c4d5e6f7890abcdef1234567890"
    hex_b = "0987654321fedcbaabcdef0123456789"
    archive = zip_bytes(
        {
            f"Export/Plan {hex_a}.md": f"# Plan\n\nSee [Budget](Budget%20{hex_b}.md) for costs.\n",
            f"Export/Budget {hex_b}.md": "# Budget\n\nNumbers.\n",
        }
    )
    result = notion.convert([("notion.zip", archive)])

    assert "Export/Plan.md" in paths(result)
    assert "Export/Budget.md" in paths(result)
    # The link must become a wikilink, or it points at a file that no longer
    # exists under that name and the graph stays empty.
    assert "[[Budget]]" in body(result, "Export/Plan.md")
    assert "source: notion" in body(result, "Export/Plan.md")


def test_notion_external_links_are_left_alone() -> None:
    archive = zip_bytes({"E/Page 1a2b3c4d5e6f7890abcdef1234567890.md": "[docs](https://example.com)"})
    assert "(https://example.com)" in body(notion.convert([("n.zip", archive)]), "E/Page.md")


def test_notion_database_csv_becomes_a_table() -> None:
    csv_data = "Name,Status\nAlpha,Done\nBeta,Todo\n"
    archive = zip_bytes({"Export/Tasks 1a2b3c4d5e6f7890abcdef1234567890.csv": csv_data})
    result = notion.convert([("n.zip", archive)])
    table = body(result, "Export/Tasks (database).md")
    assert "| Name | Status |" in table
    assert "| Alpha | Done |" in table


# ── Roam ────────────────────────────────────────────────────────────────────


def test_roam_nests_blocks_and_resolves_block_refs() -> None:
    export = [
        {
            "title": "Ideas",
            "children": [
                {"string": "Top level", "uid": "aaa", "children": [{"string": "Nested", "uid": "bbb"}]},
                {"string": "Points at ((bbb))", "uid": "ccc"},
            ],
        }
    ]
    result = roam.convert([("roam.json", json.dumps(export).encode())])
    note = body(result, "Roam/Ideas.md")
    assert "- Top level" in note
    assert "    - Nested" in note
    # The reference resolves to its text rather than leaving a dead ((uid)).
    assert "“Nested”" in note
    assert "((bbb))" not in note
    assert any("block reference" in w for w in result.warnings)


def test_roam_preserves_wikilinks_and_tags_verbatim() -> None:
    export = [{"title": "P", "children": [{"string": "See [[Other]] and #topic", "uid": "x"}]}]
    note = body(roam.convert([("r.json", json.dumps(export).encode())]), "Roam/P.md")
    assert "[[Other]]" in note
    assert "#topic" in note


# ── Slack / Discord / Telegram ──────────────────────────────────────────────


def test_slack_groups_by_day_and_builds_indexes() -> None:
    archive = zip_bytes(
        {
            "users.json": json.dumps([{"id": "U1", "profile": {"display_name": "Ada"}}]),
            "channels.json": json.dumps([{"name": "design", "purpose": {"value": "Design chat"}}]),
            "design/2024-01-15.json": json.dumps(
                [
                    {"user": "U1", "ts": "1705312200.0", "text": "Ping <@U1> see <https://x.com|docs>"},
                    {"user": "U1", "ts": "1705312300.0", "subtype": "channel_join", "text": "joined"},
                ]
            ),
        }
    )
    result = slack.convert([("slack.zip", archive)])

    day = body(result, "Slack/design/design — 2024-01-15.md")
    assert "Ada" in day
    # Slack's angle-bracket markup is unreadable if it survives.
    assert "@Ada" in day and "<@U1>" not in day
    assert "[docs](https://x.com)" in day
    # Joins are noise and must not become message lines.
    assert "joined" not in day

    # Both index levels exist, and the channel index is named so that
    # [[design]] from anywhere resolves to it.
    assert "Slack/design/design.md" in paths(result)
    assert "[[design]]" in body(result, "Slack/Slack channels.md")
    assert "[[design — 2024-01-15]]" in body(result, "Slack/design/design.md")


def test_telegram_renders_entity_text_and_skips_service_messages() -> None:
    export = {
        "chats": {
            "list": [
                {
                    "name": "Saved Messages",
                    "messages": [
                        {
                            "type": "message",
                            "date": "2024-03-02T10:00:00",
                            "from": "Me",
                            "text": ["look at ", {"type": "text_link", "text": "this", "href": "https://e.com"}],
                        },
                        {"type": "service", "date": "2024-03-02T10:01:00", "action": "pin_message"},
                    ],
                }
            ]
        }
    }
    result = telegram.convert([("result.json", json.dumps(export).encode())])
    note = body(result, "Telegram/Saved Messages/Saved Messages — 2024-03-02.md")
    assert "[this](https://e.com)" in note
    assert any("service messages" in w for w in result.warnings)


def test_discord_reads_the_csv_package_shape() -> None:
    archive = zip_bytes(
        {
            "messages/c123/channel.json": json.dumps({"name": "general", "guild": {"name": "Guild"}}),
            "messages/c123/messages.csv": "ID,Timestamp,Contents,Attachments\n1,2024-02-01T09:00:00+00:00,hello,\n",
        }
    )
    result = discord.convert([("discord.zip", archive)])
    assert "Discord/Guild #general/Guild #general — 2024-02-01.md" in paths(result)
    assert any("only your own messages" in w for w in result.warnings)


# ── Joplin / Standard Notes ─────────────────────────────────────────────────


def test_joplin_rebuilds_the_notebook_tree_from_parent_ids() -> None:
    notebook = "Work\n\nid: b1\ntype_: 2\n"
    note = "Body text here\n\nid: n1\nparent_id: b1\ntitle: Standup\ntype_: 1\n"
    archive = zip_bytes({"b1.md": notebook, "n1.md": note})
    result = joplin.convert([("export.jex", archive)])
    # Without resolving parent_id this lands at the root as "n1.md".
    assert "Joplin/Work/Standup.md" in paths(result)
    assert "Body text here" in body(result, "Joplin/Work/Standup.md")


def test_standard_notes_rejects_an_encrypted_backup_clearly() -> None:
    payload = {"items": [{"content_type": "Note", "content": "004:encrypted-blob", "uuid": "u1"}]}
    with pytest.raises(ImportError_, match="decrypted"):
        standard_notes.convert([("backup.json", json.dumps(payload).encode())])


def test_standard_notes_attaches_tags_to_their_notes() -> None:
    payload = {
        "items": [
            {"content_type": "Note", "uuid": "n1", "content": {"title": "Idea", "text": "Body"}},
            {"content_type": "Tag", "uuid": "t1", "content": {"title": "research", "references": [{"uuid": "n1"}]}},
        ]
    }
    note = body(standard_notes.convert([("b.json", json.dumps(payload).encode())]), "Standard Notes/Idea.md")
    assert "- research" in note


# ── Mail ────────────────────────────────────────────────────────────────────


def test_mbox_uses_gmail_labels_as_folders_and_drops_quoted_replies() -> None:
    mbox = (
        b"From someone@example.com Mon Jan 15 09:00:00 2024\n"
        b"From: Ada <ada@example.com>\n"
        b"To: me@example.com\n"
        b"Subject: Project update\n"
        b"Date: Mon, 15 Jan 2024 09:00:00 +0000\n"
        b"X-Gmail-Labels: Work,Unread\n"
        b"Content-Type: text/plain; charset=utf-8\n"
        b"\n"
        b"Here is the update.\n"
        b"> previous message\n"
        b"> more quoted\n"
    )
    result = mail.convert([("All mail.mbox", mbox)])
    note = body(result, "Mail/Work/2024-01-15 Project update.md")
    assert "Here is the update." in note
    # "Unread" is state, not a topic — it must not become the folder.
    assert "Mail/Unread" not in " ".join(paths(result))
    assert "previous message" not in note


# ── plain / markdown ────────────────────────────────────────────────────────


def test_plain_normalises_logseq_journals_and_pages() -> None:
    archive = zip_bytes(
        {
            "graph/journals/2024_01_15.md": "- journalled",
            "graph/pages/Some Page.md": "- content",
        }
    )
    result = plain.convert([("logseq.zip", archive)])
    produced = paths(result)
    assert any(p.endswith("Journals/2024-01-15.md") for p in produced), produced
    assert any(p.endswith("Some Page.md") for p in produced), produced


def test_plain_unwraps_a_textbundle() -> None:
    archive = zip_bytes({"My Note.textbundle/text.md": "# Hi", "My Note.textbundle/assets/a.png": b"\x89PNG"})
    produced = paths(plain.convert([("bear.zip", archive)]))
    assert "My Note.md" in produced


def test_plain_skips_obsidian_config_but_keeps_notes() -> None:
    archive = zip_bytes({"V/.obsidian/app.json": "{}", "V/Note.md": "# Note"})
    produced = paths(plain.convert([("v.zip", archive)]))
    assert "V/Note.md" in produced
    assert not any(".obsidian" in p for p in produced)


def test_plain_converts_html_to_markdown() -> None:
    archive = zip_bytes({"page.html": "<h1>Title</h1><p>Some <b>bold</b> text.</p>"})
    note = body(plain.convert([("h.zip", archive)]), "page.md")
    assert "**bold**" in note


def test_html_conversion_drops_scripts() -> None:
    archive = zip_bytes({"x.html": "<p>safe</p><script>alert(1)</script>"})
    note = body(plain.convert([("h.zip", archive)]), "x.md")
    assert "safe" in note
    assert "alert(1)" not in note


# ── archive safety ──────────────────────────────────────────────────────────


def test_zip_traversal_entries_are_ignored() -> None:
    archive = zip_bytes({"../../etc/passwd.md": "# nope", "Real.md": "# yes"})
    produced = paths(plain.convert([("evil.zip", archive)]))
    assert not any(".." in p for p in produced)
    assert "Real.md" in produced


def test_macos_metadata_is_not_imported_as_notes() -> None:
    archive = zip_bytes({"__MACOSX/._Note.md": "junk", "Note.md": "# real", ".DS_Store": b"\x00"})
    produced = paths(plain.convert([("m.zip", archive)]))
    assert produced == {"Note.md"}
