import type { Metadata } from "next";

import { SearchClient } from "./search-client";

export const metadata: Metadata = { title: "Search · Nodum Community", robots: { index: false } };

export default function CommunitySearchPage() {
  return <SearchClient />;
}
