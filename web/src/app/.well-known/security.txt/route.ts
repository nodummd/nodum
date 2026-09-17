import { GITHUB_URL, SITE_URL } from "@/lib/seo/site";

/**
 * /.well-known/security.txt (RFC 9116) — where to report a vulnerability.
 *
 * `Expires` is required and must be less than a year out, so it is computed
 * rather than written: the file is regenerated daily and always expires 180
 * days after it was built. A hand-typed date is one that quietly lapses and
 * makes the file invalid.
 *
 * Reports go to GitHub's private vulnerability reporting for the repository.
 * SECURITY_CONTACT overrides it (a mailto: or https: URI) for a fork or a
 * deployment with its own security desk.
 */

export const revalidate = 86400;

const EXPIRES_IN_DAYS = 180;

export function GET() {
  const contact = process.env.SECURITY_CONTACT || `${GITHUB_URL}/security/advisories/new`;
  const expires = new Date(Date.now() + EXPIRES_IN_DAYS * 86_400_000);
  expires.setUTCHours(0, 0, 0, 0);
  const body = [
    `Contact: ${contact}`,
    `Expires: ${expires.toISOString()}`,
    "Preferred-Languages: en",
    `Canonical: ${SITE_URL}/.well-known/security.txt`,
    `Policy: ${GITHUB_URL}/security/policy`,
    "",
  ].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
