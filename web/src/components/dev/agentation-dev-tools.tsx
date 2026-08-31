"use client";

/**
 * Agentation (https://github.com/benjitaylor/agentation): a dev-only visual
 * feedback toolbar. Click elements on the running app, annotate them, and it
 * produces structured markdown (selectors, React component hierarchy, source
 * locations) to paste into an AI coding agent.
 *
 * The NODE_ENV check is evaluated at build time, so the module-scope
 * conditional prunes the entire package from production bundles — prod ships
 * zero agentation bytes. (License: PolyForm Shield — fine as an internal dev
 * tool; it is a devDependency and never redistributed.)
 */

import dynamic from "next/dynamic";

const Agentation =
  process.env.NODE_ENV === "development"
    ? dynamic(() => import("agentation").then((m) => m.Agentation), { ssr: false })
    : null;

/**
 * Without `endpoint` the toolbar keeps annotations in localStorage only, which
 * means copy-pasting markdown into the agent by hand. Pointing it at the
 * agentation MCP server (stdio for the agent, HTTP on 4747 for the browser)
 * closes the loop: the agent reads pending annotations itself. The server is
 * registered per-developer (`claude mcp add --scope local agentation --
 * npx -y agentation-mcp server`), so when it is not running the toolbar just
 * falls back to localStorage — nothing to guard here.
 */
const AGENTATION_ENDPOINT = "http://localhost:4747";

export function AgentationDevTools() {
  if (!Agentation) return null;
  return <Agentation endpoint={AGENTATION_ENDPOINT} />;
}
