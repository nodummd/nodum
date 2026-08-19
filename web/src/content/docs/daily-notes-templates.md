---
title: Daily notes and templates
section: Organising
order: 2
summary: One note per day, created on demand from a template; templates for anything you write more than once.
where: Ribbon → calendar icon; Settings → Vault for the format, folder and template
---

## Daily notes

The calendar icon in the ribbon (or *Open today's daily note* in the palette) opens today's note — creating it if it does not exist yet. Where it goes and what it is called come from Settings → Vault: a **date format** (`YYYY-MM-DD` by default), a **folder** (`Journal`, say), and optionally a **template** note whose content seeds each new day.

The demo workspace's `Daily/` folder shows the pattern.

## Templates

Keep templates in a folder (Settings → Vault → *Templates folder*, `Templates` by default). *Insert template* in the palette lists that folder's notes; pick one and its content is inserted at the cursor. Inside a template, `{{date}}`, `{{time}}` and `{{title}}` are filled in.

![The template picker.](/docs/templates.png)
