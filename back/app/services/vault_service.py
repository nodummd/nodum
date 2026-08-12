"""Vault service — CRUD, tree assembly, onboarding vault."""

from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants.limits import MAX_VAULTS_PER_USER
from app.core.logging import get_logger
from app.models.vaults import Folder, Note, Vault
from app.services.service_response import ServiceResponse
from app.settings import get_settings
from app.utils.cache_utils import cache_delete, cache_get_json, cache_set_json, vault_graph_key, vault_tree_key
from app.utils.path_utils import validate_segment

logger = get_logger("vaults")


async def get_owned_vault(db: AsyncSession, vault_id: UUID, user_id: UUID) -> Vault | None:
    """Return the vault if it exists and belongs to the user."""
    return await db.scalar(select(Vault).where(Vault.id == vault_id, Vault.user_id == user_id))


async def list_vaults(db: AsyncSession, user_id: UUID) -> ServiceResponse[list[Vault]]:
    result = await db.execute(select(Vault).where(Vault.user_id == user_id).order_by(Vault.created_at))
    return ServiceResponse.ok(list(result.scalars()))


async def create_vault(db: AsyncSession, user_id: UUID, *, name: str) -> ServiceResponse[Vault]:
    name = name.strip()
    if err := validate_segment(name):
        return ServiceResponse.fail("validation_failed", err)

    count = await db.scalar(select(func.count()).select_from(Vault).where(Vault.user_id == user_id))
    if count is not None and count >= MAX_VAULTS_PER_USER:
        return ServiceResponse.fail("validation_failed", f"Vault limit reached ({MAX_VAULTS_PER_USER}).")

    existing = await db.scalar(select(Vault.id).where(Vault.user_id == user_id, Vault.name == name))
    if existing:
        return ServiceResponse.fail("already_exists", "A vault with this name already exists.")

    vault = Vault(user_id=user_id, name=name)
    db.add(vault)
    await db.commit()
    await db.refresh(vault)
    return ServiceResponse.ok(vault)


async def rename_vault(db: AsyncSession, vault_id: UUID, user_id: UUID, *, name: str) -> ServiceResponse[Vault]:
    vault = await get_owned_vault(db, vault_id, user_id)
    if vault is None:
        return ServiceResponse.fail("not_found", "Vault not found.")
    name = name.strip()
    if err := validate_segment(name):
        return ServiceResponse.fail("validation_failed", err)
    duplicate = await db.scalar(
        select(Vault.id).where(Vault.user_id == user_id, Vault.name == name, Vault.id != vault_id)
    )
    if duplicate:
        return ServiceResponse.fail("already_exists", "A vault with this name already exists.")
    vault.name = name
    await db.commit()
    await db.refresh(vault)
    return ServiceResponse.ok(vault)


async def update_vault_settings(
    db: AsyncSession, vault_id: UUID, user_id: UUID, *, settings_patch: dict[str, Any]
) -> ServiceResponse[Vault]:
    vault = await get_owned_vault(db, vault_id, user_id)
    if vault is None:
        return ServiceResponse.fail("not_found", "Vault not found.")
    vault.settings = {**vault.settings, **settings_patch}
    await db.commit()
    await db.refresh(vault)
    return ServiceResponse.ok(vault)


async def delete_vault(db: AsyncSession, vault_id: UUID, user_id: UUID) -> ServiceResponse[None]:
    vault = await get_owned_vault(db, vault_id, user_id)
    if vault is None:
        return ServiceResponse.fail("not_found", "Vault not found.")
    await db.delete(vault)  # folders/notes cascade at the DB level
    await db.commit()
    await cache_delete(vault_tree_key(vault_id), vault_graph_key(vault_id))
    return ServiceResponse.ok(None)


# ── Tree ─────────────────────────────────────────────────────────────────────


async def invalidate_tree_cache(vault_id: UUID) -> None:
    """Call after any structural change (create/move/rename/delete)."""
    await cache_delete(vault_tree_key(vault_id))


