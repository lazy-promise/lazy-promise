import { useEffect, useRef, useState } from "react";

export interface TocHeading {
  depth: number;
  slug: string;
  text: string;
}

interface TocProps {
  headings: TocHeading[];
}

const readHeaderHeight = () =>
  parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(
      "--header-height",
    ),
  ) * parseFloat(getComputedStyle(document.documentElement).fontSize);

export const Toc = ({ headings }: TocProps) => {
  const [activeSlug, setActiveSlug] = useState<string | undefined>(
    headings[0]?.slug,
  );
  const listRef = useRef<HTMLUListElement>(null);
  const [marker, setMarker] = useState<{ top: number; height: number }>();

  useEffect(() => {
    const elements = headings
      .map((heading) => document.getElementById(heading.slug))
      .filter((element) => element !== null);
    if (elements.length === 0) {
      return;
    }

    let frame = 0;
    const update = () => {
      frame = 0;
      const threshold = readHeaderHeight() + 40;
      const atBottom =
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 2;
      if (atBottom) {
        setActiveSlug(elements[elements.length - 1]!.id);
        return;
      }
      let current = elements[0]!;
      for (const element of elements) {
        if (element.getBoundingClientRect().top - threshold <= 0) {
          current = element;
          continue;
        }
        break;
      }
      setActiveSlug(current.id);
    };
    const schedule = () => {
      if (frame !== 0) {
        return;
      }
      frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame !== 0) {
        cancelAnimationFrame(frame);
      }
    };
  }, [headings]);

  useEffect(() => {
    const list = listRef.current;
    if (list === null || activeSlug === undefined) {
      return;
    }
    const link = list.querySelector<HTMLAnchorElement>(
      `a[data-slug="${activeSlug}"]`,
    );
    if (link === null) {
      return;
    }
    const updateMarker = () => {
      setMarker({ top: link.offsetTop, height: link.offsetHeight });
    };
    updateMarker();
    const observer = new ResizeObserver(updateMarker);
    observer.observe(list);
    return () => {
      observer.disconnect();
    };
  }, [activeSlug]);

  return (
    <nav aria-label="On this page" className="text-sm leading-6">
      <p className="mb-3 pl-4 font-heading font-semibold text-ink">
        On this page
      </p>
      <div className="relative">
        <div
          aria-hidden="true"
          className="absolute top-0 bottom-0 left-0 w-px bg-line"
        />
        {marker && (
          <div
            aria-hidden="true"
            className="absolute left-0 w-px bg-accent transition-[top,height] duration-200 ease-out"
            style={{ top: marker.top, height: marker.height }}
          />
        )}
        <ul ref={listRef}>
          {headings.map((heading) => {
            const active = heading.slug === activeSlug;
            return (
              <li key={heading.slug}>
                <a
                  href={`#${heading.slug}`}
                  data-slug={heading.slug}
                  aria-current={active ? "location" : undefined}
                  className={[
                    "block rounded-r-md py-2.5 pr-3 leading-snug transition-colors hover:bg-surface",
                    heading.depth === 3 ? "pl-7" : "pl-4",
                    active
                      ? "font-heading font-semibold text-logo"
                      : "font-sans font-normal text-ink-muted hover:text-ink",
                  ].join(" ")}
                >
                  {heading.text}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
};
