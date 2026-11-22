// Extract selected HAR entries (request/response) to separate files for inspection.
// Usage: bun run tools/har-extract.ts <har> <outDir> [substringFilter]
import { mkdirSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const harPath = process.argv[2] ?? "har.har";
const outDir = process.argv[3] ?? "tools/har-out";
const filter = process.argv[4] ?? "";

mkdirSync(outDir, { recursive: true });
const har = JSON.parse(await Bun.file(harPath).text());
const entries: any[] = har.log.entries;

const manifest: any[] = [];
let i = 0;
for (const e of entries) {
  const url: string = e.request.url;
  if (filter && !url.includes(filter)) continue;
  i++;
  const path = new URL(url).pathname.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 60);
  const stem = `${String(i).padStart(3, "0")}_${e.request.method}_${path}`;

  const reqHeaders = Object.fromEntries(e.request.headers.map((h: any) => [h.name, h.value]));
  const respHeaders = Object.fromEntries(e.response.headers.map((h: any) => [h.name, h.value]));
  const redact = (h: Record<string, string>) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(h)) {
      out[k] = /^(cookie|set-cookie|authorization|x-csrftoken)$/i.test(k) ? `<REDACTED len=${v.length}>` : v;
    }
    return out;
  };

  let bodyText: string | undefined = e.response.content?.text;
  if (e.response.content?.encoding === "base64" && bodyText) {
    bodyText = Buffer.from(bodyText, "base64").toString("utf8");
  }
  let parsed: any = undefined;
  let shape: any = undefined;
  if (bodyText && /json/.test(e.response.content?.mimeType ?? "")) {
    try {
      parsed = JSON.parse(bodyText);
      shape = describe(parsed);
      writeFileSync(`${outDir}/${stem}.response.json`, JSON.stringify(parsed, null, 2), "utf8");
    } catch { /* keep raw */ }
  } else if (bodyText) {
    writeFileSync(`${outDir}/${stem}.response.txt`, bodyText, "utf8");
  }

  const reqBody = e.request.postData?.text;
  if (reqBody) {
    let reqParsed: any = undefined;
    try { reqParsed = JSON.parse(reqBody); } catch { /* raw */ }
    writeFileSync(
      `${outDir}/${stem}.request.json`,
      reqParsed ? JSON.stringify(reqParsed, null, 2) : reqBody,
      "utf8",
    );
  }

  manifest.push({
    n: i,
    method: e.request.method,
    url,
    startedDateTime: e.startedDateTime,
    durationMs: e.time,
    status: e.response.status,
    mimeType: e.response.content?.mimeType,
    responseBytes: e.response.content?.size,
    requestHeaders: redact(reqHeaders),
    responseHeaders: redact(respHeaders),
    hasRequestBody: Boolean(reqBody),
    responseShape: shape,
    files: {
      request: reqBody ? `${stem}.request.json` : null,
      response: bodyText ? `${stem}.response.${/json/.test(e.response.content?.mimeType ?? "") ? "json" : "txt"}` : null,
    },
  });
}

function describe(v: any, depth = 0): any {
  if (depth > 2) return typeof v;
  if (Array.isArray(v)) return { type: "array", length: v.length, item: v.length ? describe(v[0], depth + 1) : null };
  if (v && typeof v === "object") {
    const o: any = {};
    for (const [k, val] of Object.entries(v)) o[k] = describe(val, depth + 1);
    return o;
  }
  return typeof v;
}

writeFileSync(`${outDir}/manifest.json`, JSON.stringify(manifest, null, 2), "utf8");
console.log(`extracted ${manifest.length} entries -> ${outDir} (${basename(outDir)})`);
