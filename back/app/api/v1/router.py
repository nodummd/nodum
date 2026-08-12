"""API v1 router aggregation.

Feature routers are included here as they land:
auth, vaults, notes, folders, links, graph, search, tags, attachments.
"""

from fastapi import APIRouter

from app.api.v1 import attachments, auth, daily, folders, links, notes, search, vaults

api_router = APIRouter()

api_router.include_router(auth.router, prefix="/auth", tags=["Auth"])
api_router.include_router(vaults.router, prefix="/vaults", tags=["Vaults"])
api_router.include_router(folders.router, prefix="/vaults/{vault_id}/folders", tags=["Folders"])
api_router.include_router(notes.router, prefix="/vaults/{vault_id}/notes", tags=["Notes"])
api_router.include_router(links.router, prefix="/vaults/{vault_id}", tags=["Links & Graph"])
api_router.include_router(search.router, prefix="/vaults/{vault_id}", tags=["Search & Tags"])
api_router.include_router(attachments.router, prefix="/vaults/{vault_id}/attachments", tags=["Attachments"])
api_router.include_router(daily.router, prefix="/vaults/{vault_id}", tags=["Daily & Templates"])
