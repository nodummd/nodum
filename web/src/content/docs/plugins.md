---
title: Plugins
section: Extending
order: 2
summary: Small scripts that add commands and notices, run in a sandbox with only the permissions they ask for.
where: Settings → Plugins
---

## What a plugin can do

A plugin registers commands (they show up in the palette), reads notes it is allowed to read, creates notes if it is allowed to, and shows notices. Each declares the permissions it needs; you see them before enabling it, and calls outside them are refused.

Plugins run in an isolated frame with no network and no access to the page — a plugin cannot see your session or another site.

![Settings → Plugins.](/docs/settings-plugins.png)

## Adding one

Settings → Plugins → paste the code and a small manifest, enable it. The demo workspace ships with a tiny example that registers two commands.
