import type { Metadata } from "next";

import { getCategories } from "@/lib/api/community-server";

import { NewTopicForm } from "./new-topic-form";

export const metadata: Metadata = { title: "New topic · Nodum Community", robots: { index: false } };

export default async function NewTopicPage() {
  const categories = (await getCategories()) ?? [];
  return <NewTopicForm categories={categories.map((c) => ({ slug: c.slug, name: c.name, staffOnly: c.is_staff_only_posting }))} />;
}
