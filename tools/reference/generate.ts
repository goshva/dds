/**
 * TPL-4.1: детерминированный генератор HTML reference pages.
 * Запуск: bun tools/reference/generate.ts
 * Не использует время, случайность, сеть, API, SQLite и JSONL.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { PAGES, type PageKey } from "./fixtures/common";
import { indexPageContent, pageContent } from "./render-page";
import { renderIndexDocument, renderDocument } from "./render-shell";

const OUTPUT_ROOT = "docs/ui/reference";
const CSS_PAGES = "../assets/reference.css";
const JS_PAGES = "../assets/reference.js";
const CSS_INDEX = "assets/reference.css";
const JS_INDEX = "assets/reference.js";

function write(path: string, content: string): { path: string; sha256: string } {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  const sha256 = new Bun.CryptoHasher("sha256").update(content).digest("hex");
  return { path, sha256 };
}

export function generateAll(): Array<{ path: string; sha256: string }> {
  const results: Array<{ path: string; sha256: string }> = [];

  const index = renderIndexDocument(indexPageContent(), CSS_INDEX, JS_INDEX);
  results.push(write(join(OUTPUT_ROOT, "index.html"), index));

  for (const page of PAGES) {
    const document = renderDocument({
      title: `DSS — эталон: ${page.title}`,
      cssHref: CSS_PAGES,
      jsHref: JS_PAGES,
      topbarTitle: page.topbarTitle,
      navCurrent: page.key as PageKey,
      content: pageContent(page.key),
    });
    results.push(write(join(OUTPUT_ROOT, "pages", page.file), document));
  }

  return results;
}

if (import.meta.main) {
  const results = generateAll();
  for (const item of results) console.log(`${item.sha256}  ${item.path}`);
  console.log(`### файлов: ${results.length}`);
}
