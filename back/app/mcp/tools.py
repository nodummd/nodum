"""The tools Nodum offers over MCP — vaults, folders, notes, links, tags,
colours, the graph, import/export, attachments, canvases, bookmarks, daily
notes and templates. Every write is a real write in the user's vault, through
the service the app itself uses."""

import base64
import mimetypes
from typing import Annotated, Any
from uuid import UUID

from mcp.server.mcpserver import Context
from mcp.server.mcpserver.exceptions import ToolError
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from uuid_extensions import uuid7

from app.core.db import async_session_factory
from app.mcp.server import as_uuid, server, unwrap, user_id_from
from app.models.bookmarks import Bookmark
from app.models.vaults import Folder, Note
from app.services import (
    attachment_service,
    canvas_service,
    daily_note_service,
    folder_service,
    link_service,
    note_service,
    search_service,
    tag_service,
    vault_io_service,
    vault_service,
)
from app.services.folder_service import ensure_folder_path
from app.services.vault_service import get_owned_vault

VaultId = Annotated[str, Field(description="Vault id (from list_vaults)")]


def _vault(vault: Any) -> dict[str, Any]:
    return {"id": str(vault.id), "name": vault.name, "settings": vault.settings or {}}


def _note_meta(note: Any) -> dict[str, Any]:
    return {
        "id": str(note.id),
        "title": note.title,
        "path": note.path,
        "folder_id": str(note.folder_id) if note.folder_id else None,
        "updated_at": note.updated_at.isoformat() if getattr(note, "updated_at", None) else None,
    }


async def _resolve_note(db: Any, vault_id: UUID, user_id: UUID, ref: str) -> Any:
    """A note by id, exact path, or exact title (case-insensitive)."""
    ref = (ref or "").strip()
    if not ref:
        raise ToolError('Say which note: its id, its path ("Folder/Name") or its title.')
    try:
        note = unwrap(await note_service.get_note(db, vault_id, user_id, UUID(ref)))
        return note
    except (ValueError, TypeError):
        pass
    except ToolError:
        pass
    by_path = await note_service.get_note_by_path(db, vault_id, user_id, ref)
    if by_path.success:
        return by_path.data
    matches = (
        (
            await db.execute(
                select(Note).where(Note.vault_id == vault_id, Note.title.ilike(ref)).order_by(Note.path).limit(2)
            )
        )
        .scalars()
        .all()
    )
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        raise ToolError(f"Several notes are called {ref!r} — give the path (e.g. {matches[0].path!r}).")
    raise ToolError(f"No note called {ref!r}. Try search_notes.")


async def _folder_id_for(db: Any, vault_id: UUID, user_id: UUID, folder: str | None) -> UUID | None:
    """A folder path → id, creating the path if needed. Empty/None = root."""
    path = (folder or "").strip().strip("/")
    if not path:
        return None
    return await ensure_folder_path(db, vault_id, user_id, path)


async def _find_folder(db: Any, vault_id: UUID, path: str) -> Any:
    folder = await db.scalar(select(Folder).where(Folder.vault_id == vault_id, Folder.path == path.strip().strip("/")))
    if folder is None:
        raise ToolError(f"No folder at {path!r}. get_tree lists them.")
    return folder


# ── Vaults ────────────────────────────────────────────────────────────────────


@server.tool()
async def list_vaults(ctx: Context) -> list[dict[str, Any]]:
    """List the vaults you own. Almost every other tool needs a vault_id from here."""
    user_id = user_id_from(ctx)
    async with async_session_factory() as db:
        vaults = unwrap(await vault_service.list_vaults(db, user_id))
        return [{"id": str(v.id), "name": v.name} for v in vaults]


@server.tool()
async def create_vault(ctx: Context, name: Annotated[str, Field(description="Vault name")]) -> dict[str, Any]:
    """Create a new, empty vault — a separate workspace with its own notes and graph."""
    user_id = user_id_from(ctx)
    async with async_session_factory() as db:
        return _vault(unwrap(await vault_service.create_vault(db, user_id, name=name)))


@server.tool()
async def rename_vault(ctx: Context, vault_id: VaultId, name: str) -> dict[str, Any]:
    """Rename a vault."""
    user_id = user_id_from(ctx)
    async with async_session_factory() as db:
        return _vault(unwrap(await vault_service.rename_vault(db, as_uuid(vault_id, "vault_id"), user_id, name=name)))


