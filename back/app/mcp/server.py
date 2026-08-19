"""Nodum as an MCP server.

Everything a person can do in the app, offered as tools to any MCP client
(Claude Desktop, Claude Code, Cursor, …) over Streamable HTTP at
`/api/v1/mcp`. Each tool is a thin wrapper over the same service the UI calls,
scoped by the same `get_owned_vault` check, so an LLM with a token can do
exactly what its owner can — and nothing more.

Design notes:
- Stateless + JSON responses: every POST is independent, no session ids, no
  SSE. Simplest thing that works through the same `/api` proxy the web app
  uses, on every deployment.
- Auth is `BearerTokenGate` in front of the ASGI app; tools read the user id
  it stamped on the request scope. No token, no protocol.
- Tools return plain dicts (the SDK serialises them as structured content),
  and raise ToolError with a sentence the model can act on.
"""

from typing import Any
from uuid import UUID

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.transport_security import TransportSecuritySettings

from app.mcp.auth import USER_ID_KEY, BearerTokenGate

server = MCPServer(
    name="nodum",
    title="Nodum",
    description="Your Nodum vaults: notes, folders, links, tags, the graph, import and export.",
    instructions=(
        "Nodum is a markdown knowledge base. A VAULT is a separate workspace; most tools take a "
        "vault_id — call list_vaults first. Notes are identified by title or folder path "
        '("Projects/Alpha"). Link notes by writing [[Other note]] in markdown; connect two '
        "existing notes with link_notes. Prefer search_notes before creating something that may "
        "already exist. Every write goes through the same rules as the app: names cannot contain "
        '* " \\ / < > : | ? # ^ [ ].'
    ),
    website_url="https://github.com/nodummd/nodum",
)


def user_id_from(ctx: Any) -> UUID:
    """The owner of the token this call arrived with (stamped by BearerTokenGate)."""
    request = getattr(getattr(ctx, "request_context", None), "request", None)
    state = getattr(request, "state", None)
    user_id = getattr(state, USER_ID_KEY, None) if state is not None else None
    if user_id is None:
        raise ToolError("Not authenticated: this tool must be called through the HTTP endpoint with a token.")
    return user_id


def as_uuid(value: str, what: str = "id") -> UUID:
    try:
        return UUID(str(value))
    except (ValueError, TypeError) as exc:
        raise ToolError(f"{what} must be a UUID, got {value!r}.") from exc


def unwrap(response: Any) -> Any:
    """ServiceResponse → data, or a ToolError with the service's own message."""
    if not response.success:
        raise ToolError(response.message or response.error_code or "The operation failed.")
    return response.data


# Tools register themselves against `server` on import.
from app.mcp import tools  # noqa: E402,F401

# The ASGI app FastAPI mounts. Stateless: no session ids to keep, which is
# what lets it sit behind an ordinary reverse proxy without sticky routing.
# DNS-rebinding protection is off because a bearer token is required on every
# request — the attack it guards against (a page on another origin talking to
# a localhost server that trusts it) has nothing to gain here.
MCP_PATH = "/api/v1/mcp"

# Registered as a plain Route at MCP_PATH rather than mounted: a Mount serves
# "/api/v1/mcp/" and answers the exact path with a 307, which MCP clients do
# not follow. So the inner app is built to match the full path itself.
mcp_asgi_app = server.streamable_http_app(
    streamable_http_path=MCP_PATH,
    stateless_http=True,
    json_response=True,
    transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
)
mcp_app = BearerTokenGate(mcp_asgi_app)
