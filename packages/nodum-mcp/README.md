# nodum-mcp

A stdio bridge to a Nodum vault's MCP server, for MCP clients that cannot send
an HTTP header. Nodum itself speaks MCP over Streamable HTTP at
`https://your-nodum/api/v1/mcp` with a bearer token (Settings → MCP); this
package launches as a stdio server and forwards every tool, resource and
prompt call to that endpoint.

From a checkout (the package is not yet published to npm — until it is,
`npx nodum-mcp` is NOT a thing, do not configure it):

```json
{
  "mcpServers": {
    "nodum": {
      "command": "node",
      "args": ["/path/to/nodum/packages/nodum-mcp/bin/nodum-mcp.js"],
      "env": {
        "NODUM_URL": "https://your-nodum/api/v1/mcp",
        "NODUM_TOKEN": "nodum_mcp_…"
      }
    }
  }
}
```

Prefer the direct HTTP configuration whenever your client supports headers
(Claude Code and Cursor do) — it is one process fewer. `mcp-remote` works
too; this bridge exists so the setup is one line and the token never appears
in an argument list.

Install its dependency once (`npm install` inside `packages/nodum-mcp`), then:

```bash
node packages/nodum-mcp/bin/nodum-mcp.js --url http://localhost:3000/api/v1/mcp --token nodum_mcp_…
```

Smoke test against a running API: `NODUM_URL=… NODUM_TOKEN=… npm test`.