@server.tool()
async def delete_vault(
    ctx: Context,
    vault_id: VaultId,
    confirm: Annotated[
        bool, Field(description="Must be true. Deletes every note in the vault; cannot be undone.")
    ] = False,
) -> dict[str, Any]:
    """Delete a vault and everything in it. Requires confirm=true."""
    if not confirm:
        raise ToolError("Deleting a vault removes every note in it. Call again with confirm=true if that is intended.")
    user_id = user_id_from(ctx)
    async with async_session_factory() as db:
        vaults = unwrap(await vault_service.list_vaults(db, user_id))
        if len(vaults) <= 1:
            raise ToolError("That is the only vault — create another before deleting this one.")
        unwrap(await vault_service.delete_vault(db, as_uuid(vault_id, "vault_id"), user_id))
        return {"deleted": True}


# ── Folders and the tree ──────────────────────────────────────────────────────


@server.tool()
async def get_tree(ctx: Context, vault_id: VaultId) -> dict[str, Any]:
    """The vault's folder tree with the notes in each folder (titles and ids, no bodies)."""
    user_id = user_id_from(ctx)
    async with async_session_factory() as db:
        return unwrap(await vault_service.get_tree(db, as_uuid(vault_id, "vault_id"), user_id))


@server.tool()
async def create_folder(
    ctx: Context,
    vault_id: VaultId,
    path: Annotated[str, Field(description='Folder path to create, e.g. "Projects/2026" (parents are created too)')],
) -> dict[str, Any]:
    """Create a folder (and any missing parents)."""
    user_id = user_id_from(ctx)
    async with async_session_factory() as db:
        vid = as_uuid(vault_id, "vault_id")
        if await get_owned_vault(db, vid, user_id) is None:
            raise ToolError("Vault not found.")
        folder_id = await ensure_folder_path(db, vid, user_id, path)
        if folder_id is None:
            raise ToolError("Give a folder path.")
        folder = await db.get(Folder, folder_id)
        return {"id": str(folder.id), "path": folder.path}


@server.tool()
async def rename_folder(ctx: Context, vault_id: VaultId, path: str, new_name: str) -> dict[str, Any]:
    """Rename a folder (by its path). Notes inside keep working; links update."""
    user_id = user_id_from(ctx)
    async with async_session_factory() as db:
        vid = as_uuid(vault_id, "vault_id")
        folder = await _find_folder(db, vid, path)
        renamed = unwrap(await folder_service.rename_folder(db, vid, user_id, folder.id, name=new_name))
        return {"id": str(renamed.id), "path": renamed.path}


@server.tool()
async def move_folder(
    ctx: Context,
    vault_id: VaultId,
    path: str,
    new_parent: Annotated[str, Field(description='Destination folder path, or "" for the vault root')] = "",
) -> dict[str, Any]:
    """Move a folder under another folder (or to the root)."""
    user_id = user_id_from(ctx)
    async with async_session_factory() as db:
        vid = as_uuid(vault_id, "vault_id")
        folder = await _find_folder(db, vid, path)
        parent_id = await _folder_id_for(db, vid, user_id, new_parent)
        moved = unwrap(await folder_service.move_folder(db, vid, user_id, folder.id, new_parent_id=parent_id))
        return {"id": str(moved.id), "path": moved.path}


@server.tool()
async def delete_folder(
    ctx: Context,
    vault_id: VaultId,
    path: str,
    confirm: Annotated[bool, Field(description="Must be true — deletes every note inside.")] = False,
) -> dict[str, Any]:
    """Delete a folder and everything in it. Requires confirm=true."""
    if not confirm:
        raise ToolError(
            "Deleting a folder removes every note inside it. Call again with confirm=true if that is intended."
        )
    user_id = user_id_from(ctx)
    async with async_session_factory() as db:
        vid = as_uuid(vault_id, "vault_id")
        folder = await _find_folder(db, vid, path)
        unwrap(await folder_service.delete_folder(db, vid, user_id, folder.id))
        return {"deleted": True}


# ── Notes ─────────────────────────────────────────────────────────────────────


