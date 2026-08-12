"""Model registry — import all models so Base.metadata sees every table.

Alembic's env.py does ``from app.models import *`` to autogenerate against
the full schema. Add new model modules here as features land.
"""

from app.models.attachments import Attachment
from app.models.auth import OAuthConnection, Session, User
from app.models.base import Base
from app.models.bookmarks import Bookmark
from app.models.links import Link
from app.models.publications import Publication, VaultPublication
from app.models.tags import NoteTag, Tag
from app.models.vaults import Canvas, Folder, Note, NoteAlias, NoteVersion, Vault

__all__ = [
    "Attachment",
    "Base",
    "Bookmark",
    "Canvas",
    "Folder",
    "Link",
    "Note",
    "NoteAlias",
    "NoteTag",
    "NoteVersion",
    "OAuthConnection",
    "Publication",
    "Session",
    "Tag",
    "User",
    "Vault",
    "VaultPublication",
]
