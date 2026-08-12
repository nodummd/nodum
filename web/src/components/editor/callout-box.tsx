"use client";

/** Rendered Obsidian callout — icon, title, fold chevron, tinted body. */

import { ChevronRight } from "lucide-react";
import { useState } from "react";

import { calloutDefaultTitle, calloutType } from "@/lib/editor/callouts";
import { cn } from "@/lib/utils";

interface CalloutBoxProps {
  calloutType?: string;
  calloutTitle?: string;
  calloutFold?: string;
  children?: React.ReactNode;
}

export function CalloutBox({
  calloutType: rawType = "note",
  calloutTitle = "",
  calloutFold = "",
  children,
}: CalloutBoxProps) {
  const type = calloutType(rawType);
  const foldable = calloutFold === "+" || calloutFold === "-";
  const [open, setOpen] = useState(calloutFold !== "-");
  const title = calloutTitle || calloutDefaultTitle(type.name);

  return (
    <div
      data-callout={rawType.toLowerCase()}
      className="nodum-callout"
      style={{ "--callout-color": type.color } as React.CSSProperties}
    >
      <button
        type="button"
        disabled={!foldable}
        onClick={() => foldable && setOpen((o) => !o)}
        className={cn("nodum-callout-title", foldable && "cursor-pointer")}
        aria-expanded={foldable ? open : undefined}
      >
        <CalloutIcon rawType={rawType} />
        <span>{title}</span>
        {foldable && (
          <ChevronRight
            className={cn("size-4 transition-transform duration-150", open && "rotate-90")}
            strokeWidth={2}
          />
        )}
      </button>
      {open && children != null && <div className="nodum-callout-content">{children}</div>}
    </div>
  );
}

function CalloutIcon({ rawType }: { rawType: string }) {
  const type = calloutType(rawType);
  // lucide vanilla IconNode → JSX
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {type.icon.map(([tag, attrs], i) => {
        const Tag = tag as keyof React.JSX.IntrinsicElements;
        return <Tag key={i} {...(attrs as Record<string, string>)} />;
      })}
    </svg>
  );
}