@server.tool()
async def list_notes(
    ctx: Context,
    vault_id: VaultId,
    folder: Annotated[str, Field(description='Only notes under this folder path ("" = whole vault)')] = "",
    limit: Annotated[int, Field(ge=1, le=500)] = 200,
) -> list[dict[str, Any]]:
    """List notes (title, path, id) — whole vault or one folder, most recently updated first."""
    user_id = user_id_from(ctx)
    async with async_session_factory() as db:
        vid = as_uuid(vault_id, "vault_id")
        if await get_owned_vault(db, vid, user_id) is None:
            raise ToolError("Vault not found.")
        stmt = select(Note).where(Note.vault_id == vid)
        prefix = (folder or "").strip().strip("/")
        if prefix:
            stmt = stmt.where(Note.path.startswith(prefix + "/", autoescape=True))
        rows = (await db.execute(stmt.order_by(Note.updated_at.desc()).limit(limit))).scalars().all()
        return [_note_meta(n) for n in rows]


@server.tool()
async def search_notes(
    ctx: Context,
    vault_id: VaultId,
    query: Annotated[str, Field(description="Words to search for. Operators: path:Folder file:Name tag:#name")],
    limit: Annotated[int, Field(ge=1, le=50)] = 10,
) -> list[dict[str, Any]]:
    """Full-text search across the vault, ranked, with a snippet per hit."""
    user_id = user_id_from(ctx)
    async with async_session_factory() as db:
        data = unwrap(
            await search_service.search_notes(db, as_uuid(vault_id, "vault_id"), user_id, q=query, limit=limit)
        )
        return [
            {"id": r["id"], "title": r["title"], "path": r["path"], "snippet": r.get("snippet", "")}
            for r in data.get("results", [])
        ]


@server.tool()
async def read_note(
    ctx: Context, vault_id: VaultId, note: Annotated[str, Field(description="Note id, path or title")]
) -> dict[str, Any]:
    """Read a note in full — its markdown, plus title, path and tags."""
    user_id = user_id_from(ctx)
    async with async_session_factory() as db:
        vid = as_uuid(vault_id, "vault_id")
        n = await _resolve_note(db, vid, user_id, note)
        return {**_note_meta(n), "content": n.content, "properties": n.properties or {}}


@server.tool()
async def create_note(
    ctx: Context,
    vault_id: VaultId,
    title: str,
    content: Annotated[str, Field(description="Markdown body. Link other notes with [[Their title]].")] = "",
    folder: Annotated[str, Field(description='Folder path ("" = root). Created if missing.')] = "",
) -> dict[str, Any]:
    """Create a markdown note. Wikilinks in the content resolve immediately."""
    user_id = user_id_from(ctx)
    async with async_session_factory() as db:
        vid = as_uuid(vault_id, "vault_id")
        folder_id = await _folder_id_for(db, vid, user_id, folder)
        n = unwrap(await note_service.create_note(db, vid, user_id, title=title, folder_id=folder_id, content=content))
        return _note_meta(n)


@server.tool()
async def update_note(
    ctx: Context,
    vault_id: VaultId,
    note: Annotated[str, Field(description="Note id, path or title")],
    content: Annotated[str, Field(description="Markdown to write")],
    mode: Annotated[str, Field(description='"replace" the whole body, "append" to the end, or "prepend"')] = "replace",
) -> dict[str, Any]:
    """Change a note's body: replace it, or add to the end or the start."""
    if mode not in ("replace", "append", "prepend"):
        raise ToolError('mode must be "replace", "append" or "prepend".')
    user_id = user_id_from(ctx)
    async with async_session_factory() as db:
        vid = as_uuid(vault_id, "vault_id")
        n = await _resolve_note(db, vid, user_id, note)
        if mode == "append":
            body = f"{n.content.rstrip()}\n\n{content.strip()}\n"
        elif mode == "prepend":
            body = f"{content.strip()}\n\n{n.content.lstrip()}"
        else:
            body = content
        updated = unwrap(await note_service.update_content(db, vid, user_id, n.id, content=body))
        return _note_meta(updated)


