---
title: Connected accounts
section: Extending
order: 5
summary: Keep a Google Calendar — or, on a self-hosted instance, Gmail — in sync with a vault, so events and threads become notes that stay current.
where: Settings → Connections
---

Import brings your notes across once. A connection keeps something in sync:
calendar events and mail threads arrive as notes on their own, and update
themselves when the source changes.

It only ever goes one way. Nodum reads from Google and writes into your vault.
It never creates, edits or deletes anything in your calendar or mailbox — the
permissions it asks for are read-only, so it could not even if it were asked
to.

## Connecting

Settings → **Connections** lists what this server offers. Pick one, approve the
permissions on Google's screen, and the first sync starts on its own.

A connection belongs to **one vault**, chosen when you connect. Connect the
same account to a second vault and you get a second, independent connection.

## What arrives, and where

**Calendar** — one note per event *series*, in `Calendar/YYYY/MM`. A weekly
standup is a single note, not one per week: the alternative is a note a day
forever, and no useful way to stop it.

**Gmail** — one note per *thread*, in `Mail/YYYY/MM`. A forty-message
conversation is one place in your graph rather than forty.

Each note carries the source's own details as properties — start and end time,
attendee count, participants, labels — and links to the day it happened, using
whatever date format your daily notes use.

## The `## Notes` heading

This is the part worth knowing.

Every synced note is two halves. Everything **above** the `## Notes` heading
belongs to the sync and gets rewritten whenever the event or thread changes.
Everything **from that heading down is yours**, and sync never touches it.

```markdown
# Design review

[[2026-09-02]] 14:00–15:00 · Work
With Amara Osei and Dan Reeves.

## Notes

Amara pushed back on the timeline. Follow up Tuesday.     ← never overwritten
```

Write your meeting notes underneath. Reschedule the event, rename it, add
attendees — the top half updates and what you wrote stays exactly as it was.

If you delete a synced note, it is **not** recreated. Deleting it is taken as a
decision, not an accident.

## Links, and why there are not more of them

A link to a note that does not exist becomes a grey dot in your graph. One of
those per unique sender would bury everything you actually wrote, so links are
rationed:

- **The date.** One per note, pointing at the day's daily note.
- **People**, but only once someone has appeared a few times — three by
  default. Below that their name is plain text. Automated senders
  (`noreply@`, mailing lists) never get one.
- **Nothing else.** No links for companies, URLs or subject keywords.

Labels become tags under `gmail/`, so they group together and never collide
with your own.

Text that arrives from outside is escaped before it lands: a subject line
reading `#urgent` will not tag your vault, and one containing `[[Roadmap]]`
will not invent a link into it.

## Keeping up

Each stream is checked every five minutes; a new event usually appears within
that. **Sync now** in Settings → Connections queues an immediate run, once a
minute per connection — pressing it repeatedly cannot make Google answer any
sooner, and the run already in flight is the one that finishes.

The first sync is a backfill — a year of calendar by default, 90 days of mail —
and can take several minutes across a few runs. It shows a running count while
it works. There is no percentage, because Google does not say how much history
there is, and a made-up progress bar is worse than an honest number.

The connection also says what the last run actually did — *"Last run: 3 new, 1
updated, 12 unchanged"* — and tells you plainly if anything could not be saved,
rather than reporting "up to date" regardless.

## When it stops

**"Disconnected by Google"** means the grant is gone: access was removed from
your Google account, or the password changed. Press **Reconnect**.

If you self-host and sync dies after almost exactly seven days, the cause is
almost always that the OAuth consent screen in your Google Cloud project is
still set to **Testing** — Google expires every refresh token after a week in
that mode. Set it to **In production** and reconnect. Nodum recognises this
case and says so, because "reconnect" alone does not fix it: it works for
another seven days and then breaks again.

## Disconnecting

**Disconnect** withdraws the permission at Google and removes the connection.
Notes already in your vault are **kept** — they are yours, you may have written
under them, and deleting them is not something a disconnect should decide.

If the same Google account is connected to another vault, the permission is
**left in place** and only this connection goes. Google withdraws permission
per account rather than per connection, so handing it back here would silently
break the other vault too — and it would report that Google had revoked it,
which would not be true.

Closing your account or deleting the vault also hands the permission back
before removing anything.

## Why Gmail is not always available

Google grades API permissions. Calendar's read scopes are *sensitive*: a
one-time review. Gmail's are *restricted*, which obliges any hosted,
multi-user service to pass a security audit by an accredited assessor, renewed
every year at real cost.

So Gmail is available on **self-hosted instances**, where the operator uses
their own Google Cloud project and Google's personal-use exemption applies. If
the Gmail card is missing or greyed out, that is why. Calendar has no such
restriction.

Setup for self-hosters is in `docs/OWNER-SETUP.md`.
