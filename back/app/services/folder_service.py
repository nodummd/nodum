"""Folder service — create, rename, move, delete with subtree path upkeep."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.vaults import Folder, Note
from app.services.service_response import ServiceResponse
from app.services.vault_service import get_owned_vault, invalidate_tree_cache
from app.utils.cache_utils import cache_delete, vault_graph_key
from app.utils.path_utils import join_path, validate_depth, validate_segment


async def _folder_in_vault(db: AsyncSession, folder_id: UUID, vault_id: UUID) -> Folder | None:
    return await db.scalar(select(Folder).where(Folder.id == folder_id, Folder.vault_id == vault_id))


async def _path_taken(db: AsyncSession, vault_id: UUID, path: str, *, exclude_id: UUID | None = None) -> bool:
    q = select(Folder.id).where(Folder.vault_id == vault_id, Folder.path == path)
    if exclude_id:
        q = q.where(Folder.id != exclude_id)
    return (await db.scalar(q)) is not None


async def ensure_folder_path(db: AsyncSession, vault_id: UUID, user_id: UUID, path: str) -> UUID | None:
    """Get or create the (possibly nested) folder for a slash path; None = root."""
    path = path.strip().strip("/")
    if not path:
        return None
    parent_id: UUID | None = None
    walked = ""
    for segment in path.split("/"):
        segment = segment.strip()
        if not segment:
            continue
        walked = f"{walked}/{segment}" if walked else segment
        existing = await db.scalar(select(Folder).where(Folder.vault_id == vault_id, Folder.path == walked))
        if existing:
            parent_id = existing.id
            continue
        created = await create_folder(db, vault_id, user_id, name=segment, parent_id=parent_id)
        if not created.success or created.data is None:
            return parent_id
        parent_id = created.data.id
    return parent_id


async def create_folder(
    db: AsyncSession, vault_id: UUID, user_id: UUID, *, name: str, parent_id: UUID | None
) -> ServiceResponse[Folder]:
    if await get_owned_vault(db, vault_id, user_id) is None:
        return ServiceResponse.fail("not_found", "Vault not found.")

    name = name.strip()
    if err := validate_segment(name):
        return ServiceResponse.fail("validation_failed", err)

    parent_path: str | None = None
    if parent_id is not None:
        parent = await _folder_in_vault(db, parent_id, vault_id)
        if parent is None:
            return ServiceResponse.fail("not_found", "Parent folder not found.")
        parent_path = parent.path

    path = join_path(parent_path, name)
    if err := validate_depth(path):
        return ServiceResponse.fail("validation_failed", err)
    if await _path_taken(db, vault_id, path):
        return ServiceResponse.fail("already_exists", "A folder with this path already exists.")

    folder = Folder(vault_id=vault_id, parent_id=parent_id, name=name, path=path)
    db.add(folder)
    await db.commit()
    await db.refresh(folder)
    await invalidate_tree_cache(vault_id)
    return ServiceResponse.ok(folder)


async def _recompute_subtree_paths(db: AsyncSession, vault_id: UUID, old_prefix: str, new_prefix: str) -> None:
    """Rewrite materialized paths for every folder and note under a moved/renamed folder.

    ``startswith(..., autoescape=True)`` escapes ``%``/``_`` in the prefix —
    folder names may legally contain them, and unescaped LIKE wildcards would
    match (and silently corrupt) unrelated sibling subtrees.

    Wikilinks addressed by path follow Obsidian's resolution semantics:
    links written against a note's old path unresolve (we never rewrite user
    markdown), and unresolved links matching a note's new path claim it.
    """
    from app.services.link_service import resolve_links_for_new_note, unresolve_links_for_renamed_note

    descendants = (
        await db.execute(
            select(Folder).where(Folder.vault_id == vault_id, Folder.path.startswith(f"{old_prefix}/", autoescape=True))
        )
    ).scalars()
    for f in descendants:
        f.path = new_prefix + f.path.removeprefix(old_prefix)

    note_rows = (
        await db.execute(
            select(Note).where(Note.vault_id == vault_id, Note.path.startswith(f"{old_prefix}/", autoescape=True))
        )
    ).scalars()
    for n in note_rows:
        old_note_path = n.path
        n.path = new_prefix + n.path.removeprefix(old_prefix)
        await unresolve_links_for_renamed_note(db, n, n.title, old_note_path)
        await resolve_links_for_new_note(db, n)


async def rename_folder(
    db: AsyncSession, vault_id: UUID, user_id: UUID, folder_id: UUID, *, name: str
) -> ServiceResponse[Folder]:
    if await get_owned_vault(db, vault_id, user_id) is None:
        return ServiceResponse.fail("not_found", "Vault not found.")
    folder = await _folder_in_vault(db, folder_id, vault_id)
    if folder is None:
        return ServiceResponse.fail("not_found", "Folder not found.")

    name = name.strip()
    if err := validate_segment(name):
        return ServiceResponse.fail("validation_failed", err)

    parent_path = folder.path.rsplit("/", 1)[0] if "/" in folder.path else None
    new_path = join_path(parent_path, name)
    if new_path == folder.path:
        return ServiceResponse.ok(folder)
    if await _path_taken(db, vault_id, new_path, exclude_id=folder_id):
        return ServiceResponse.fail("already_exists", "A folder with this path already exists.")

    old_path = folder.path
    folder.name = name
    folder.path = new_path
    await _recompute_subtree_paths(db, vault_id, old_path, new_path)
    await db.commit()
    await db.refresh(folder)
    await invalidate_tree_cache(vault_id)
    await cache_delete(vault_graph_key(vault_id))
    return ServiceResponse.ok(folder)


async def move_folder(
    db: AsyncSession, vault_id: UUID, user_id: UUID, folder_id: UUID, *, new_parent_id: UUID | None
) -> ServiceResponse[Folder]:
    if await get_owned_vault(db, vault_id, user_id) is None:
        return ServiceResponse.fail("not_found", "Vault not found.")
    folder = await _folder_in_vault(db, folder_id, vault_id)
    if folder is None:
        return ServiceResponse.fail("not_found", "Folder not found.")

    new_parent_path: str | None = None
    if new_parent_id is not None:
        if new_parent_id == folder_id:
            return ServiceResponse.fail("validation_failed", "Cannot move a folder into itself.")
        parent = await _folder_in_vault(db, new_parent_id, vault_id)
        if parent is None:
            return ServiceResponse.fail("not_found", "Target folder not found.")
        if parent.path == folder.path or parent.path.startswith(folder.path + "/"):
            return ServiceResponse.fail("validation_failed", "Cannot move a folder into its own subtree.")
        new_parent_path = parent.path

    new_path = join_path(new_parent_path, folder.name)
    if err := validate_depth(new_path):
        return ServiceResponse.fail("validation_failed", err)
    if new_path == folder.path:
        return ServiceResponse.ok(folder)
    if await _path_taken(db, vault_id, new_path, exclude_id=folder_id):
        return ServiceResponse.fail("already_exists", "A folder with this path already exists at the target.")

    old_path = folder.path
    folder.parent_id = new_parent_id
    folder.path = new_path
    await _recompute_subtree_paths(db, vault_id, old_path, new_path)
    await db.commit()
    await db.refresh(folder)
    await invalidate_tree_cache(vault_id)
    await cache_delete(vault_graph_key(vault_id))
    return ServiceResponse.ok(folder)


async def delete_folder(db: AsyncSession, vault_id: UUID, user_id: UUID, folder_id: UUID) -> ServiceResponse[None]:
    """Delete a folder and everything inside it (DB cascades handle children)."""
    if await get_owned_vault(db, vault_id, user_id) is None:
        return ServiceResponse.fail("not_found", "Vault not found.")
    folder = await _folder_in_vault(db, folder_id, vault_id)
    if folder is None:
        return ServiceResponse.fail("not_found", "Folder not found.")
    await db.delete(folder)
    await db.commit()
    await invalidate_tree_cache(vault_id)
    await cache_delete(vault_graph_key(vault_id))
    return ServiceResponse.ok(None)