async def get_tree(db: AsyncSession, vault_id: UUID, user_id: UUID) -> ServiceResponse[dict[str, Any]]:
    """Return the vault file tree: nested folders with their notes.

    Cached in Redis; two indexed queries on miss. Notes carry no content —
    the tree stays light even for 100k-note vaults.
    """
    vault = await get_owned_vault(db, vault_id, user_id)
    if vault is None:
        return ServiceResponse.fail("not_found", "Vault not found.")

    cached = await cache_get_json(vault_tree_key(vault_id))
    if cached is not None:
        return ServiceResponse.ok(cached)

    folders = (
        await db.execute(
            select(Folder.id, Folder.parent_id, Folder.name, Folder.path)
            .where(Folder.vault_id == vault_id)
            .order_by(Folder.path)
        )
    ).all()
    notes = (
        await db.execute(
            select(Note.id, Note.folder_id, Note.title, Note.path).where(Note.vault_id == vault_id).order_by(Note.title)
        )
    ).all()

    children: dict[str | None, list[dict[str, Any]]] = {}
    for f in folders:
        node = {
            "type": "folder",
            "id": str(f.id),
            "name": f.name,
            "path": f.path,
            "children": [],
        }
        children.setdefault(str(f.parent_id) if f.parent_id else None, []).append(node)

    index = {n["id"]: n for group in children.values() for n in group}
    roots: list[dict[str, Any]] = []
    for parent_id, group in children.items():
        if parent_id is None:
            roots.extend(group)
        elif parent_id in index:
            index[parent_id]["children"].extend(group)

    for n in notes:
        leaf = {"type": "note", "id": str(n.id), "title": n.title, "path": n.path}
        folder_key = str(n.folder_id) if n.folder_id else None
        if folder_key and folder_key in index:
            index[folder_key]["children"].append(leaf)
        else:
            roots.append(leaf)

    tree = {"vault_id": str(vault_id), "items": roots}
    await cache_set_json(vault_tree_key(vault_id), tree, get_settings().CACHE_TREE_TTL)
    return ServiceResponse.ok(tree)


# ── Onboarding ───────────────────────────────────────────────────────────────

_WELCOME_NOTES: list[tuple[str, str]] = [
    (
        "Welcome to Nodum",
        "# Welcome to Nodum 👋\n\n"
        "Nodum is your **linked knowledge base**. Notes are plain markdown, and\n"
        "`[[wikilinks]]` connect them into a graph you can explore.\n\n"
        "## Try these\n\n"
        "- Open [[Linking your thinking]] to see how links work\n"
        "- Press `Cmd/Ctrl+O` to quick-switch between notes\n"
        "- Press `Cmd/Ctrl+P` for the command palette\n"
        "- Click the graph icon to see this vault as a **knowledge graph**\n\n"
        "> [!tip] Everything is yours\n"
        "> Your notes are portable markdown — export the vault anytime.\n",
    ),
    (
        "Linking your thinking",
        "# Linking your thinking\n\n"
        "Type `[[` and a note name to create a link, like this: [[Welcome to Nodum]].\n\n"
        "Links to notes that don't exist yet — like [[My first idea]] — appear as\n"
        "*unresolved* links. Click one to create the note instantly.\n\n"
        "## Backlinks\n\n"
        "Every note shows which notes link **to** it. Open the backlinks panel to\n"
        "see connections you forgot you made.\n\n"
        "#getting-started\n",
    ),
    (
        "Formatting showcase",
        "---\ntags:\n  - getting-started\n  - reference\n---\n\n"
        "# Formatting showcase\n\n"
        "**Bold**, *italic*, ~~strikethrough~~, ==highlight==, `inline code`.\n\n"
        "## Tasks\n\n- [ ] An open task\n- [x] A done task\n\n"
        "## Callouts\n\n> [!note] Callouts\n> Obsidian-style callouts work too.\n\n"
        "## Math\n\nInline $e^{i\\pi} + 1 = 0$ and block:\n\n$$\\int_0^1 x^2\\,dx = \\tfrac13$$\n\n"
        '## Code\n\n```python\nprint("hello nodum")\n```\n\n'
        "See also [[Welcome to Nodum]].\n",
    ),
]


async def create_default_vault(db: AsyncSession, user_id: UUID) -> Vault:
    """Create the onboarding vault with welcome notes. Called at signup."""
    from app.utils.path_utils import count_words

    vault = Vault(user_id=user_id, name="My Vault")
    db.add(vault)
    await db.flush()
    seeded: list[Note] = []
    for title, content in _WELCOME_NOTES:
        note = Note(
            vault_id=vault.id,
            folder_id=None,
            title=title,
            path=title,
            content=content,
            word_count=count_words(content),
        )
        db.add(note)
        seeded.append(note)
    await db.flush()

    # Extract wikilinks after all notes exist so cross-references resolve.
    from app.services.link_service import sync_note_links

    for note in seeded:
        await sync_note_links(db, note)
    await db.commit()
    logger.info("default_vault_created", user_id=str(user_id), vault_id=str(vault.id))
    return vault