@server.tool()
async def rename_note(ctx: Context, vault_id: VaultId, note: str, new_title: str) -> dict[str, Any]:
    """Rename a note. Links to it are updated."""
    user_id = user_id_from(ctx)
    async with async_session_factory() as db:
        vid = as_uuid(vault_id, "vault_id")
        n = await _resolve_note(db, vid, user_id, note)
        return _note_meta(unwrap(await note_service.rename_note(db, vid, user_id, n.id, title=new_title)))


@server.tool()
async def move_note(
    ctx: Context,
    vault_id: VaultId,
    note: str,
    folder: Annotated[str, Field(description='Destination folder path ("" = root). Created if missing.')] = "",
) -> dict[str, Any]:
    """Move a note into a folder (or to the root)."""
    user_id = user_id_from(ctx)
    async with async_session_factory() as db:
        vid = as_uuid(vault_id, "vault_id")
        n = await _resolve_note(db, vid, user_id, note)
        folder_id = await _folder_id_for(db, vid, user_id, folder)
        moved = unwrap(
            await note_service.rename_note(db, vid, user_id, n.id, folder_id=folder_id, move_to_root=folder_id is None)
        )
        return _note_meta(moved)


@server.tool()
async def delete_note(ctx: Context, vault_id: VaultId, note: str) -> dict[str, Any]:
    """Delete a note. Links to it become unresolved (they stay in the other notes)."""
    user_id = user_id_from(ctx)
    async with async_session_factory() as db:
        vid = as_uuid(vault_id, "vault_id")
        n = await _resolve_note(db, vid, user_id, note)
        unwrap(await note_service.delete_note(db, vid, user_id, n.id))
        return {"deleted": True, "title": n.title}


@server.tool()
async def set_note_tags(
    ctx: Context,
    vault_id: VaultId,
    note: str,
    add: Annotated[list[str] | None, Field(description="Tags to add (without #)")] = None,
    remove: Annotated[list[str] | None, Field(description="Tags to remove")] = None,
) -> dict[str, Any]:
    """Add or remove tags on a note (kept in its frontmatter)."""
    user_id = user_id_from(ctx)
    async with async_session_factory() as db:
        vid = as_uuid(vault_id, "vault_id")
        n = await _resolve_note(db, vid, user_id, note)
        updated = unwrap(await note_service.set_tags(db, vid, user_id, n.id, add=add or None, remove=remove or None))
        return {**_note_meta(updated), "tags": (updated.properties or {}).get("tags", [])}


# ── Links and the graph ───────────────────────────────────────────────────────


@server.tool()
async def link_notes(
    ctx: Context,
    vault_id: VaultId,
    from_note: Annotated[str, Field(description="The note that gets the link (id, path or title)")],
    to_note: Annotated[str, Field(description="The note to link to (id, path or title)")],
    context: Annotated[
        str, Field(description="Optional sentence to put the link in; the link is appended if empty")
    ] = "",
) -> dict[str, Any]:
    """Connect two existing notes by appending a [[wikilink]] to the first."""
    user_id = user_id_from(ctx)
    async with async_session_factory() as db:
        vid = as_uuid(vault_id, "vault_id")
        src = await _resolve_note(db, vid, user_id, from_note)
        dst = await _resolve_note(db, vid, user_id, to_note)
        line = context.strip().replace("{link}", f"[[{dst.title}]]") if context.strip() else f"- [[{dst.title}]]"
        if f"[[{dst.title}]]" not in line:
            line = f"{line} [[{dst.title}]]"
        body = f"{src.content.rstrip()}\n\n{line}\n"
        unwrap(await note_service.update_content(db, vid, user_id, src.id, content=body))
        return {"from": src.title, "to": dst.title, "inserted": line}


@server.tool()
async def get_backlinks(ctx: Context, vault_id: VaultId, note: str) -> dict[str, Any]:
    """Notes that link TO this note, with the sentence around each link."""
    user_id = user_id_from(ctx)
    async with async_session_factory() as db:
        vid = as_uuid(vault_id, "vault_id")
        n = await _resolve_note(db, vid, user_id, note)
        return unwrap(await link_service.get_backlinks(db, vid, user_id, n.id))


