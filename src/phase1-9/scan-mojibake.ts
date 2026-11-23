/**
 * Разовая проверка: поиск двойного кодирования кириллицы в файлах этапа 1.9-A.
 * Маркеры: последовательности вида "РЎ", "Рџ", "С‚", "вЂ" — признак UTF-8 → CP1251 → UTF-8.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const MARKERS = ["РЎ", "Рџ", "РЂ", "РЃ", "вЂ", "С‚", "СЂ", "СЃ", "С‡", "С€", "С‰", "СЋ", "СЏ", "СЊ", "С‹", "СЌ", "С„", "С…", "С†", "СЂ"];

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      if (name === "node_modules" || name === ".git") continue;
      walk(p, out);
    } else if (/\.(ts|json|md|sql|txt)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

const roots = process.argv.slice(2);
const files: string[] = [];
for (const r of roots) walk(r, files);

const hits: { file: string; count: number; sample: string }[] = [];
for (const f of files) {
  const text = readFileSync(f, "utf8");
  let count = 0;
  let sample = "";
  for (const m of MARKERS) {
    let idx = text.indexOf(m);
    while (idx !== -1) {
      count++;
      if (!sample) sample = text.slice(Math.max(0, idx - 40), idx + 40).replace(/\s+/g, " ");
      idx = text.indexOf(m, idx + m.length);
    }
  }
  if (count > 0) hits.push({ file: f, count, sample });
}

console.log(JSON.stringify({ scanned: files.length, hits: hits.length, files: hits }, null, 1));
