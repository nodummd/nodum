# Owner setup — things only you can do

Everything in the codebase ships self-contained, but a few features touch
external accounts or infrastructure that only you control. Each section below
is optional and independent — the app runs fine with none of them; the
feature simply stays hidden/disabled until its variables exist.

All secrets go in `deploy/.env` (gitignored — never commit it). After editing
it, restart the stack: `cd deploy && ./compose.sh prod up -d`.

---

## 1. Google OAuth (enables "Continue with Google") — needed for S8.1

1. Open https://console.cloud.google.com/ → create (or pick) a project.
2. **APIs & Services → OAuth consent screen**: External, app name "nodum",
   add your support email, publish the app (or keep Testing + add your own
   Google account under Test users).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized JavaScript origins: `https://nodum.md` (and
     `http://localhost:3100` for local testing)
   - Authorized redirect URIs:
     - `https://nodum.md/api/v1/auth/google/callback`
     - `http://localhost:3100/api/v1/auth/google/callback` (local)
4. Copy the client ID + secret into `deploy/.env`:
   ```
   GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxx
   ```
5. Restart the stack. The Google buttons appear automatically; if the vars
   are unset the login page shows email/password only.

## 1b. Google Calendar / Gmail sync (optional)

Lets a user connect a Google account and have events — and, on a self-hosted
instance, mail threads — appear as notes that keep themselves up to date.

This uses a **second, separate** OAuth client from the sign-in one above. The
scopes and the review tier are different, and sharing one client would drag
sign-in into Gmail's compliance regime.

### Register the client

1. In the same Google Cloud project (or a new one), **APIs & Services →
   Enabled APIs** → enable **Google Calendar API**, and **Gmail API** only if
   you intend to sync mail.
2. **Credentials → Create credentials → OAuth client ID → Web application**.
3. Authorised redirect URI:
   `https://your-domain/api/v1/connections/google/callback`
4. Put the id and secret in your env file:

   ```
   GOOGLE_SYNC_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
   GOOGLE_SYNC_CLIENT_SECRET=...
   # Encrypts stored refresh tokens. Falls back to AI_ENCRYPTION_KEY if unset.
   # python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
   OAUTH_ENCRYPTION_KEY=...
   ```

### ⚠️ Publish the app, or sync dies after exactly 7 days

**This is the step everyone misses, and the failure looks like a Nodum bug.**

On the **OAuth consent screen** page, the publishing status starts as
**Testing**. In Testing, Google expires every *refresh token* after seven days.
Not the access token — the refresh token. Everything works perfectly for a
week, and then every connection breaks at once with an opaque `invalid_grant`.

Press **Publish app** to move the status to **In production**.

You do *not* need to complete Google's verification review to do this. An
unverified app in production shows a one-time "Google hasn't verified this app"
interstitial — click **Advanced → Go to Nodum (unsafe)** — and is capped at 100
lifetime users, which is irrelevant for a personal or team instance. What you
get in exchange is refresh tokens that do not expire.

Nodum detects this case: a connection that dies within eight days of being made
is reported as "your consent screen is still in Testing mode" rather than the
generic reconnect advice, because reconnecting does not fix it.

### Gmail is self-hosted only

```
GOOGLE_SYNC_GMAIL_ENABLED=true
```

Every Gmail scope — including `gmail.metadata` — sits on Google's **restricted**
list. A hosted, multi-user service requesting one must pass a CASA security
assessment by an authorised lab, renewed annually, priced from several hundred
to several thousand dollars a year. An operator running Nodum for themselves is
covered by Google's personal-use exemption and owes none of it — which is why
this flag exists and why **hosted deployments must leave it unset**.

Calendar's scopes are merely *sensitive*: a one-time review, no fee. That is why
Calendar is available without a flag.

### What it reads, and what it writes

Read-only, always. Nodum never creates, edits or deletes anything in Google.

In your vault it writes one note per calendar event series and one per mail
thread, foldered by month, with a link to the day's daily note. Everything it
writes lives **above** a `## Notes` heading in each note; anything you write
below that heading is never touched by a later sync. Deleting a synced note by
hand is respected — it is not recreated on the next poll.

---

## 2. Domain + production deploy (nodum.md)

Full walkthrough in [deploy.md](deploy.md). Short version of what only you
can do:

1. Point DNS `A`/`AAAA` records for `nodum.md` (and `www`) at your server.
2. Install Docker + Caddy on the server; copy the Caddyfile from deploy.md.
3. `cp deploy/.env.example deploy/.env` and fill every `:?` variable —
   generate secrets with `openssl rand -hex 48`.