@server.tool()
async def get_outgoing_links(ctx: Context, vault_id: VaultId, note: str) -> dict[str, Any]:
    """Links FROM this note, resolved and unresolved."""
    user_id = user_id_from(ctx)
    async with async_session_factory() as db:
        vid = as_uuid(vault_id, "vault_id")
        n = await _resolve_note(db, vid, user_id, note)
        return unwrap(await link_service.get_outgoing_links(db, vid, user_id, n.id))


@server.tool()
async def get_graph(ctx: Context, vault_id: VaultId) -> dict[str, Any]:
    """The whole-vault graph: nodes (notes and unresolved ghosts, with degree and tags) and edges as index pairs."""
    user_id = user_id_from(ctx)
    async with async_session_factory() as db:
        return unwrap(await link_service.get_graph(db, as_uuid(vault_id, "vault_id"), user_id))


@server.tool()
async def list_tags(ctx: Context, vault_id: VaultId) -> list[dict[str, Any]]:
    """Every tag in the vault with its note count."""
    user_id = user_id_from(ctx)
    async with async_session_factory() as db:
        return unwrap(await tag_service.list_tags(db, as_uuid(vault_id, "vault_id"), user_id))


# ── Colours and graph groups ─────────────────────────────────────────────────


@server.tool()
async def set_item_color(
    ctx: Context,
    vault_id: VaultId,
    path: Annotated[str, Field(description="Folder path or note path/title")],
    color: Annotated[str, Field(description='Hex colour like "#4c8dff", or "" to clear')],
) -> dict[str, Any]:
    """Colour a folder or a note. A folder's colour flows down to its notes and into the graph."""
    user_id = user_id_from(ctx)
    color = color.strip().lower()
    if color and not (
        color.startswith("#") and len(color) in (4, 7) and all(c in "0123456789abcdef" for c in color[1:])
    ):
        raise ToolError('color must be a hex colour like "#4c8dff" (or "" to clear).')
    async with async_session_factory() as db:
        vid = as_uuid(vault_id, "vault_id")
        vault = await get_owned_vault(db, vid, user_id)
        if vault is None:
            raise ToolError("Vault not found.")
        folder = await db.scalar(select(Folder).where(Folder.vault_id == vid, Folder.path == path.strip().strip("/")))
        item_id = str(folder.id) if folder else str((await _resolve_note(db, vid, user_id, path)).id)
        colors = dict((vault.settings or {}).get("itemColors") or {})
        if color:
            colors[item_id] = color
        else:
            colors.pop(item_id, None)
        unwrap(await vault_service.update_vault_settings(db, vid, user_id, settings_patch={"itemColors": colors}))
        return {"item_id": item_id, "kind": "folder" if folder else "note", "color": color or None}


@server.tool()
async def list_item_colors(ctx: Context, vault_id: VaultId) -> list[dict[str, Any]]:
    """Every coloured folder and note in the vault."""
    user_id = user_id_from(ctx)
    async with async_session_factory() as db:
        vid = as_uuid(vault_id, "vault_id")
        vault = await get_owned_vault(db, vid, user_id)
        if vault is None:
            raise ToolError("Vault not found.")
        colors: dict[str, str] = (vault.settings or {}).get("itemColors") or {}
        if not colors:
            return []
        ids = [UUID(k) for k in colors if len(k) == 36]
        folders = {str(f.id): f.path for f in (await db.execute(select(Folder).where(Folder.id.in_(ids)))).scalars()}
        notes = {str(n.id): n.path for n in (await db.execute(select(Note).where(Note.id.in_(ids)))).scalars()}
        return [
            {
                "item_id": k,
                "path": folders.get(k) or notes.get(k),
                "kind": "folder" if k in folders else "note",
                "color": v,
            }
            for k, v in colors.items()
        ]


@server.tool()
async def set_graph_groups(
    ctx: Context,
    vault_id: VaultId,
    groups: Annotated[
        list[dict[str, str]],
        Field(
            description='Colour groups for the graph: [{"query": "tag:#book", "color": "#f7b731"}, …]. Replaces the list.'
        ),
    ],
) -> dict[str, Any]:
    """Set the graph's colour groups (queries like tag:#x, path:Folder, file:Name, or plain text)."""
    user_id = user_id_from(ctx)
    cleaned = []
    for g in groups:
        query = str(g.get("query", "")).strip()
        color = str(g.get("color", "")).strip()
        if not query or not color.startswith("#"):
            raise ToolError('Each group needs a "query" and a hex "color".')
        cleaned.append({"query": query, "color": color})
    async with async_session_factory() as db:
        vid = as_uuid(vault_id, "vault_id")
        vault = await get_owned_vault(db, vid, user_id)
        if vault is None:
            raise ToolError("Vault not found.")
        graph = dict((vault.settings or {}).get("graph") or {})
        graph["groups"] = cleaned
        unwrap(await vault_service.update_vault_settings(db, vid, user_id, settings_patch={"graph": graph}))
        return {"groups": cleaned}


