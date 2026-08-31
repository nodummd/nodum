"""The import catalogue: every source the modal offers, and what converts it.

One list, read by both the API (which serves it to the picker) and the import
endpoint (which runs the converter). Adding a source is a converter plus an
entry here — nothing else in the stack changes.

## Why almost everything is `kind="file"`

Because for most of these there is no other honest option, and the research
behind that is worth recording where the next person will find it:

- **Google Keep** — the Keep API is Google Workspace only. A personal
  @gmail.com account cannot authorise it at any price.
- **Gmail** — restricted scopes require an annual third-party CASA security
  assessment, five figures a year, renewed every twelve months.
- **Slack** — since May 2025, `conversations.history` is capped at one request
  per minute for new apps distributed outside the Marketplace. A modest channel
  would take days to read.
- **Discord** — a bot only sees channels it was invited to and only messages
  sent after it joined; driving a user account is a bannable offence.
- **Telegram** — the Bot API cannot read your history, and the user-level
  MTProto API needs credentials no note app should ask for.
- **Evernote** — the API is deprecated and developer tokens are withdrawn.
- **Obsidian, Logseq, Bear…** — local files. There is nothing to connect to.

`kind="connect"` is reserved for the three where a live API genuinely exists —
Notion, OneNote and Outlook — and is switched on per source once credentials
are configured, so a self-hosted instance without them shows the file route
instead of a button that cannot work.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Literal

from . import discord, evernote, google_keep, joplin, mail, notion, plain, roam, slack, standard_notes, telegram
from .base import ConvertResult, ImportError_, UploadedFile

if TYPE_CHECKING:
    from collections.abc import Callable

Category = Literal["notes", "chat", "mail"]

CATEGORY_LABELS: dict[str, str] = {
    "notes": "Notes & knowledge",
    "chat": "Chat & messaging",
    "mail": "Email",
}


@dataclass(frozen=True)
class ImportSource:
    """One card in the picker."""

    id: str
    name: str
    category: Category
    #: Card blurb — one line, says what actually comes across.
    blurb: str
    #: Ordered instructions for getting the export out of the source app. This
    #: is the part people are missing; the upload itself is never the hard bit.
    steps: list[str]
    #: File extensions the picker should accept, for the file dialog's filter.
    accepts: list[str]
    converter: Callable[[list[UploadedFile]], ConvertResult]
    #: Icon slug the frontend maps to a brand mark.
    icon: str
    #: Brand accent, for the card's icon tile.
    accent: str
    #: Surfaced first in the picker.
    popular: bool = False
    #: Honest caveats, shown before the person uploads rather than after.
    caveats: list[str] = field(default_factory=list)
    #: Set when a live API exists but is not wired up yet.
    connect_note: str | None = None

    def public(self) -> dict[str, Any]:
        """The shape the frontend consumes — everything except the converter."""
        return {
            "id": self.id,
            "name": self.name,
            "category": self.category,
            "category_label": CATEGORY_LABELS[self.category],
            "blurb": self.blurb,
            "steps": self.steps,
            "accepts": self.accepts,
            "icon": self.icon,
            "accent": self.accent,
            "popular": self.popular,
            "caveats": self.caveats,
            "connect_note": self.connect_note,
        }


_ZIP = [".zip"]
_MD = [".md", ".markdown", ".txt", ".zip"]

SOURCES: list[ImportSource] = [
    # ── Notes & knowledge ────────────────────────────────────────────────
    ImportSource(
        id="obsidian",
        name="Obsidian",
        category="notes",
        blurb="Your whole vault — folders, wikilinks and attachments, unchanged.",
        steps=[
            "Find your vault folder on disk (Obsidian → Settings → About → Open vault folder).",
            "Zip the folder, or just drag the folder itself onto this window.",
            "Wikilinks, folder structure and attachments all carry across as they are.",
        ],
        accepts=_MD,
        converter=plain.convert,
        icon="obsidian",
        accent="#7C3AED",
        popular=True,
    ),
    ImportSource(
        id="notion",
        name="Notion",
        category="notes",
        blurb="Pages, subpages and databases — with Notion's 32-character ids stripped out.",
        steps=[
            "In Notion, open the page or workspace you want, then ••• → Export.",
            "Choose format “Markdown & CSV” and turn on “Include subpages”.",
            "Notion emails you a .zip — upload it here exactly as it arrives.",
        ],
        accepts=_ZIP,
        converter=notion.convert,
        icon="notion",
        accent="#111111",
        popular=True,
        caveats=[
            "Database board, calendar and relation views become markdown tables plus individual notes.",
            "Links between pages are rewritten to [[wikilinks]] so backlinks and the graph work.",
        ],
        connect_note="A live Notion connection is possible and planned — it needs a Notion OAuth integration registered for this instance.",
    ),
    ImportSource(
        id="evernote",
        name="Evernote",
        category="notes",
        blurb="Notebooks, tags, attachments and source URLs from an .enex export.",
        steps=[
            "In Evernote, right-click a notebook → Export notes…",
            "Choose the ENEX format and save the file.",
            "Repeat per notebook if you have several, then upload them all at once.",
        ],
        accepts=[".enex", ".zip"],
        converter=evernote.convert,
        icon="evernote",
        accent="#00A82D",
        popular=True,
        caveats=["Evernote's API was deprecated, so an .enex export is the only supported way out."],
    ),
    ImportSource(
        id="apple-notes",
        name="Apple Notes",
        category="notes",
        blurb="Notes exported as markdown or HTML, folders intact.",
        steps=[
            "Apple Notes has no bulk export, so use the Exporter app for macOS (free, open source).",
            "Export as Markdown, keeping the folder structure.",
            "Drag the exported folder here, or zip it first.",
        ],
        accepts=[*_MD, ".html"],
        converter=plain.convert,
        icon="apple",
        accent="#F5A623",
        popular=True,
        caveats=["Handwriting and scanned documents do not convert to text."],
    ),
    ImportSource(
        id="google-keep",
        name="Google Keep",
        category="notes",
        blurb="Notes, checklists, labels, colours and images from Google Takeout.",
        steps=[
            "Go to takeout.google.com and click “Deselect all”.",
            "Select only “Keep”, then create the export.",
            "Upload the .zip Google sends you — no need to unpack it.",
        ],
        accepts=_ZIP,
        converter=google_keep.convert,
        icon="googlekeep",
        accent="#FBBC04",
        popular=True,
        caveats=[
            "Takeout is the only route: Google's Keep API is Workspace-only and cannot be authorised by a personal account.",
            "Checklists arrive as markdown task lists with their checked state intact.",
        ],
    ),
    ImportSource(
        id="onenote",
        name="Microsoft OneNote",
        category="notes",
        blurb="Notebooks and sections, once they are out of OneNote's own format.",
        steps=[
            "OneNote exports only .onepkg and PDF, neither of which is text — so convert first.",
            "Use the free OneNote Markdown Exporter (alxnbl/onenote-md-exporter) on Windows.",
            "Upload the markdown folder it produces.",
        ],
        accepts=[*_MD, ".html"],
        converter=plain.convert,
        icon="microsoft",
        accent="#7719AA",
        caveats=["Ink, handwriting and freeform canvas positioning have no markdown equivalent."],
        connect_note="Microsoft Graph exposes OneNote with delegated permissions — a live connection needs an Azure app registered for this instance.",
    ),
    ImportSource(
        id="roam",
        name="Roam Research",
        category="notes",
        blurb="Pages and nested blocks — [[links]] and #tags already match, so the graph fills in.",
        steps=[
            "In Roam: ••• (top right) → Export All.",
            "Choose JSON as the format.",
            "Upload the .zip or .json you get.",
        ],
        accepts=[".json", ".zip"],
        converter=roam.convert,
        icon="roamresearch",
        accent="#3A81F6",
        caveats=["Block references ((uid)) become the text they pointed at — the words stay, the live link does not."],
    ),
    ImportSource(
        id="logseq",
        name="Logseq",
        category="notes",
        blurb="Pages and journals, with journal filenames turned back into dates.",
        steps=[
            "Find your graph folder — it holds pages/ and journals/ directories.",
            "Zip it, or drag the folder straight onto this window.",
        ],
        accepts=_MD,
        converter=plain.convert,
        icon="logseq",
        accent="#85C8C8",
        caveats=["Logseq writes everything as bullets; notes arrive as outlines, which you can flatten afterwards."],
    ),
    ImportSource(
        id="joplin",
        name="Joplin",
        category="notes",
        blurb="Notes with the notebook tree rebuilt from a .jex export.",
        steps=[
            "In Joplin: File → Export → JEX - Joplin Export File.",
            "Upload the .jex file.",
            "For images too, also export as “MD - Markdown directory” and upload that.",
        ],
        accepts=[".jex", ".zip", ".md"],
        converter=joplin.convert,
        icon="joplin",
        accent="#1071D3",
    ),
    ImportSource(
        id="bear",
        name="Bear",
        category="notes",
        blurb="Notes and their images from a markdown or TextBundle export.",
        steps=[
            "In Bear, select your notes → File → Export Notes.",
            "Choose Markdown or TextBundle, and tick “Export attachments”.",
            "Upload the folder or .zip.",
        ],
        accepts=[*_MD, ".textbundle", ".textpack"],
        converter=plain.convert,
        icon="bear",
        accent="#D93A31",
    ),
    ImportSource(
        id="standard-notes",
        name="Standard Notes",
        category="notes",
        blurb="Notes and tags from a decrypted backup.",
        steps=[
            "In Standard Notes: Account → Download backup.",
            "Choose the **decrypted** backup — an encrypted one cannot be read by anything but Standard Notes.",
            "Upload the .zip or .json.",
        ],
        accepts=[".json", ".zip"],
        converter=standard_notes.convert,
        icon="standardnotes",
        accent="#086DD6",
    ),
    ImportSource(
        id="trilium",
        name="Trilium Notes",
        category="notes",
        blurb="A note subtree exported as markdown.",
        steps=[
            "Right-click a note in the tree → Export note.",
            "Choose “Markdown” and the whole subtree.",
            "Upload the .zip.",
        ],
        accepts=_MD,
        converter=plain.convert,
        icon="trilium",
        accent="#5A63C6",
    ),
    ImportSource(
        id="anytype",
        name="Anytype",
        category="notes",
        blurb="Objects exported as markdown files.",
        steps=[
            "In Anytype: Settings → Data & storage → Export.",
            "Choose Markdown, then export.",
            "Upload the folder or .zip.",
        ],
        accepts=_MD,
        converter=plain.convert,
        icon="anytype",
        accent="#FF6B4A",
    ),
    ImportSource(
        id="markdown",
        name="Markdown files",
        category="notes",
        blurb="Any folder of .md, .txt or .html files — from anywhere.",
        steps=[
            "Drag a folder or a .zip onto this window.",
            "Folder structure becomes the vault's folder tree.",
            "Existing [[wikilinks]] resolve across the whole batch as it imports.",
        ],
        accepts=[*_MD, ".html", ".htm"],
        converter=plain.convert,
        icon="markdown",
        accent="#8B8B8B",
    ),
    # ── Chat ─────────────────────────────────────────────────────────────
    ImportSource(
        id="slack",
        name="Slack",
        category="chat",
        blurb="Channels as notes — one per channel per day, with an index.",
        steps=[
            "In Slack: Settings & administration → Workspace settings → Import/Export Data.",
            "Run an export, choosing the date range you want.",
            "Upload the .zip Slack emails you.",
        ],
        accepts=_ZIP,
        converter=slack.convert,
        icon="slack",
        accent="#4A154B",
        popular=True,
        caveats=[
            "The export is the only practical route: Slack limits new apps to one history request per minute.",
            "Shared files are named but not included — Slack keeps the file contents.",
        ],
    ),
    ImportSource(
        id="discord",
        name="Discord",
        category="chat",
        blurb="Your messages, grouped by conversation and day.",
        steps=[
            "In Discord: User Settings → Data & Privacy → Request all of my data.",
            "Discord emails a download link — this can take up to 30 days.",
            "Upload the .zip.",
        ],
        accepts=_ZIP,
        converter=discord.convert,
        icon="discord",
        accent="#5865F2",
        caveats=[
            "A data package contains only your own messages, not other people's replies.",
            "Reading a server live would need a bot in every channel; scripting a user account is a bannable offence.",
        ],
    ),
    ImportSource(
        id="telegram",
        name="Telegram",
        category="chat",
        blurb="Chats and Saved Messages, one note per chat per day.",
        steps=[
            "In Telegram Desktop: Settings → Advanced → Export Telegram data.",
            "Choose JSON as the format and pick the chats you want.",
            "Upload result.json, or the whole export folder.",
        ],
        accepts=[".json", ".zip"],
        converter=telegram.convert,
        icon="telegram",
        accent="#26A5E4",
        caveats=[
            "Only Telegram Desktop can export; the mobile apps cannot.",
            "Secret chats are never exportable — they exist only on the two devices.",
        ],
    ),
    # ── Mail ─────────────────────────────────────────────────────────────
    ImportSource(
        id="gmail",
        name="Gmail",
        category="mail",
        blurb="Mail as notes, foldered by the Gmail labels you already use.",
        steps=[
            "Go to takeout.google.com and click “Deselect all”.",
            "Select only “Mail” — you can choose specific labels.",
            "Upload the .mbox file from the export.",
        ],
        accepts=[".mbox", ".zip"],
        converter=mail.convert,
        icon="gmail",
        accent="#EA4335",
        caveats=[
            "Takeout rather than an API connection: Gmail's scopes require an annual security audit costing five figures.",
            "Attachments are listed by name, not imported — they would dwarf the notes.",
        ],
    ),
    ImportSource(
        id="outlook",
        name="Outlook",
        category="mail",
        blurb="Messages exported as .eml or .mbox.",
        steps=[
            "In Outlook, select the messages you want and drag them to a folder to save as .eml.",
            "Or use File → Open & Export for a bulk export, then convert the .pst to .mbox.",
            "Upload the files or a .zip of them.",
        ],
        accepts=[".eml", ".mbox", ".zip"],
        converter=mail.convert,
        icon="microsoftoutlook",
        accent="#0078D4",
        connect_note="Microsoft Graph can read mail with delegated permissions — a live connection needs an Azure app registered for this instance.",
    ),
    ImportSource(
        id="email",
        name="Any mailbox",
        category="mail",
        blurb="Generic .mbox or .eml from any client — Thunderbird, Fastmail, Proton.",
        steps=[
            "Export your mail as .mbox (most clients) or save messages as .eml.",
            "Upload the files, or a .zip of them.",
        ],
        accepts=[".mbox", ".eml", ".zip"],
        converter=mail.convert,
        icon="maildotru",
        accent="#6B7280",
    ),
]

_BY_ID: dict[str, ImportSource] = {source.id: source for source in SOURCES}


def get_source(source_id: str) -> ImportSource | None:
    return _BY_ID.get(source_id)


def catalog() -> list[dict[str, Any]]:
    """Popular first, then alphabetical within each category."""
    order = list(CATEGORY_LABELS)
    return [
        source.public()
        for source in sorted(SOURCES, key=lambda s: (order.index(s.category), not s.popular, s.name.lower()))
    ]


__all__ = ["CATEGORY_LABELS", "SOURCES", "ConvertResult", "ImportError_", "ImportSource", "catalog", "get_source"]
