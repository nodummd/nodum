---
title: Connected accounts
section: Extending
order: 5
summary: Keep a Google Calendar — or, on a self-hosted instance, Gmail — in sync with a vault, so events and threads become notes that stay current.
where: Import data (left sidebar)
---

Import brings your notes across once. A connection keeps something in sync:
calendar events and mail threads arrive as notes on their own, and update
themselves when the source changes.

It only ever goes one way. Nodum reads from Google and writes into your vault.
It never creates, edits or deletes anything in your calendar or mailbox — the
permissions it asks for are read-only, so it could not even if it were asked
to.

## Connecting

**Import data** in the left sidebar (or the command palette) lists what this
server offers under *Live sync*. Pick a source, choose what to sync — how much
history, which labels, where notes land — and then approve the permissions on
Google's screen. The choices are made *before* connecting, and the first sync
runs from them.

A connection belongs to **one vault**, chosen when you connect. Connect the
same account to a second vault and you get a second, independent connection.

## What arrives, and where

**Calendar** — one note per event *series*, in `Calendar/YYYY/MM`. A weekly
standup is a single note, not one per week: the alternative is a note a day
forever, and no useful way to stop it.

Meetings you **declined** are not synced — a meeting you did not go to would
otherwise land on that day's note as though you had, and link you to people you
never met. Invitations you have not answered yet, or accepted tentatively, do
sync: those are exactly the ones worth having in front of you. If you accepted
something and later declined it, the note you already took stays as it is.

**Gmail** — one note per *thread*, in `Gmail/YYYY/MM`. A forty-message
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

**The heading is load-bearing.** Delete it and sync can no longer tell its half
of the note from yours, so it stops touching that note altogether rather than
risk overwriting you — the connection reports it as *left alone*. Put the
heading back and the note starts updating again from the next sync, keeping
whatever is underneath.

If you delete a synced note, it is **not** recreated. Deleting it is taken as a
decision, not an accident. That covers the People notes too — delete one and no
connection puts it back, and the mentions that would have linked to it stay as
plain text.

## Links, and why there are not more of them

A link to a note that does not exist becomes a grey dot in your graph. One of
those per unique sender would bury everything you actually wrote, so links are
rationed:

- **The date.** One per note, pointing at the day's daily note.
- **People**, but only once someone has appeared a few times — three by
  default. Below that their name is plain text. Automated senders
  (`noreply@`, mailing lists) never get one. If a note for them already
  exists — you wrote one, or another connection made it — they are linked
  straight away: the threshold is there to avoid links pointing at nothing,
  and that cannot happen once the note is there.
- **Nothing else.** No links for companies, URLs or subject keywords.

Labels become tags under `gmail/`, so they group together and never collide
with your own.

Text that arrives from outside is escaped before it lands: a subject line
reading `#urgent` will not tag your vault, and one containing `[[Roadmap]]`
will not invent a link into it.

## Choosing what syncs

Everything below is chosen on the setup screen before you connect, and can be
changed later — **Import data → Connected → Options**.

**How much history.** A window from 24 hours to a year, a custom number of
days, or **Future only**, which imports nothing old: new items start arriving
from the moment you connect.

**Skip these senders** (Gmail). Addresses or whole domains whose threads never
become notes. Automated senders (`noreply@`, mailing lists) are already never
linked as people. A domain matches itself exactly — `corp.com` does not also
swallow `mail.corp.com`, because guessing wrong there silently drops mail.

**Links into your graph.** The daily-note link and the People notes can each
be turned off. Off means names and dates stay as plain, readable text — not
links, not gone.

**Calendars.** A Google account usually has several — your own, a shared team
one, a subscribed holiday feed. Tick the ones you want. Each keeps its own
place in the sync, so one that fails does not make the others start over, and
un-ticking one keeps its place rather than throwing it away: tick it again and
it carries on instead of re-importing everything.

The list is refetched from Google each time you open the settings, so a
calendar you made after connecting is there without reconnecting.

**Folder.** Where synced notes go. Empty puts `Calendar/` and `Mail/` at the
top of the vault; set `Sources/Google` and they land under that instead.

**Link a person after.** How many appearances before someone gets their own
note, three by default. Lower it and more of your correspondents become nodes
in the graph — including the one-offs, which is the flood the threshold exists
to stop.

**Store message bodies** (Gmail only). Off by default: notes carry who wrote,
when, and the subject, but not the text. Turn it on and each message's text is
stored too — just the part that message added. The quoted history below a reply
is dropped, because keeping it means a forty-message thread holds the first
message forty times over and the note becomes mostly its own echo.

**Labels** (Gmail only). Which labels are in scope, `INBOX` by default. A
thread is synced if it carries any one of them, and that holds for every sync
rather than only the first import — archiving a thread out of your inbox stops
it updating, and leaves the note and anything you wrote under it alone.
Choosing several labels makes the first import slower, because Google can only
narrow the search to one.

Changes apply from the next sync. Notes already written are not rearranged —
changing the folder affects new notes, not old ones.

## Keeping up

Each stream is checked every five minutes; a new event usually appears within
that. **Sync now** on a connected row queues an immediate run, once a minute
per connection — pressing it repeatedly cannot make Google answer any sooner,
and the run already in flight is the one that finishes.

**Pause** stops the schedule without touching anything else; resume picks up
where it left off, with no backoff carried over. A run already in flight
finishes its current batch first.

The first sync is a backfill — a year of calendar by default, 90 days of mail —
and can take several minutes across a few runs. A floating card shows a
running count while it works, survives reloads (the progress is the server's,
not the page's), and offers **Pause** and **Keep future only** — which stops
importing history, keeps every note already imported, and switches the
connection to syncing new items only. There is no percentage, because Google
does not say how much history there is, and a made-up progress bar is worse
than an honest number.

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

**Disconnect** on a connected row withdraws the permission at Google and
removes the connection.
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
