import { useEffect, useId, useRef, useState } from "react";

import { Backdrop } from "./Backdrop";
import { CloseIcon, FileIcon, HashIcon, SearchIcon } from "./icons";

interface PagefindSubResult {
  title: string;
  url: string;
  excerpt: string;
}

interface PagefindResultData {
  url: string;
  excerpt: string;
  meta: { title?: string };
  sub_results: PagefindSubResult[];
}

interface PagefindResult {
  id: string;
  data: () => Promise<PagefindResultData>;
}

interface Pagefind {
  init: () => Promise<void>;
  preload: (term: string) => Promise<void>;
  debouncedSearch: (
    term: string,
    options?: Record<string, unknown>,
    debounceTimeoutMs?: number,
  ) => Promise<{ results: PagefindResult[] } | null>;
}

interface SearchGroup {
  pageTitle: string;
  pageUrl: string;
  hits: {
    title: string;
    url: string;
    excerpt: string;
    isPage: boolean;
  }[];
}

const pagefindPath = "/pagefind/pagefind.js";
const maxPages = 8;
const maxHitsPerPage = 4;

let pagefindPromise: Promise<Pagefind> | undefined;

const loadPagefind = () => {
  pagefindPromise ??= (
    import(/* @vite-ignore */ pagefindPath) as Promise<Pagefind>
  )
    .then(async (pagefind) => {
      await pagefind.init();
      return pagefind;
    })
    .catch((error: unknown) => {
      pagefindPromise = undefined;
      throw error;
    });
  return pagefindPromise;
};

const toGroups = (pages: PagefindResultData[]): SearchGroup[] =>
  pages.map((page) => {
    const pageTitle = page.meta.title ?? page.url;
    const hits = page.sub_results.slice(0, maxHitsPerPage).map((hit) => {
      const isPage = !hit.url.includes("#");
      return {
        // Pagefind includes the heading's anchor link ("#") in the title.
        title: isPage ? pageTitle : hit.title.replace(/\u2060?#$/, ""),
        url: hit.url,
        excerpt: hit.excerpt,
        isPage,
      };
    });
    return { pageTitle, pageUrl: page.url, hits };
  });

const isApplePlatform = () =>
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.userAgent);

