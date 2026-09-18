import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

const storageKey = "theme";

type Theme = "auto" | "light" | "dark";

const readTheme = (): Theme => {
  try {
    const stored = localStorage.getItem(storageKey);
    return stored === "light" || stored === "dark" ? stored : "auto";
  } catch {
    return "auto";
  }
};

const options = [
  { value: "auto", label: "Auto", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
] as const;

export const ThemeToggle = () => {
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<Theme>();
  const [position, setPosition] = useState({ top: 56, right: 16 });

  useEffect(() => {
    setTheme(readTheme());
    const sync = () => {
      setTheme(readTheme());
    };
    const close = () => {
      popoverRef.current?.hidePopover();
    };
    window.addEventListener("storage", sync);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("resize", close);
    };
  }, []);

  useEffect(() => {
    if (theme === undefined) {
      return;
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.classList.toggle(
        "dark",
        theme === "dark" || (theme === "auto" && media.matches),
      );
    };
    apply();
    media.addEventListener("change", apply);
    return () => {
      media.removeEventListener("change", apply);
    };
  }, [theme]);

  const selectTheme = (value: Theme) => {
    setTheme(value);
    try {
      localStorage.setItem(storageKey, value);
    } catch {
      return;
    }
  };
  const Icon =
    options.find((option) => option.value === theme)?.Icon ?? Monitor;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        popoverTarget={id}
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          setPosition({
            top: bounds.bottom + 8,
            right: Math.max(16, window.innerWidth - bounds.right),
          });
        }}
        aria-label={`Color scheme: ${theme ?? "auto"}`}
        title={`Color scheme: ${theme ?? "auto"}`}
        className="flex size-11 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-surface hover:text-ink sm:size-10"
      >
        <Icon size={24} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <div
        id={id}
        ref={popoverRef}
        popover="auto"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            event.currentTarget.hidePopover();
            buttonRef.current?.focus();
          }
        }}
        style={position}
        className="fixed left-auto m-0 w-40 rounded-lg border border-line bg-surface-raised p-1.5 text-ink"
      >
        <fieldset>
          <legend className="sr-only">Color scheme</legend>
          {options.map(({ value, label, Icon: OptionIcon }) => (
            <label
              key={value}
              className="flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-sm hover:bg-surface has-checked:bg-accent-soft has-checked:text-accent"
            >
              <OptionIcon size={20} strokeWidth={1.75} aria-hidden="true" />
              <span className="flex-1">{label}</span>
              <input
                type="radio"
                name={id}
                value={value}
                checked={(theme ?? "auto") === value}
                onChange={() => {
                  selectTheme(value);
                }}
                onClick={() => {
                  popoverRef.current?.hidePopover();
                  buttonRef.current?.focus();
                }}
                className="size-3.5 accent-accent"
              />
            </label>
          ))}
        </fieldset>
      </div>
    </>
  );
};