# ── Import, export, attachments ──────────────────────────────────────────────


@server.tool()
async def import_markdown(
    ctx: Context,
    vault_id: VaultId,
    files: Annotated[
        list[dict[str, str]],
        Field(
            description='[{"path": "Folder/Note.md", "content": "…"}, …] — many notes at once, folders created as needed'
        ),
    ],
) -> dict[str, Any]:
    """Import markdown files into the vault. Wikilinks between them resolve in one pass."""
    user_id = user_id_from(ctx)
    import io
    import zipfile

    if not files:
        raise ToolError("Give at least one file.")
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in files:
            path = str(f.get("path", "")).strip().strip("/")
            if not path:
                raise ToolError('Every file needs a "path".')
            if not path.lower().endswith((".md", ".markdown", ".txt")):
                path += ".md"
            zf.writestr(path, str(f.get("content", "")))
    async with async_session_factory() as db:
        return unwrap(
            await vault_io_service.import_zip(
                db, as_uuid(vault_id, "vault_id"), user_id, archive=buffer.getvalue(), unwrap_root=False
            )
        )


@server.tool()
async def import_attachment(
    ctx: Context,
    vault_id: VaultId,
    filename: Annotated[str, Field(description="File name with extension, e.g. diagram.png")],
    content_base64: Annotated[str, Field(description="The file's bytes, base64-encoded")],
) -> dict[str, Any]:
    """Upload an image or document (base64) and get the ![[embed]] to paste into a note."""
    user_id = user_id_from(ctx)
    try:
        data = base64.b64decode(content_base64, validate=True)
    except Exception as exc:
        raise ToolError("content_base64 is not valid base64.") from exc
    mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    async with async_session_factory() as db:
        att = unwrap(
            await attachment_service.upload(
                db, as_uuid(vault_id, "vault_id"), user_id, filename=filename, content=data, mime_type=mime
            )
        )
        return {"id": str(att.id), "filename": att.filename, "embed": f"![[{att.filename}]]"}


@server.tool()
async def list_attachments(ctx: Context, vault_id: VaultId) -> list[dict[str, Any]]:
    """Files uploaded to the vault (images, PDFs …) and how to embed each."""
    user_id = user_id_from(ctx)
    async with async_session_factory() as db:
        rows = unwrap(await attachment_service.list_attachments(db, as_uuid(vault_id, "vault_id"), user_id))
        return [
            {
                "id": str(a.id),
                "filename": a.filename,
                "mime_type": a.mime_type,
                "size": a.size,
                "embed": f"![[{a.filename}]]",
            }
            for a in rows
        ]


@server.tool()
async def export_vault(
    ctx: Context,
    vault_id: VaultId,
    as_zip: Annotated[
        bool, Field(description="true = one base64 zip of every note; false = a list of {path, content}")
    ] = False,
    limit: Annotated[int, Field(ge=1, le=2000, description="Max notes when returning a list")] = 500,
) -> dict[str, Any]:
    """Export the vault's notes as markdown — a list of files, or a zip (base64)."""
    user_id = user_id_from(ctx)
    async with async_session_factory() as db:
        vid = as_uuid(vault_id, "vault_id")
        if as_zip:
            data = unwrap(await vault_io_service.export_zip(db, vid, user_id))
            return {"filename": "vault.zip", "zip_base64": base64.b64encode(data).decode()}
        if await get_owned_vault(db, vid, user_id) is None:
            raise ToolError("Vault not found.")
        rows = (
            await db.execute(
                select(Note.path, Note.content).where(Note.vault_id == vid).order_by(Note.path).limit(limit)
            )
        ).all()
        return {"files": [{"path": f"{p}.md", "content": c} for p, c in rows], "count": len(rows)}


