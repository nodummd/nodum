import type { Thing } from "@/lib/seo/jsonld";

/**
 * Emits a JSON-LD block. Server-only by construction — it renders a script tag
 * into the initial HTML, which is the only version a crawler that does not run
 * JavaScript will ever see.
 *
 * `<` is escaped because JSON that contains `</script` would otherwise close
 * the tag early; every other character is safe inside a `application/ld+json`
 * block, which browsers never execute.
 */
export function JsonLd({ data }: { data: Thing | Thing[] }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
