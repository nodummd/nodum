import { PublicSiteView } from "@/components/site/public-site";

export default async function SiteNotePage({
  params,
}: {
  params: Promise<{ slug: string; path: string[] }>;
}) {
  const { slug, path } = await params;
  return <PublicSiteView slug={slug} path={path.map(decodeURIComponent).join("/")} />;
}
