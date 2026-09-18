import { useEffect, useRef, useState } from "react";

import { playgroundUrl } from "../site";
import { Backdrop } from "./Backdrop";
import { CloseIcon, ExternalIcon, MenuIcon } from "./icons";

export interface NavItem {
  href: string;
  title: string;
  current: boolean;
}

interface MobileNavProps {
  items: NavItem[];
}

export const MobileNav = ({ items }: MobileNavProps) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) {
      return;
    }
    if (open) {
      if (!dialog.open) {
        dialog.showModal();
      }
      return;
    }
    if (!dialog.open) {
      return;
    }
    // Let the slide-out animation finish before the dialog leaves the top layer.
    let reopened = false;
    dialog.dataset.closing = "";
    void Promise.allSettled(
      dialog.getAnimations().map((animation) => animation.finished),
    ).then(() => {
      if (reopened) {
        return;
      }
      delete dialog.dataset.closing;
      dialog.close();
    });
    return () => {
      reopened = true;
      delete dialog.dataset.closing;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        aria-label="Open navigation"
        title="Open navigation"
        className="flex size-11 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface hover:text-ink sm:size-10 lg:hidden"
      >
        <MenuIcon className="size-6" />
      </button>
      <Backdrop open={open} />
      <dialog
        ref={dialogRef}
        onClose={() => {
          setOpen(false);
        }}
        onCancel={(event) => {
          event.preventDefault();
          setOpen(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
          }
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            setOpen(false);
          }
        }}
        aria-label="Navigation"
        className="m-0 ml-auto h-dvh max-h-none w-72 max-w-[85vw] bg-canvas p-0 text-ink backdrop:bg-transparent motion-safe:animate-[nav-in_200ms_ease-out] motion-safe:data-closing:animate-[nav-out_200ms_ease-in_forwards]"
      >
        <div className="flex h-(--header-height) items-center justify-between border-b border-line px-4">
          <span className="font-heading text-sm font-semibold text-ink">
            Navigation
          </span>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
            }}
            aria-label="Close navigation"
            className="-mr-2 flex size-11 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface hover:text-ink"
          >
            <CloseIcon className="size-6" />
          </button>
        </div>
        <nav className="p-3 font-heading">
          <ul>
            {items.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  onClick={() => {
                    setOpen(false);
                  }}
                  aria-current={item.current ? "page" : undefined}
                  className={[
                    "block rounded-md px-3 py-2.5 text-base leading-6 transition-colors",
                    item.current
                      ? "font-bold text-logo"
                      : "text-ink-muted hover:bg-surface hover:text-ink",
                  ].join(" ")}
                >
                  {item.title}
                </a>
              </li>
            ))}
          </ul>
          <a
            href={playgroundUrl}
            target="_blank"
            rel="noopener"
            className="flex items-center gap-2 rounded-md px-3 py-2.5 text-base leading-6 text-ink-muted transition-colors hover:bg-surface hover:text-ink sm:hidden"
          >
            Playground
            <ExternalIcon className="size-4" />
          </a>
        </nav>
      </dialog>
    </>
  );
};