export const Search = () => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [selected, setSelected] = useState(0);
  const [status, setStatus] = useState<"idle" | "searching" | "unavailable">(
    "idle",
  );
  const [modifierLabel, setModifierLabel] = useState("Ctrl");

  useEffect(() => {
    if (isApplePlatform()) {
      setModifierLabel("⌘");
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
      inputRef.current?.select();
      void loadPagefind().catch(() => {
        setStatus("unavailable");
      });
      return;
    }
    if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const term = query.trim();
    if (term === "") {
      setGroups([]);
      setSelected(0);
      setStatus((value) => (value === "unavailable" ? value : "idle"));
      return;
    }
    setStatus((value) => (value === "unavailable" ? value : "searching"));
    const controller = new AbortController();
    const { signal } = controller;
    void (async () => {
      try {
        const pagefind = await loadPagefind();
        const search = await pagefind.debouncedSearch(term, {}, 150);
        signal.throwIfAborted();
        if (search === null) {
          return;
        }
        const pages = await Promise.all(
          search.results.slice(0, maxPages).map((result) => result.data()),
        );
        signal.throwIfAborted();
        setGroups(toGroups(pages));
        setSelected(0);
        setStatus("idle");
      } catch {
        if (signal.aborted) {
          return;
        }
        setStatus("unavailable");
      }
    })();
    return () => {
      controller.abort();
    };
  }, [open, query]);

  const flatHits = groups.flatMap((group) => group.hits);

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected((value) =>
        Math.max(0, Math.min(value + 1, flatHits.length - 1)),
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected((value) => Math.max(value - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      const hit = flatHits[selected];
      if (hit === undefined) {
        return;
      }
      event.preventDefault();
      setOpen(false);
      window.location.href = hit.url;
    }
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) {
      return;
    }
    const option = dialog.querySelector<HTMLElement>(
      `[data-index="${selected}"]`,
    );
    option?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  let flatIndex = -1;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        aria-label="Search"
        title="Search"
        className="flex size-11 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface hover:text-ink sm:size-10 lg:hidden"
      >
        <SearchIcon className="size-6" />
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        className="hidden h-10 w-[min(45rem,calc(100vw-42rem))] items-center gap-2.5 rounded-md border border-line bg-surface/60 pr-2 pl-3 text-ink-muted transition-colors hover:border-line-strong hover:text-ink lg:flex"
      >
        <SearchIcon className="size-5" />
        <span className="flex-1 text-left">Search</span>
        <kbd className="shrink-0 rounded border border-line px-1.5 py-0.5 font-sans text-sm leading-4 text-ink-faint">
          {modifierLabel} K
        </kbd>
      </button>
      <Backdrop open={open} />
      <dialog
        ref={dialogRef}
        onClose={() => {
          setOpen(false);
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            setOpen(false);
          }
        }}
        aria-label="Search the docs"
        className="mx-auto mt-[12vh] w-[min(40rem,calc(100vw-2rem))] rounded-lg border border-line bg-surface-raised p-0 text-ink backdrop:bg-transparent dark:bg-surface"
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <SearchIcon className="size-5 shrink-0 text-ink-faint" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            onKeyDown={handleInputKeyDown}
            placeholder="Search the docs"
            autoComplete="off"
            spellCheck={false}
            role="combobox"
            aria-expanded={flatHits.length > 0}
            aria-controls={listboxId}
            aria-activedescendant={
              flatHits.length > 0 ? `${listboxId}-${selected}` : undefined
            }
            className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-ink-faint [&::-webkit-search-cancel-button]:hidden"
          />
          <button
            type="button"
            aria-label="Close search"
            title="Close search"
            onClick={() => {
              setOpen(false);
            }}
            className="flex size-11 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-surface hover:text-ink dark:hover:bg-surface-raised"
          >
            <CloseIcon className="size-5" />
          </button>
        </div>
        <div className="max-h-[min(24rem,60vh)] overflow-y-auto p-2">
          {status === "unavailable" && (
            <p className="px-3 py-8 text-center text-sm text-ink-muted">
              Search could not load. Please try again.
            </p>
          )}
          {status !== "unavailable" &&
            query.trim() !== "" &&
            flatHits.length === 0 &&
            status === "idle" && (
              <p className="px-3 py-8 text-center text-sm text-ink-muted">
                No results for “{query.trim()}”.
              </p>
            )}
          {flatHits.length > 0 && (
            <ul id={listboxId} role="listbox">
              {groups.map((group) => (
                <li key={group.pageUrl} role="presentation" className="mb-1">
                  <p className="px-3 pt-2 pb-1 font-heading text-[0.6875rem] font-semibold tracking-wide text-ink-faint uppercase">
                    {group.pageTitle}
                  </p>
                  <ul role="presentation">
                    {group.hits.map((hit) => {
                      flatIndex += 1;
                      const index = flatIndex;
                      const active = index === selected;
                      return (
                        <li
                          key={hit.url}
                          id={`${listboxId}-${index}`}
                          role="option"
                          aria-selected={active}
                          data-index={index}
                        >
                          <a
                            href={hit.url}
                            onClick={() => {
                              setOpen(false);
                            }}
                            onMouseMove={() => {
                              if (selected !== index) {
                                setSelected(index);
                              }
                            }}
                            className={[
                              "flex gap-3 rounded-lg px-3 py-2.5 transition-colors",
                              active ? "bg-surface dark:bg-surface-raised" : "",
                            ].join(" ")}
                          >
                            {hit.isPage ? (
                              <FileIcon
                                className={[
                                  "mt-0.5 size-4 shrink-0",
                                  active ? "text-accent" : "text-ink-faint",
                                ].join(" ")}
                              />
                            ) : (
                              <HashIcon
                                className={[
                                  "mt-0.5 size-4 shrink-0",
                                  active ? "text-accent" : "text-ink-faint",
                                ].join(" ")}
                              />
                            )}
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-heading text-sm font-semibold text-ink">
                                {hit.title}
                              </span>
                              <span
                                className="mt-0.5 line-clamp-2 block text-[0.8125rem] leading-5 text-ink-muted"
                                dangerouslySetInnerHTML={{
                                  __html: hit.excerpt,
                                }}
                              />
                            </span>
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      </dialog>
    </>
  );
};