# ── Canvases, bookmarks, daily notes, templates ──────────────────────────────


@server.tool()
async def list_canvases(ctx: Context, vault_id: VaultId) -> list[dict[str, Any]]:
    """The vault's canvases (free-form boards)."""
    user_id = user_id_from(ctx)
    async with async_session_factory() as db:
        return unwrap(await canvas_service.list_canvases(db, as_uuid(vault_id, "vault_id"), user_id))


@server.tool()
async def create_canvas(
    ctx: Context,
    vault_id: VaultId,
    name: str,
    data: Annotated[
        dict[str, Any] | None,
        Field(
            description='Optional JSON Canvas data: {"nodes": [{"id","type":"text","x","y","width","height","text"}], "edges": [{"id","fromNode","toNode"}]}'
        ),
    ] = None,
) -> dict[str, Any]:
    """Create a canvas, optionally with cards and connections."""
    user_id = user_id_from(ctx)
    async with async_session_factory() as db:
        vid = as_uuid(vault_id, "vault_id")
        canvas = unwrap(await canvas_service.create_canvas(db, vid, user_id, name=name))
        if data:
            canvas = unwrap(await canvas_service.update_data(db, vid, user_id, canvas.id, data=data))
        return {"id": str(canvas.id), "name": canvas.name}


@server.tool()
async def list_bookmarks(ctx: Context, vault_id: VaultId) -> list[dict[str, Any]]:
    """Bookmarked notes in the vault."""
    user_id = user_id_from(ctx)
    async with async_session_factory() as db:
        vid = as_uuid(vault_id, "vault_id")
        if await get_owned_vault(db, vid, user_id) is None:
            raise ToolError("Vault not found.")
        rows = (
            (
                await db.execute(
                    select(Note)
                    .join(Bookmark, Bookmark.note_id == Note.id)
                    .where(Bookmark.user_id == user_id, Note.vault_id == vid)
                )
            )
            .scalars()
            .all()
        )
        return [_note_meta(n) for n in rows]


@server.tool()
async def bookmark_note(ctx: Context, vault_id: VaultId, note: str, bookmarked: bool = True) -> dict[str, Any]:
    """Bookmark a note (or remove the bookmark with bookmarked=false)."""
    user_id = user_id_from(ctx)
    async with async_session_factory() as db:
        vid = as_uuid(vault_id, "vault_id")
        n = await _resolve_note(db, vid, user_id, note)
        if bookmarked:
            await db.execute(
                pg_insert(Bookmark)
                .values(id=uuid7(), user_id=user_id, vault_id=vid, note_id=n.id)
                .on_conflict_do_nothing(constraint="uq_bookmarks_user_note")
            )
        else:
            existing = await db.scalar(select(Bookmark).where(Bookmark.user_id == user_id, Bookmark.note_id == n.id))
            if existing:
                await db.delete(existing)
        await db.commit()
        return {"title": n.title, "bookmarked": bookmarked}


@server.tool()
async def daily_note(ctx: Context, vault_id: VaultId) -> dict[str, Any]:
    """Today's daily note — created from the vault's template if it does not exist yet."""
    user_id = user_id_from(ctx)
    async with async_session_factory() as db:
        n = unwrap(await daily_note_service.open_daily_note(db, as_uuid(vault_id, "vault_id"), user_id))
        return {**_note_meta(n), "content": n.content}


@server.tool()
async def list_templates(ctx: Context, vault_id: VaultId) -> list[dict[str, Any]]:
    """Notes in the vault's templates folder."""
    user_id = user_id_from(ctx)
    async with async_session_factory() as db:
        return unwrap(await daily_note_service.list_templates(db, as_uuid(vault_id, "vault_id"), user_id))


# ── Resources ─────────────────────────────────────────────────────────────────


@server.resource(
    "nodum://vault/{vault_id}/note/{path}",
    name="Note",
    description="A note's markdown, by vault id and note path.",
)
async def note_resource(vault_id: str, path: str, ctx: Context) -> str:
    user_id = user_id_from(ctx)
    async with async_session_factory() as db:
        vid = as_uuid(vault_id, "vault_id")
        n = await _resolve_note(db, vid, user_id, path)
        return n.content
