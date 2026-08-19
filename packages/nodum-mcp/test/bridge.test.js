/**
 * Drives the bridge over stdio the way a client would: initialize, list the
 * tools, call list_vaults. Needs a running Nodum API and a token:
 *   NODUM_URL=http://localhost:8000/api/v1/mcp NODUM_TOKEN=… node test/bridge.test.js
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.join(here, "..", "bin", "nodum-mcp.js");
const child = spawn(process.execPath, [bin], { env: process.env, stdio: ["pipe", "pipe", "inherit"] });

let buf = "";
const pending = new Map();
child.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});
let nextId = 1;
function call(method, params) {
  const id = nextId++;
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 15000);
  });
}

const init = await call("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "bridge-test", version: "0" },
});
assert.equal(init.result.serverInfo.name, "nodum");
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
const tools = await call("tools/list", {});
assert.ok(tools.result.tools.length >= 30, "tools are mirrored");
assert.ok(tools.result.tools.some((t) => t.name === "create_note"));
const vaults = await call("tools/call", { name: "list_vaults", arguments: {} });
assert.ok(!vaults.result.isError, JSON.stringify(vaults.result));
assert.ok(Array.isArray(vaults.result.structuredContent?.result ?? vaults.result.structuredContent));
console.log("nodum-mcp bridge: ok —", tools.result.tools.length, "tools,", "list_vaults answered");
child.kill();
process.exit(0);
