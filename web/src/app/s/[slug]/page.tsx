import { PublicSiteView } from "@/components/site/public-site";

export default async function SiteIndexPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PublicSiteView slug={slug} path={null} />;
}
