import { useEffect, useState } from "react";

/**
 * Four pages, addressed by real URLs.
 *
 * No router library: `backend/src/server.ts` already serves `index.html`
 * for every path outside `/api/`, so a pushed path survives a refresh and
 * can be bookmarked with nothing added on either side. That fallback is the
 * whole reason this is thirty lines instead of a dependency — the same
 * trade the hand-rolled PDF writer, spreadsheet reader and ZIP reader make.
 *
 * The paths stay English while the interface switches language. A path that
 * changed with the language switch would break every link anyone saved.
 */
export const PAGES = ["form", "biometry", "statistics", "patients"] as const;

export type Page = (typeof PAGES)[number];

/** Where an unknown path lands. The biometry flow is the app's daily work. */
const DEFAULT_PAGE: Page = "biometry";

function pageFromPath(pathname: string): Page {
  const first = pathname.replace(/^\/+/, "").split("/")[0];
  return (PAGES as readonly string[]).includes(first) ? (first as Page) : DEFAULT_PAGE;
}

export function useRoute(): [Page, (page: Page) => void] {
  const [page, setPage] = useState<Page>(() =>
    typeof window === "undefined" ? DEFAULT_PAGE : pageFromPath(window.location.pathname),
  );

  // The back button has to work: someone who opens a patient from the list
  // and presses back expects the list, not the previous website.
  useEffect(() => {
    const onPop = () => setPage(pageFromPath(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function navigate(next: Page) {
    if (next === page) return;
    window.history.pushState(null, "", `/${next}`);
    setPage(next);
    // A tab change is a new screen, not a scroll position to preserve.
    window.scrollTo(0, 0);
  }

  return [page, navigate];
}
