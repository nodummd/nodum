"""Attachment type allowlist — the gate between an upload and object storage."""

from app.services.attachment_service import _resolve_type

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32
JPEG = b"\xff\xd8\xff" + b"0" * 32
PDF = b"%PDF-1.7\n" + b"0" * 32
ZIP = b"PK\x03\x04" + b"0" * 32


def test_allows_known_images_and_marks_them_inline():
    assert _resolve_type("photo.png", PNG) == ("image/png", "inline")
    assert _resolve_type("photo.JPEG", JPEG) == ("image/jpeg", "inline")
    assert _resolve_type("doc.pdf", PDF) == ("application/pdf", "inline")


def test_refuses_unlisted_extensions():
    for name in ("payload.exe", "shell.sh", "index.html", "vector.svg", "noext"):
        assert _resolve_type(name, PNG) is None


def test_extension_decides_type_not_the_claimed_content_type():
    # A .png is stored as image/png regardless of what the client claimed.
    mime, _ = _resolve_type("a.png", PNG)
    assert mime == "image/png"


def test_magic_bytes_must_match_the_extension():
    # An executable renamed to .png must not be stored as an image.
    assert _resolve_type("payload.png", b"MZ\x90\x00" + b"0" * 32) is None
    assert _resolve_type("fake.pdf", PNG) is None


def test_office_files_must_be_real_zip_containers():
    assert _resolve_type("report.docx", ZIP) is not None
    assert _resolve_type("report.docx", b"not a zip") is None


def test_non_previewable_types_download_instead_of_rendering():
    _, disposition = _resolve_type("archive.zip", ZIP)
    assert disposition == "attachment"