4. `cd deploy && ./compose.sh prod up -d --build`.
5. Schedule the two backup scripts from [backup.md](backup.md) (cron) and
   run the restore drill once.

## 3. Email delivery (required in production — signup sends a code)

Three flows mail a six-digit code: confirming a new signup, resetting a
forgotten password, and deleting an account. They share one provider chain,
so configuring it once covers all three.

Production requires new accounts to confirm their address, so the API
**refuses to boot** with `EMAIL_VERIFICATION_REQUIRED=true` and no provider
configured. Outside production nothing is mailed and the code is always
`123456`, so local development needs none of this.

Providers are tried in the order listed in `EMAIL_PROVIDERS`. Configure more
than one and you get two things: delivery survives a provider having a bad
hour, and the free tiers add up — a quota rejection is just another error, so
the message moves down the chain.

Free tiers as of 2026-08 (check before relying on them; they move):

| Provider | Free tier | Get a key |
|---|---|---|
| **Brevo** (start here) | **300/day (~9,000/month), no expiry** | app.brevo.com → SMTP & API → API keys |
| Mailjet | 6,000/month, 200/day cap | app.mailjet.com/account/apikeys |
| Resend | 3,000/month (~100/day) | resend.com/api-keys |
| Mailgun | 100/day | app.mailgun.com → Sending → Domain settings |
| SMTP | whatever you point it at (Amazon SES, Postmark, your own relay) | — |

Mailchimp Transactional (Mandrill) is deliberately absent: it has no free
tier at all, only paid blocks.

1. Sign up with at least Brevo, and add the sender domain it asks for.
2. **Add the SPF and DKIM records each provider gives you.** An
   unauthenticated `From:` lands in spam, which arrives as a support ticket
   saying "the email never came".
3. In `deploy/.env`:
   ```
   EMAIL_VERIFICATION_REQUIRED=true
   EMAIL_FROM_ADDRESS=no-reply@nodum.md
   EMAIL_PROVIDERS=brevo,mailjet,resend,mailgun,smtp
   BREVO_API_KEY=xkeysib-…
   MAILJET_API_KEY=…
   MAILJET_API_SECRET=…
   ```
4. Restart the API and sign up with a real address to confirm the round trip.
   `email_sent` in the logs names the provider that took it; the
   `email_verifications.delivered_via` column records it per code.

Running a private instance where anyone with the URL is trusted? Set
`EMAIL_VERIFICATION_REQUIRED=false` and skip all of the above.

## 4. Sentry error tracking (optional)

1. Create a project at https://sentry.io (or self-hosted) → copy the DSN.
2. In `deploy/.env`:
   ```
   SENTRY_DSN=https://…ingest.sentry.io/…          # backend + web server
   NEXT_PUBLIC_SENTRY_DSN=https://…                # browser
   ```
3. Rebuild web (`./compose.sh prod up -d --build web`) — the browser DSN is
   baked in at build time. Leave both empty to run without Sentry.

## 5. Better semantic search (optional)

"Related notes" ships with a local hash embedder (zero setup, modest
quality). To upgrade, set an embedding provider in `deploy/.env`:
```
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=sk-…
```
Existing notes re-embed on their next save; a bulk re-embed script can be
added on request.

## 6. Dedicated control-plane Redis (recommended at real scale)

Run a second Redis with `--maxmemory-policy noeviction` and point
`REDIS_CONTROL_URL` at it so auth/rate-limit state can never be evicted by
cache pressure. See the comments in `deploy/docker-compose.yml`.

## 7. PWA install icons (S7.2 ships defaults)

The PWA ships with generated placeholder icons. If you want branded ones,
drop `icon-192.png` and `icon-512.png` into `web/public/` (square PNGs,
those exact names) — no code changes needed.

---

**Checklist at a glance**

| Feature | You provide | Where |
|---|---|---|
| Google login | OAuth client ID + secret | `deploy/.env` |
| Production site | DNS + server + filled `.env` | `deploy/.env`, Caddy |
| Signup emails | one provider key (Brevo first) + SPF/DKIM | `deploy/.env`, DNS |
| Error tracking | Sentry DSN(s) | `deploy/.env` |
| Better related-notes | OpenAI API key | `deploy/.env` |
| Bulletproof auth state | second Redis URL | `deploy/.env` |
| Branded PWA icons | two PNGs | `web/public/` |
