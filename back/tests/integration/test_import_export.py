"""Vault import/export integration tests."""

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


def _make_zip(files: dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, content in files.items():
            zf.writestr(name, content)
    return buf.getvalue()


async def test_import_obsidian_style_zip(client: AsyncClient, workspace: dict) -> None:
    archive = _make_zip(
        {
            "Ideas/Big idea.md": "Linked to [[Small idea]] and #imported tag.",
            "Ideas/Nested/Small idea.md": "The seed.",
            "Standalone.md": "Root note referencing [[Ideas/Big idea]].",
            "assets/image.png": "not-markdown",
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
    assert stats["skipped_non_markdown"] == 1

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
