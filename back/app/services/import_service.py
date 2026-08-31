"""Running a source-specific import.

The whole job is: pick the converter, let it normalise the upload into plain
markdown on sensible paths, then hand the result to the import pipeline that
already exists. Nothing here knows anything about Evernote or Slack — that
belongs in the converters — and nothing in a converter knows about the
database, which is what keeps them unit-testable without infrastructure.
"""

from __future__ import annotations

import io
import zipfile
from typing import TYPE_CHECKING, Any

from app.core.logging import get_logger
from app.services import importers, vault_io_service
from app.services.importers.base import ImportError_, UploadedFile
from app.services.service_response import ServiceResponse

if TYPE_CHECKING:
    from uuid import UUID

    from sqlalchemy.ext.asyncio import AsyncSession

logger = get_logger("import")


def _to_zip(files: list[Any]) -> bytes:
    """Pack the converted files into the archive the importer consumes.

    Deflate rather than store: converters routinely emit thousands of small
    markdown files, and the archive only ever lives in memory between here and
    the importer.
    """
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for item in files:
            archive.writestr(item.path, item.data)
    return buffer.getvalue()


async def run_import(
    db: AsyncSession,
    vault_id: UUID,
    user_id: UUID,
    *,
    source_id: str,
    uploads: list[UploadedFile],
) -> ServiceResponse[dict[str, Any]]:
    """Convert an upload from `source_id` and import it into the vault."""
    source = importers.get_source(source_id)
    if source is None:
        return ServiceResponse.fail("not_found", "Unknown import source.")
    if not uploads or not any(data for _, data in uploads):
        return ServiceResponse.fail("validation_failed", "No files were uploaded.")

    try:
        converted = source.converter(uploads)
    except ImportError_ as exc:
        # The converter's own message names the export step the person missed,
        # which is nearly always the real problem — so it goes through as-is
        # rather than being flattened to "import failed".
        return ServiceResponse.fail("validation_failed", str(exc))
    except Exception:
        # A malformed export should not read as a server fault to the user, but
        # it is a real bug signal for us, so it is logged with the source.
        logger.exception("import_converter_failed", source=source_id)
        return ServiceResponse.fail(
            "validation_failed",
            f"That file could not be read as a {source.name} export. "
            "Check you uploaded the file the export produced, not a re-zipped copy.",
        )

    if not converted.files:
        return ServiceResponse.fail("validation_failed", f"No notes were found in that {source.name} export.")

    # `unwrap_root=False`: converters emit deliberate top-level folders
    # ("Google Keep/Archive", "Slack/#design"), and stripping a shared root
    # would flatten exactly the structure they just built.
    response = await vault_io_service.import_zip(
        db, vault_id, user_id, archive=_to_zip(converted.files), unwrap_root=False
    )
    if not response.success:
        return response

    stats = dict(response.data or {})
    stats["source"] = source.id
    stats["source_name"] = source.name
    stats["warnings"] = converted.warnings
    logger.info(
        "import_completed",
        source=source_id,
        vault_id=str(vault_id),
        notes=stats.get("imported"),
        warnings=len(converted.warnings),
    )
    return ServiceResponse.ok(stats)
