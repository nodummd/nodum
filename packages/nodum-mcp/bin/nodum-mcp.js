#!/usr/bin/env node
/**
 * nodum-mcp — stdio ⇄ Streamable HTTP bridge for a Nodum vault.
 *
 * Nodum speaks MCP over HTTP at /api/v1/mcp with a bearer token. Clients that
 * can only launch a stdio server (some desktop apps, older integrations) run
 * this instead: it connects to the HTTP endpoint with the token and mirrors
 * its tools, resources and prompts on stdio — every call is forwarded as is.
 *
 *   NODUM_URL=https://your-nodum/api/v1/mcp NODUM_TOKEN=nodum_mcp_… npx nodum-mcp
 *   npx nodum-mcp --url https://your-nodum/api/v1/mcp --token nodum_mcp_…
 *
 * The token is read from the environment or an argument and sent as
 * "Authorization: Bearer …"; it is never written anywhere.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const url = arg("url") ?? process.env.NODUM_URL;
const token = arg("token") ?? process.env.NODUM_TOKEN;
if (!url || !token) {
  process.stderr.write(
    "nodum-mcp: set NODUM_URL (…/api/v1/mcp) and NODUM_TOKEN (from Settings → MCP), or pass --url and --token.\n",
  );
  process.exit(2);
}

const upstream = new Client({ name: "nodum-mcp-bridge", version: "0.1.0" });
const transport = new StreamableHTTPClientTransport(new URL(url), {
  requestInit: { headers: { Authorization: `Bearer ${token}` } },
});
try {
  await upstream.connect(transport);
} catch (err) {
  process.stderr.write(`nodum-mcp: could not connect to ${url}: ${err?.message ?? err}\n`);
  process.exit(1);
}

const info = upstream.getServerVersion() ?? { name: "nodum", version: "0" };
const caps = upstream.getServerCapabilities() ?? {};
const server = new Server(
  { name: info.name, version: info.version },
  {
    capabilities: {
      tools: caps.tools ? {} : undefined,
      resources: caps.resources ? {} : undefined,
      prompts: caps.prompts ? {} : undefined,
    },
    instructions: upstream.getInstructions(),
  },
);

server.setRequestHandler(ListToolsRequestSchema, (req) => upstream.listTools(req.params));
server.setRequestHandler(CallToolRequestSchema, (req) => upstream.callTool(req.params));
if (caps.resources) {
  server.setRequestHandler(ListResourcesRequestSchema, (req) => upstream.listResources(req.params));
  server.setRequestHandler(ListResourceTemplatesRequestSchema, (req) =>
    upstream.listResourceTemplates(req.params),
  );
  server.setRequestHandler(ReadResourceRequestSchema, (req) => upstream.readResource(req.params));
}
if (caps.prompts) {
  server.setRequestHandler(ListPromptsRequestSchema, (req) => upstream.listPrompts(req.params));
  server.setRequestHandler(GetPromptRequestSchema, (req) => upstream.getPrompt(req.params));
}

const stdio = new StdioServerTransport();
await server.connect(stdio);
const stop = async () => {
  try {
    await upstream.close();
  } finally {
    process.exit(0);
  }
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
stdio.onclose = stop;
