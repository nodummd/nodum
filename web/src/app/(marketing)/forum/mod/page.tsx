import type { Metadata } from "next";

import { ReportsQueue } from "./reports-queue";

export const metadata: Metadata = { title: "Reports · Nodum Community", robots: { index: false } };

export default function ModPage() {
  return <ReportsQueue />;
}
