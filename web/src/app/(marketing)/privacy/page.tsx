import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { GITHUB_URL as GITHUB } from "@/lib/app-meta";

export const metadata: Metadata = {
  title: "Privacy Policy · Nodum",
  description:
    "What nodum.md collects, what it does with Google account data, where everything is stored, and how to get it all back or delete it.",
};

const UPDATED = "31 August 2026";

/** Privacy policy for the hosted instance at nodum.md.
 *
 *  Nodum itself is open source and stores nothing anywhere; this document is
 *  about the *server* — one instance, run by one person. It also has to satisfy
 *  Google OAuth verification, which requires a public policy on the app's own
 *  domain, linked from the homepage, describing exactly what is done with data
 *  from a connected Google account and carrying the Limited Use affirmation.
 *
 *  Everything stated here was checked against the code rather than assumed. If
 *  the behaviour changes, this changes with it. */
export default function PrivacyPage() {
  return (
    <>
      <SiteNav />
      <div className="mx-auto w-full max-w-3xl px-4 pt-12 pb-20 sm:px-6">
        <header className="mb-10">
          <p className="mk-eyebrow">Legal</p>
          <h1 className="mk-display text-[2rem] sm:text-[2.4rem]">Privacy Policy</h1>
          <p className="mk-mono mt-3 text-[0.72rem] opacity-60">Last updated {UPDATED}</p>
        </header>

        <div className="flex flex-col gap-9 text-[0.95rem] leading-relaxed">
          <section>
            <p className="opacity-90">
              Nodum is an open-source project. <strong>nodum.md</strong> is one instance of it,
              hosted and paid for by one person on their own server, and offered to anyone who is
              comfortable keeping their notes there. It is not a company, and there is no team
              behind it.
            </p>
            <p className="mt-3 opacity-90">
              If you would rather not trust someone else&rsquo;s server — a reasonable position —
              the whole thing runs with one Docker Compose command on hardware you control, and
              this document then describes nothing, because no data reaches me at all.{" "}
              <a className="mk-navlink" href={GITHUB} target="_blank" rel="noreferrer">
                Read the source
              </a>
              .
            </p>
          </section>

          <Section title="What is collected">
            <Item label="Your account">
              Email address, display name, and a hash of your password — never the password itself.
              If you sign in with Google instead, the email address and name Google returns.
            </Item>
            <Item label="What you write">
              Notes, folders, tags, canvases and uploaded attachments. These are stored so they can
              be given back to you. They are not read, mined, analysed or used to train anything.
            </Item>
            <Item label="Operational records">
              Server logs of requests, including IP address, kept so the service can be run and
              abused less easily — rate limiting needs to know who is asking.
            </Item>
            <Item label="Nothing else">
              There is no analytics, no advertising, no tracking pixels, no third-party scripts and
              no cookies beyond the one that keeps you signed in. This is not a policy position so
              much as a description: none of that code exists in the project.
            </Item>
          </Section>

          <Section title="Google account data" id="google">
            <p className="opacity-90">
              Connecting a Google account is entirely optional and off until you choose it. If you
              never connect one, this section does not apply to you.
            </p>

            <h3 className="mt-5 mb-2 font-semibold">What is requested, and why</h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[30rem] border-collapse text-[0.86rem]">
                <thead>
                  <tr className="border-b border-[var(--mk-line)] text-left opacity-60">
                    <th className="py-2 pr-4 font-medium">Permission</th>
                    <th className="py-2 font-medium">Used for</th>
                  </tr>
                </thead>
                <tbody className="align-top">
                  <tr className="border-b border-[var(--mk-line)]">
                    <td className="mk-mono py-2 pr-4 text-[0.78rem]">openid, email</td>
                    <td className="py-2">
                      Telling one connected account from another, and showing you which one is
                      connected.
                    </td>
                  </tr>
                  <tr className="border-b border-[var(--mk-line)]">
                    <td className="mk-mono py-2 pr-4 text-[0.78rem]">calendar.events.readonly</td>
                    <td className="py-2">
                      Reading your events so each one can become a note. This is the narrow scope —
                      not <span className="mk-mono text-[0.78rem]">calendar.readonly</span>, which
                      would also expose settings and sharing rules.
                    </td>
                  </tr>
                  <tr className="border-b border-[var(--mk-line)]">
                    <td className="mk-mono py-2 pr-4 text-[0.78rem]">
                      calendar.calendarlist.readonly
                    </td>
                    <td className="py-2">
                      Listing which calendars exist, so you can choose which ones to sync.
                    </td>
                  </tr>
                  <tr>
                    <td className="mk-mono py-2 pr-4 text-[0.78rem]">gmail.readonly</td>
                    <td className="py-2">
                      Reading mail threads so each becomes a note.{" "}
                      <strong>Not enabled on nodum.md.</strong> It is available only to people
                      running their own server, for the reason given below.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 className="mt-6 mb-2 font-semibold">What is done with it</h3>
            <p className="opacity-90">
              Events and threads are turned into ordinary markdown notes inside your own vault, on
              the same server, alongside everything else you write. That is the entire purpose. The
              data is not sent anywhere else, shown to anyone else, or used for any other feature.
            </p>
            <p className="mt-3 opacity-90">
              Every permission requested is <strong>read-only</strong>. Nodum has no ability to
              create, change or delete anything in your calendar or mailbox, and would not be able
              to if asked.
            </p>

            <h3 className="mt-6 mb-2 font-semibold">How the connection is stored</h3>
            <p className="opacity-90">
              Google issues a token that lets the sync keep running in the background. It is
              encrypted before being written to the database, with a key held only in the
              server&rsquo;s configuration, and it never appears in any page, API response or log.
            </p>

            <h3 className="mt-6 mb-2 font-semibold">Limited Use</h3>
            <div className="mk-card px-4 py-3 text-[0.9rem]">
              <p className="opacity-90">
                Nodum&rsquo;s use and transfer of information received from Google APIs adheres to
                the{" "}
                <a
                  className="mk-navlink"
                  href="https://developers.google.com/terms/api-services-user-data-policy"
                  target="_blank"
                  rel="noreferrer"
                >
                  Google API Services User Data Policy
                </a>
                , including the Limited Use requirements. Specifically: data obtained through these
                permissions is used only to provide the sync feature you asked for, is never sold,
                is never transferred to others except as needed to run the service or where the law
                requires it, is never used for advertising, and is never read by a human except with
                your explicit permission — for example, if you ask for help with a problem.
              </p>
            </div>

            <h3 className="mt-6 mb-2 font-semibold">Turning it off</h3>
            <p className="opacity-90">
              <strong>Settings → Connections → Disconnect</strong> withdraws the permission at
              Google and removes the stored token. You can also revoke it directly at{" "}
              <a
                className="mk-navlink"
                href="https://myaccount.google.com/permissions"
                target="_blank"
                rel="noreferrer"
              >
                myaccount.google.com/permissions
              </a>
              , which has the same effect.
            </p>
            <p className="mt-3 opacity-90">
              Notes already created from your calendar are <strong>kept</strong>. They are in your
              vault, you may have written under them, and deleting them is not a decision a
              disconnect should make for you. Delete them yourself whenever you like — they are
              ordinary notes.
            </p>
          </Section>

          <Section title="Where it is stored">
            <p className="opacity-90">
              On a rented server in the European Union, together with an object store for
              attachments. Everything sits within the same deployment; there is no separate
              analytics warehouse or backup service holding a second copy elsewhere.
            </p>
            <p className="mt-3 opacity-90">
              Traffic is encrypted in transit. Passwords are hashed, and stored secrets — Google
              tokens and any AI provider key you add — are encrypted at rest.
            </p>
          </Section>

          <Section title="Who else sees it">
            <p className="opacity-90">
              Nobody, other than the services needed to keep the server running:
            </p>
            <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 opacity-90">
              <li>
                <strong>The hosting provider</strong>, which necessarily holds the disks the data
                sits on.
              </li>
              <li>
                <strong>An email provider</strong>, which receives your address in order to deliver
                sign-up and password-reset codes. It receives nothing else.
              </li>
              <li>
                <strong>An error-reporting service</strong>, if enabled, which receives technical
                details of crashes. It is not sent the contents of your notes.
              </li>
            </ul>
            <p className="mt-3 opacity-90">
              Your data is not sold, rented or shared for advertising, and there is no arrangement
              under which it could be. If a valid legal order ever compelled disclosure, you would
              be told unless telling you were itself unlawful.
            </p>
          </Section>

          <Section title="Notes you choose to publish">
            <p className="opacity-90">
              Publishing a note or a vault creates a public link, and the content becomes readable
              by anyone who has it — including search engines. That is the feature working as
              intended, but it is worth stating plainly: it is the one action here that makes your
              writing public. Unpublishing removes the link.
            </p>
          </Section>

          <Section title="Getting it back, and getting rid of it">
            <Item label="Export">
              <strong>Settings → Vault → Export</strong> gives you a zip of your notes as plain
              markdown files. They are yours in a format nothing here owns, at any time, without
              asking.
            </Item>
            <Item label="Deletion">
              <strong>Settings → Account → Delete account</strong> removes your account, vaults,
              notes and uploaded files, deletes attachments from the object store, and withdraws any
              Google permission before the record of it disappears — so you are not left with a
              standing grant that nobody can revoke.
            </Item>
            <Item label="Retention">
              Content is kept while your account exists and removed when you delete it. Server logs
              are kept for a short period for operational reasons and then rotate away. Backups, if
              taken, may hold deleted data briefly until they age out.
            </Item>
          </Section>

          <Section title="Your rights">
            <p className="opacity-90">
              If you are in the UK or the EU, data protection law gives you rights of access,
              correction, deletion, portability and objection. Export and account deletion are built
              into the product so you can exercise the main ones yourself, immediately, without
              writing to anyone. For anything else, use the contact below.
            </p>
            <p className="mt-3 opacity-90">
              Nodum is not intended for children under 13, and accounts are not knowingly created
              for them.
            </p>
          </Section>

          <Section title="Changes">
            <p className="opacity-90">
              If this policy changes in a way that affects what happens to your data, the date at the
              top changes and the change is described in the release notes. The document&rsquo;s
              history is public in the repository, so you can see exactly what changed and when.
            </p>
          </Section>

          <Section title="Contact">
            <p className="opacity-90">
              Questions about any of this, or about your data specifically:{" "}
              <a className="mk-navlink" href="mailto:privacy@nodum.md">
                privacy@nodum.md
              </a>
              .
            </p>
            <p className="mt-3 opacity-90">
              For bugs and feature requests the{" "}
              <a className="mk-navlink" href={GITHUB} target="_blank" rel="noreferrer">
                repository
              </a>{" "}
              is a better place, and public discussion helps everyone.
            </p>
          </Section>

          <p className="mk-mono text-[0.72rem] opacity-60">
            See also the{" "}
            <Link className="mk-navlink" href="/terms">
              Terms of Service
            </Link>
            .
          </p>
        </div>
      </div>
      <SiteFooter />
    </>
  );
}

function Section({
  title,
  id,
  children,
}: {
  title: string;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-6">
      <h2 className="mb-3 text-[1.15rem] font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p className="mb-3 opacity-90 last:mb-0">
      <strong>{label}.</strong> {children}
    </p>
  );
}
