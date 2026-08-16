"use client";

import { useEffect } from "react";

/**
 * Own the browser tab's title from a client component.
 *
 * `document.title = …` in a plain effect is not enough here: the App Router
 * applies the route's own metadata after this subtree's effects run, so on a
 * client-side navigation (signup → vault) the static title wins and the tab
 * ends up saying "Nodum" for every vault. Rendering a `<title>` element does not
 * help either — it lands *after* the metadata one in `<head>`, and the browser
 * uses the first.
 *
 * So watch `<head>` and re-assert. Setting the title mutates head, which fires
 * the observer again, but the guard makes that pass a no-op — no loop.
 */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    const apply = () => {
      if (document.title !== title) document.title = title;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [title]);
}
