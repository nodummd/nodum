"""Model registry — import all models so Base.metadata sees every table.

Alembic's env.py does ``from app.models import *`` to autogenerate against
the full schema. Add new model modules here as features land.
"""

from app.models.attachments import Attachment
from app.models.auth import Session, User
from app.models.base import Base
from app.models.links import Link
from app.models.tags import NoteTag, Tag
from app.models.vaults import Folder, Note, Vault

__all__ = ["Attachment", "Base", "Folder", "Link", "Note", "NoteTag", "Session", "Tag", "User", "Vault"]
