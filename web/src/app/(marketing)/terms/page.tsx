import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { GITHUB_URL as GITHUB } from "@/lib/app-meta";

export const metadata: Metadata = {
  title: "Terms of Service · Nodum",
  description:
    "The terms for using nodum.md — a personally-run instance of an open-source project, offered free and without warranty.",
};

const UPDATED = "31 August 2026";

/** Terms for the hosted instance at nodum.md.
 *
 *  Deliberately plain. This is one person offering a free service on their own
 *  server, and terms that pretended otherwise — indemnities, arbitration
 *  clauses, a fictional legal department — would be both dishonest and
 *  unenforceable. Google OAuth verification also requires a public terms
 *  document on the app's own domain, linked from the homepage. */
export default function TermsPage() {
  return (
    <>
      <SiteNav />
      <div className="mx-auto w-full max-w-3xl px-4 pt-12 pb-20 sm:px-6">
        <header className="mb-10">
          <p className="mk-eyebrow">Legal</p>
          <h1 className="mk-display text-[2rem] sm:text-[2.4rem]">Terms of Service</h1>
          <p className="mk-mono mt-3 text-[0.72rem] opacity-60">Last updated {UPDATED}</p>
        </header>

        <div className="flex flex-col gap-9 text-[0.95rem] leading-relaxed">
          <section>
            <p className="opacity-90">
              Nodum is an open-source project under the MIT licence.{" "}
              <strong>nodum.md</strong> is one instance of it, run by one person on their own server
              and offered free to anyone who wants an account. Using it means accepting what
              follows.
            </p>
            <p className="mt-3 opacity-90">
              These terms cover <em>the service at nodum.md</em>, not the software. The software is
              governed by its licence, and running your own copy involves no agreement with anyone —{" "}
              <a className="mk-navlink" href={GITHUB} target="_blank" rel="noreferrer">
                take it and go
              </a>
              .
            </p>
          </section>

          <Section title="What this is, and is not">
            <p className="opacity-90">
              It is a personal project offered in good faith and maintained in spare time. It is not
              a company, it has no support desk, no uptime commitment and no contract behind it. It
              is free because it is a hobby, and it should be treated with the confidence that
              description warrants.
            </p>
            <p className="mt-3 opacity-90">
              Keep your own copy of anything you would be upset to lose. Export is one click and
              produces plain markdown, deliberately.
            </p>
          </Section>

          <Section title="Your account">
            <p className="opacity-90">
              You are responsible for what happens under your account and for keeping your password
              to yourself. Tell me if you think it has been compromised. One person, one account —
              do not share logins.
            </p>
            <p className="mt-3 opacity-90">
              You must be old enough to agree to these terms where you live, and at least 13.
            </p>
          </Section>

          <Section title="Your notes are yours">
            <p className="opacity-90">
              You keep every right you have in what you write. Nothing here transfers ownership,
              and nothing grants a licence to use, publish or train on your content.
            </p>
            <p className="mt-3 opacity-90">
              The only permission the service needs is the technical one required to run: storing
              your notes, serving them back to you, indexing them so search works, and — if you
              explicitly publish something — showing that to whoever has the link. That permission
              exists to operate the feature and ends when you delete the content.
            </p>
          </Section>

          <Section title="What not to do">
            <ul className="flex list-disc flex-col gap-2 pl-5 opacity-90">
              <li>Break the law with it, or store material that is illegal where the server is.</li>
              <li>
                Use it to host malware, phishing pages or anything designed to harm the people who
                open it.
              </li>
              <li>
                Attack the service — automated abuse, credential stuffing, deliberately hunting for
                ways to degrade it for others.
              </li>
              <li>
                Resell it, or use it as backing storage for something you sell, without asking
                first.
              </li>
            </ul>
            <p className="mt-3 opacity-90">
              Genuine security research is welcome. If you find something, please report it
              privately before publishing it, and give me a reasonable chance to fix it.
            </p>
          </Section>

          <Section title="Connecting a Google account">
            <p className="opacity-90">
              Optional, and read-only. The service can never create, change or delete anything in
              your calendar or mailbox. What is accessed and why is set out in the{" "}
              <Link className="mk-navlink" href="/privacy#google">
                Privacy Policy
              </Link>
              .
            </p>
            <p className="mt-3 opacity-90">
              Your use of Google&rsquo;s own services remains between you and Google, on their
              terms. You can withdraw the connection at any time from Settings, or from your Google
              account directly.
            </p>
          </Section>

          <Section title="Availability, and the possibility of ending">
            <p className="opacity-90">
              There is no guaranteed uptime. The service may be slow, may break, may be taken down
              for maintenance without notice, and may one day stop for good — a person&rsquo;s
              circumstances change, and a free service on a personal server is exactly as durable
              as that person&rsquo;s ability to keep paying for and maintaining it.
            </p>
            <p className="mt-3 opacity-90">
              If it is ever shut down deliberately, reasonable notice will be given so you can
              export. That is a commitment I intend to keep, but it is not a legal guarantee and it
              would be dishonest to present it as one. Self-hosting removes this risk entirely.
            </p>
          </Section>

          <Section title="Suspension">
            <p className="opacity-90">
              An account that breaks the rules above may be suspended or removed, with notice where
              that is practical and immediately where the harm is ongoing. If your account is
              closed for a reason that is not abuse, you will get the chance to export first.
            </p>
            <p className="mt-3 opacity-90">
              You can close your account yourself at any time from{" "}
              <strong>Settings → Account</strong>, which deletes your data.
            </p>
          </Section>

          <Section title="No warranty">
            <p className="opacity-90">
              The service is provided <strong>&ldquo;as is&rdquo;</strong>, without warranty of any
              kind, express or implied — including fitness for a particular purpose and
              uninterrupted or error-free operation. This mirrors the MIT licence the software
              carries.
            </p>
            <p className="mt-3 opacity-90">
              To the fullest extent the law allows, I am not liable for lost data, lost profits or
              any indirect or consequential loss arising from using or being unable to use the
              service. Nothing here limits liability for anything that cannot lawfully be limited,
              such as death or personal injury caused by negligence, or fraud.
            </p>
            <p className="mt-3 opacity-90">
              If you are a consumer, you keep every statutory right you have; these terms do not
              take any of them away.
            </p>
          </Section>

          <Section title="Changes">
            <p className="opacity-90">
              These terms may change. Material changes will be noted in the release notes and the
              date above will move. The full history is public in the repository. Continuing to use
              the service after a change means accepting it; if you would rather not, export and
              close your account.
            </p>
          </Section>

          <Section title="Law">
            <p className="opacity-90">
              These terms are governed by the law of the operator&rsquo;s place of residence, and
              its courts have jurisdiction — except that, if you are a consumer, you may also bring
              proceedings in your own country, and the mandatory consumer protections there still
              apply to you.
            </p>
          </Section>

          <Section title="Contact">
            <p className="opacity-90">
              <a className="mk-navlink" href="mailto:hello@nodum.md">
                hello@nodum.md
              </a>{" "}
              for anything about the service, or the{" "}
              <a className="mk-navlink" href={GITHUB} target="_blank" rel="noreferrer">
                repository
              </a>{" "}
              for bugs and feature requests.
            </p>
          </Section>

          <p className="mk-mono text-[0.72rem] opacity-60">
            See also the{" "}
            <Link className="mk-navlink" href="/privacy">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </div>
      <SiteFooter />
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-[1.15rem] font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}
