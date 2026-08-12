"""API v1 router aggregation.

Feature routers are included here as they land:
auth, vaults, notes, folders, links, graph, search, tags, attachments.
"""

from fastapi import APIRouter

api_router = APIRouter()

# Routers are appended by feature branches:
# from app.api.v1 import auth, vaults, notes, ...
# api_router.include_router(auth.router, prefix="/auth", tags=["Auth"])
