"""The vault operations the AI is allowed to perform, and their execution.

Deliberately small and deliberately additive: search, read, create, append. It
can bring things INTO the vault and it can read what is there — it cannot
rename, overwrite or delete anything, so a confused model cannot destroy work.
Every call is scoped to one vault and re-checks ownership through the same
`get_owned_vault` chokepoint the rest of the app uses.

The declarations are provider-neutral; `ai_providers` translates them into each
provider's own function-calling shape.
"""

import logging
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.services import note_service, search_service
from app.services.folder_service import ensure_folder_path

logger = logging.getLogger(__name__)

MAX_TOOL_ROUNDS = 4
_SNIPPET_CHARS = 400
_NOTE_CHARS = 8_000


TOOLS: list[dict[str, Any]] = [
    {
        "name": "search_notes",
        "description": (
            "Search the user's vault by keyword. Use this before answering "
            "anything about their notes, and before creating a note that may "
            "already exist."
        ),
        "parameters": {
            "type": "object",
            "properties": {"query": {"type": "string", "description": "Search words"}},
            "required": ["query"],
        },
    },
    {
        "name": "read_note",
        "description": "Read one note in full, by its title or folder path.",
        "parameters": {
            "type": "object",
            "properties": {"title": {"type": "string", "description": "Note title or path"}},
            "required": ["title"],
        },
    },
    {
        "name": "create_note",
        "description": (
            "Create a new markdown note in the vault. Link it to related notes "
            "by writing [[Other note]] wikilinks in the content."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "content": {"type": "string", "description": "Markdown body"},
                "folder": {"type": "string", "description": "Optional folder path"},
            },
            "required": ["title", "content"],
        },
    },
    {
        "name": "append_to_note",
        "description": (
            "Add markdown to the end of an existing note — the way to link an "
            "existing note to another one, by appending a [[wikilink]]."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Note title or path"},
                "content": {"type": "string", "description": "Markdown to append"},
            },
            "required": ["title", "content"],
        },
    },
]


async def _resolve_note(db: AsyncSession, vault_id: UUID, user_id: UUID, title: str):
    """Find a note by exact path, else by title through search."""
    by_path = await note_service.get_note_by_path(db, vault_id, user_id, title)
    if by_path.success:
        return by_path.data
    found = await search_service.search_notes(db, vault_id, user_id, q=title, limit=5)
    if not found.success:
        return None
    wanted = title.strip().lower()
    for result in found.data.get("results", []):
        if result["title"].lower() == wanted:
            note = await note_service.get_note(db, vault_id, user_id, UUID(result["id"]))
            return note.data if note.success else None
    return None


async def run_tool(
    db: AsyncSession,
    vault_id: UUID,
    user_id: UUID,
    name: str,
    args: dict[str, Any],
) -> dict[str, Any]:
    """Execute one tool call. Returns `{ok, ...}` — never raises into the loop,
    because a tool failure is something the model should see and recover from."""
    try:
        if name == "search_notes":
            found = await search_service.search_notes(db, vault_id, user_id, q=str(args.get("query", "")), limit=8)
            if not found.success:
                return {"ok": False, "error": found.message}
            return {
                "ok": True,
                "results": [
                    {
                        "title": r["title"],
                        "path": r["path"],
                        "snippet": (r.get("snippet") or "")[:_SNIPPET_CHARS],
                    }
                    for r in found.data.get("results", [])
                ],
            }

        if name == "read_note":
            note = await _resolve_note(db, vault_id, user_id, str(args.get("title", "")))
            if note is None:
                return {"ok": False, "error": "No note by that name."}
            return {
                "ok": True,
                "title": note.title,
                "path": note.path,
                "content": note.content[:_NOTE_CHARS],
            }

        if name == "create_note":
            folder = (args.get("folder") or "").strip()
            folder_id = await ensure_folder_path(db, vault_id, user_id, folder) if folder else None
            created = await note_service.create_note(
                db,
                vault_id,
                user_id,
                title=str(args.get("title", "")).strip(),
                content=str(args.get("content", "")),
                folder_id=folder_id,
            )
            if not created.success:
                return {"ok": False, "error": created.message}
            return {
                "ok": True,
                "id": str(created.data.id),
                "title": created.data.title,
                "path": created.data.path,
            }

        if name == "append_to_note":
            note = await _resolve_note(db, vault_id, user_id, str(args.get("title", "")))
            if note is None:
                return {"ok": False, "error": "No note by that name."}
            addition = str(args.get("content", "")).rstrip()
            if not addition:
                return {"ok": False, "error": "Nothing to append."}
            body = note.content.rstrip()
            updated = await note_service.update_content(
                db, vault_id, user_id, note.id, content=f"{body}\n\n{addition}\n"
            )
            if not updated.success:
                return {"ok": False, "error": updated.message}
            return {"ok": True, "id": str(note.id), "title": note.title, "path": note.path}

        return {"ok": False, "error": f"Unknown tool: {name}"}
    except Exception:  # a tool must never take the whole turn down
        logger.warning("ai tool %s failed", name, exc_info=True)
        return {"ok": False, "error": "That operation failed."}


def describe(name: str, args: dict[str, Any], result: dict[str, Any]) -> dict[str, Any] | None:
    """A record of a vault CHANGE, for the transcript. Reads are not surfaced —
    only the things the assistant actually did to the vault."""
    if not result.get("ok"):
        return None
    if name == "create_note":
        return {"kind": "created", "title": result.get("title", ""), "note_id": result.get("id", "")}
    if name == "append_to_note":
        return {"kind": "updated", "title": result.get("title", ""), "note_id": result.get("id", "")}
    return None
