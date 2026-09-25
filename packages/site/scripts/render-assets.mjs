// Renders assets/*.html into PNGs. The icons go to public/; og.png stays in
// assets/ because DocsLayout imports it to get a content-hashed URL.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const assetsDir = new URL("../assets/", import.meta.url);
const publicDir = new URL("../public/", import.meta.url);

const jobs = [
  {
    source: "og.html",
    target: "og.png",
    targetDir: assetsDir,
    width: 1200,
    height: 630,
  },
  { source: "icon.html?size=512", target: "icon-512.png", size: 512 },
  { source: "icon.html?size=192", target: "icon-192.png", size: 192 },
  {
    source: "icon.html?size=180&square=1",
    target: "apple-touch-icon.png",
    size: 180,
  },
];

const faviconSizes = [32, 16];

// ICO container with PNG-encoded entries (supported by all current browsers).
function buildIco(pngs) {
  const headerSize = 6 + 16 * pngs.length;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = headerSize;
  pngs.forEach(({ size, data }, index) => {
    const entry = 6 + 16 * index;
    header.writeUInt8(size, entry);
    header.writeUInt8(size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map(({ data }) => data)]);
}

const browser = await chromium.launch({ channel: "chrome" });
try {
  for (const job of jobs) {
    const width = job.width ?? job.size;
    const height = job.height ?? job.size;
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 1,
    });
    await page.goto(new URL(job.source, assetsDir).href);
    await page.evaluate(() => document.fonts.ready);
    const target = fileURLToPath(
      new URL(job.target, job.targetDir ?? publicDir),
    );
    await page.screenshot({
      path: target,
      omitBackground: job.size !== undefined,
    });
    await page.close();
    console.log(`${job.source} -> public/${job.target} (${width}x${height})`);
  }

  const faviconPngs = [];
  for (const size of faviconSizes) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    await page.goto(new URL(`icon.html?size=${size}`, assetsDir).href);
    const data = await page.screenshot({ omitBackground: true });
    await page.close();
    faviconPngs.push({ size, data });
  }
  writeFileSync(
    fileURLToPath(new URL("favicon.ico", publicDir)),
    buildIco(faviconPngs),
  );
  console.log(`icon.html -> public/favicon.ico (${faviconSizes.join(", ")})`);
} finally {
  await browser.close();
}
