export const siteName = "LazyPromise";
export const siteDescription =
  "LazyPromise is a single-shot Observable, a lazy and cancelable promise, and a tiny alternative to Effect.";
export const githubUrl = "https://github.com/lazy-promise/lazy-promise";
export const xUrl = "https://x.com/ivan7237d";
export const playgroundUrl =
  "https://stackblitz.com/edit/lazy-promise?devToolsHeight=1000&file=index.ts";
export const npmPackage = "@lazy-promise/core";

// The `about` entry is served at `/`.
export const indexEntryId = "about";

export const pathForEntry = (id: string) =>
  id === indexEntryId ? "/" : `/${id}/`;
