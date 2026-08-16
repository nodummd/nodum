"""Vault import/export integration tests."""

import base64
import io
import uuid
import zipfile

import pytest
from httpx import AsyncClient


@pytest.fixture
async def workspace(client: AsyncClient) -> dict:
    resp = await client.post(
        "/api/v1/auth/signup",
        json={
            "email": f"io-{uuid.uuid4().hex[:12]}@nodumtest.dev",
            "password": "s3cure-Password!",
            "name": "IO Tester",
        },
    )
    assert resp.status_code == 201, resp.text
    client.cookies.clear()
    headers = {"Authorization": f"Bearer {resp.json()['data']['access_token']}"}
    vault_id = (await client.get("/api/v1/vaults", headers=headers)).json()["data"][0]["id"]
    return {"headers": headers, "vault_id": vault_id, "base": f"/api/v1/vaults/{vault_id}"}


def _make_zip(files: dict[str, str | bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, content in files.items():
            zf.writestr(name, content)
    return buf.getvalue()


# A real 1x1 PNG. Attachment upload verifies that the leading bytes agree with
# the extension, so a placeholder string is rejected as a spoofed image — the
# fixture has to be a genuine file for this path to be exercised at all.
_PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


async def test_import_obsidian_style_zip(client: AsyncClient, workspace: dict) -> None:
    archive = _make_zip(
        {
            "Ideas/Big idea.md": "Linked to [[Small idea]] and #imported tag.",
            "Ideas/Nested/Small idea.md": "The seed.",
            "Standalone.md": "Root note referencing [[Ideas/Big idea]].",
            "assets/image.png": _PNG_1PX,
            "__MACOSX/junk.md": "junk",
            "Welcome to Nodum.md": "Collides with the seeded welcome note.",
        }
    )
    resp = await client.post(
        f"{workspace['base']}/import",
        files={"file": ("vault.zip", archive, "application/zip")},
        headers=workspace["headers"],
    )
    assert resp.status_code == 200, resp.text
    stats = resp.json()["data"]
    assert stats["imported"] == 4
    assert stats["renamed"] == 1  # Welcome to Nodum → "Welcome to Nodum 1"
    # assets/image.png now imports as an attachment (S9.3) instead of skipping
    assert stats["skipped_non_markdown"] == 0
    assert stats["imported_attachments"] == 1

    # Folder structure landed
    tree = (await client.get(f"{workspace['base']}/tree", headers=workspace["headers"])).json()["data"]
    top_names = {i.get("name") or i.get("title") for i in tree["items"]}
    assert "Ideas" in top_names
    assert "Standalone" in top_names

    # Cross-file links resolved in the batch
    small = await client.get(
        f"{workspace['base']}/notes/by-path", params={"path": "Ideas/Nested/Small idea"}, headers=workspace["headers"]
    )
    small_id = small.json()["data"]["id"]
    back = await client.get(f"{workspace['base']}/notes/{small_id}/backlinks", headers=workspace["headers"])
    assert [b["title"] for b in back.json()["data"]["backlinks"]] == ["Big idea"]

    # Tags extracted
    tags = (await client.get(f"{workspace['base']}/tags", headers=workspace["headers"])).json()["data"]
    assert "imported" in {t["name"] for t in tags}


async def test_export_roundtrip(client: AsyncClient, workspace: dict) -> None:
    # Add a nested note, then export
    folder = await client.post(f"{workspace['base']}/folders", json={"name": "Deep"}, headers=workspace["headers"])
    await client.post(
        f"{workspace['base']}/notes",
        json={"title": "Buried", "folder_id": folder.json()["data"]["id"], "content": "# Buried\ntext"},
        headers=workspace["headers"],
    )

    resp = await client.get(f"{workspace['base']}/export", headers=workspace["headers"])
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/zip"

    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = set(zf.namelist())
    assert "Deep/Buried.md" in names
    assert "Welcome to Nodum.md" in names
    assert zf.read("Deep/Buried.md").decode() == "# Buried\ntext"


async def test_import_rejects_garbage(client: AsyncClient, workspace: dict) -> None:
    resp = await client.post(
        f"{workspace['base']}/import",
        files={"file": ("bad.zip", b"this is not a zip", "application/zip")},
        headers=workspace["headers"],
    )
    assert resp.status_code == 422


async def test_import_attachments_and_obsidian_config(client: AsyncClient, workspace: dict) -> None:
    """S9.3: binary files land in attachments; .obsidian config maps settings."""
    import io as _io
    import struct
    import zipfile as _zip

    # 1x1 PNG
    import zlib as _zlib

    def _chunk(tag: bytes, data: bytes) -> bytes:
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", _zlib.crc32(c) & 0xFFFFFFFF)

    png = (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
        + _chunk(b"IDAT", _zlib.compress(b"\x00\x00\x00\x00"))
        + _chunk(b"IEND", b"")
    )

    buf = _io.BytesIO()
    with _zip.ZipFile(buf, "w") as zf:
        zf.writestr("Imported note.md", "Hello import.")
        zf.writestr("assets/pic.png", png)
        zf.writestr(".obsidian/daily-notes.json", '{"format": "YYYY/MM/DD", "folder": "Journal"}')
        zf.writestr(".obsidian/workspace.json", "{}")

    resp = await client.post(
        f"/api/v1/vaults/{workspace['vault_id']}/import",
        files={"file": ("vault.zip", buf.getvalue(), "application/zip")},
        headers=workspace["headers"],
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert data["imported"] >= 1
    assert data["imported_attachments"] == 1
    assert data["settings_mapped"] is True

    atts = await client.get(f"/api/v1/vaults/{workspace['vault_id']}/attachments", headers=workspace["headers"])
    assert any(a["filename"] == "pic.png" for a in atts.json()["data"])

    vaults = await client.get("/api/v1/vaults", headers=workspace["headers"])
    settings = next(v for v in vaults.json()["data"] if v["id"] == workspace["vault_id"])["settings"]
    assert settings["dailyNoteFormat"] == "YYYY/MM/DD"
    assert settings["dailyNoteFolder"] == "Journal"


async def test_oversized_body_is_rejected_before_it_is_read(client: AsyncClient, workspace: dict) -> None:
    """The cap must bite on Content-Length, not after the bytes are in RAM.

    FastAPI parses multipart before resolving auth, so a handler-level check
    fires too late to stop an unauthenticated caller filling the disk.
    """
    from app.constants.limits import MAX_REQUEST_BODY_BYTES

    auth, vault_id = workspace["headers"], workspace["vault_id"]

    # Declare a huge body without sending one — if the guard works, the request
    # is refused on the header alone.
    resp = await client.post(
        f"/api/v1/vaults/{vault_id}/import",
        headers={**auth, "Content-Length": str(MAX_REQUEST_BODY_BYTES + 1), "Content-Type": "application/octet-stream"},
        content=b"",
    )
    assert resp.status_code == 413
    assert resp.json()["error"]["code"] == "payload_too_large"


async def test_malformed_content_length_is_rejected(client: AsyncClient, workspace: dict) -> None:
    auth, vault_id = workspace["headers"], workspace["vault_id"]
    resp = await client.post(
        f"/api/v1/vaults/{vault_id}/import",
        headers={**auth, "Content-Length": "not-a-number", "Content-Type": "application/octet-stream"},
        content=b"",
    )
    assert resp.status_code == 400
