---
title: Community — talk Nodum
section: Sharing
order: 5
summary: A built-in forum at /community — announcements, help, bug reports, feature requests and showcases, readable by anyone, joined with your Nodum account.
where: The Community link in the site's top navigation
---

## What it is

Every Nodum deployment carries its own forum at `/community` — the same idea
as Obsidian's forum, native to the platform. Five fixed rooms:
**Announcements** (staff post, everyone reads), **Help**, **Bug Reports**,
**Feature Requests** (like the opening post to vote), and **Showcase**.

Reading needs no account: topics, threads, profiles and search are public
pages a search engine can index. Writing uses the account you already have —
there is nothing extra to join.

![The community: categories on the left, the latest conversations on the right.](/docs/community.png)

## Reading

**Latest** is the front page; **Top** ranks by replies over a week, month or
all time. Category pages float pinned topics first. Threads number every
post (`#12`) so links land mid-conversation, and a removed post leaves a
numbered placeholder — the thread's shape never shifts under you.

Signed in, topic lists show a dot on anything with posts you have not read
yet — it clears the moment you open the thread, and only ever moves forward.

## Writing

**New topic** asks for a category, a title and markdown. The preview tab
shows exactly what readers will get, because it runs the same renderer.
A deliberately careful renderer, since strangers read each other here:

- Markdown with GFM (tables, task lists, fenced code) — but raw HTML stays
  the literal text you typed, never markup.
- Images become links. A stranger's post cannot make your browser fetch
  anything.

Reply at the bottom of any unlocked thread. You can **edit** your own posts
(readers see an *edited* marker) and **delete** your own replies. A topic of
yours deletes only while nobody has replied — after that the conversation
belongs to everyone in it, and staff take over.

Like posts with the ♥. On Feature Requests, liking the opening post is the
vote.

## Search

`/community/search` looks through every title and post, ranks by relevance
and highlights the matches; body hits deep-link straight to the post.

## Keeping it healthy

**Report** on any post sends it to the staff queue with your reason — once
per post per person. Staff can pin, lock, retitle, recategorize and remove
content anywhere, and work the queue at `/community/mod`.

Staff is a flag operators grant: set `COMMUNITY_BOOTSTRAP_STAFF_EMAIL` in
the deployment's environment before first start (that account becomes staff
automatically), or flip `users.is_staff` in the database later.

Posting has gentle speed limits — five topics and thirty replies an hour,
with a short gap between messages — enough for any human, boring for a bot.
