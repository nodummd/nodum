"""API v1 router aggregation.

Feature routers are included here as they land:
auth, vaults, notes, folders, links, graph, search, tags, attachments.
"""

from fastapi import APIRouter

from app.api.v1 import (
    ai,
    attachments,
    auth,
    bookmarks,
    canvases,
    clipper,
    collab,
    daily,
    folders,
    links,
    notes,
    publish,
    search,
    vault_io,
    vaults,
    versions,
)

api_router = APIRouter()

api_router.include_router(auth.router, prefix="/auth", tags=["Auth"])
api_router.include_router(vaults.router, prefix="/vaults", tags=["Vaults"])
api_router.include_router(folders.router, prefix="/vaults/{vault_id}/folders", tags=["Folders"])
api_router.include_router(notes.router, prefix="/vaults/{vault_id}/notes", tags=["Notes"])
api_router.include_router(links.router, prefix="/vaults/{vault_id}", tags=["Links & Graph"])
api_router.include_router(search.router, prefix="/vaults/{vault_id}", tags=["Search & Tags"])
api_router.include_router(attachments.router, prefix="/vaults/{vault_id}/attachments", tags=["Attachments"])
api_router.include_router(daily.router, prefix="/vaults/{vault_id}", tags=["Daily & Templates"])
api_router.include_router(vault_io.router, prefix="/vaults/{vault_id}", tags=["Import & Export"])
api_router.include_router(bookmarks.router, prefix="/vaults/{vault_id}/bookmarks", tags=["Bookmarks"])
api_router.include_router(publish.router, prefix="/vaults/{vault_id}/notes", tags=["Publish"])
api_router.include_router(versions.router, prefix="/vaults/{vault_id}/notes/{note_id}/versions", tags=["Versions"])
api_router.include_router(publish.public_router, prefix="/public", tags=["Public"])
api_router.include_router(collab.router, tags=["Collab"])
api_router.include_router(clipper.router, prefix="/clipper", tags=["Web Clipper"])
api_router.include_router(publish.site_router, prefix="/vaults/{vault_id}", tags=["Publish"])
api_router.include_router(canvases.router, prefix="/vaults/{vault_id}/canvases", tags=["Canvases"])
api_router.include_router(ai.router, prefix="/ai", tags=["AI"])
