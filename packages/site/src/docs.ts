import { getCollection } from "astro:content";

import type { NavItem } from "./components/MobileNav";
import { pathForEntry } from "./site";

const pageOrder = [
  "about",
  "installation",
  "basic-usage",
  "generator-syntax",
  "interop-with-native-promises",
  "type-safe-errors",
  "deferral-utilities",
  "logging-and-tracing",
  "dependency-injection",
  "async-context",
  "class-based-api",
  "qa",
];

export const getOrderedDocs = async () => {
  const entries = new Map(
    (await getCollection("docs")).map((entry) => [entry.id, entry]),
  );
  const ordered = pageOrder.map((id) => {
    const entry = entries.get(id);
    if (!entry) {
      throw new Error(`Unknown or duplicate documentation page: ${id}`);
    }
    entries.delete(id);
    return entry;
  });
  if (entries.size > 0) {
    throw new Error(
      `Add these pages to pageOrder: ${[...entries.keys()].join(", ")}`,
    );
  }
  return ordered;
};

export const toNavItems = (
  docs: Awaited<ReturnType<typeof getOrderedDocs>>,
  currentId: string | undefined,
): NavItem[] =>
  docs.map((doc) => ({
    href: pathForEntry(doc.id),
    title: doc.data.title,
    current: doc.id === currentId,
  }));
