import type { Metadata } from "next";

import { SiteNav } from "@/components/marketing/site-chrome";
import { pageMetadata } from "@/lib/seo/metadata";

import { ScalarClient } from "./scalar-client";

export const metadata: Metadata = pageMetadata({
  title: "API reference — Nodum REST API",
  description:
    "The Nodum public REST API, interactive: every endpoint, schema and error — with a try-it client. Authenticate with an API key from Settings → API keys.",
  path: "/api-reference",
});

/** The interactive API reference (Scalar) over the public API's OpenAPI
 *  document. Public and unauthenticated, like the docs — trying a request
 *  needs an API key pasted into the Auth box. */
export default function ApiReferencePage() {
  return (
    <>
      <SiteNav />
      <ScalarClient />
    </>
  );
}
