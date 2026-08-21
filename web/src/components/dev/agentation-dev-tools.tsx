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

export function AgentationDevTools() {
  if (!Agentation) return null;
  return <Agentation />;
}
