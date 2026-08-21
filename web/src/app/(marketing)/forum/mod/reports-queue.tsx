"use client";

/** The staff report queue. The server refuses non-staff with 403 — this page
 *  just mirrors that politely for anyone who wanders in. */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { communityApi } from "@/lib/api/endpoints";
import type { CommunityReportItem } from "@/lib/api/types";
import { useAuthStore } from "@/lib/stores/auth-store";

export function ReportsQueue() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const [tab, setTab] = useState<"open" | "resolved">("open");
  const [items, setItems] = useState<CommunityReportItem[] | null>(null);

  const load = useCallback(() => {
    void communityApi
      .listReports(tab)
      .then((data) => setItems(data.items))
      .catch(() => setItems([]));
  }, [tab]);

  useEffect(() => {
    if (status === "authenticated" && user?.is_staff) load();
  }, [status, user?.is_staff, load]);

  if (status === "loading") return <p className="opacity-60">Loading…</p>;
  if (!user?.is_staff) {
    return <p className="mk-card px-4 py-6 opacity-70">Staff only. Nothing to see here — honestly.</p>;
  }

  return (
    <section className="mx-auto max-w-3xl">
      <h2 className="mk-display mb-4 text-[1.5rem]">Reports</h2>
      <div className="mb-4 flex gap-2">
        {(["open", "resolved"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setTab(t);
              setItems(null);
            }}
            className={`mk-navlink capitalize ${tab === t ? "underline" : ""}`}
          >
            {t}
          </button>
        ))}
      </div>
      {items === null && <p className="opacity-60">Loading…</p>}
      {items?.length === 0 && <p className="mk-card px-4 py-6 opacity-70">Queue is empty. Good sign.</p>}
      <ul className="space-y-3">
        {(items ?? []).map((r) => (
          <li key={r.id} className="mk-card px-4 py-3" data-testid="report-row">
            <p className="text-[0.85rem]">
              <span className="mk-eyebrow mr-2">{r.reason}</span>
              <Link href={`/forum/t/${r.topic_id}/x#post-${r.post_number}`} className="font-medium hover:underline">
                {r.topic_title} #{r.post_number}
              </Link>
              <span className="ml-2 opacity-60">reported by {r.reporter ?? "a deleted user"}</span>
            </p>
            {r.detail && <p className="mt-1 text-[0.85rem] opacity-70">{r.detail}</p>}
            <p className="mt-1 text-[0.8rem] opacity-60">“{r.post_excerpt}”</p>
            {tab === "open" && (
              <button
                type="button"
                className="mk-btn mk-btn--primary mt-2 h-7 px-3 text-[0.78rem]"
                onClick={async () => {
                  await communityApi.resolveReport(r.id).catch(() => undefined);
                  load();
                }}
              >
                Resolve
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
