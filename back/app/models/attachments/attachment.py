"""Attachment model — files stored in S3/MinIO, embedded via ![[filename]]."""

from uuid import UUID

from sqlalchemy import BigInteger, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class Attachment(UUIDMixin, TimestampMixin, Base):
    """An uploaded file (image, pdf, audio …) belonging to a vault.

    ``filename`` is unique per vault so ``![[image.png]]`` embeds resolve
    unambiguously; collisions get a numeric suffix at upload time.
    """

    __tablename__ = "attachments"

    vault_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("vaults.id", ondelete="CASCADE"),
        nullable=False,
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    s3_key: Mapped[str] = mapped_column(Text, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(127), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)

    __table_args__ = (UniqueConstraint("vault_id", "filename", name="uq_attachments_vault_filename"),)

    def __repr__(self) -> str:
        return f"<Attachment {self.filename}>"
