// Compare dataset detail request shapes (browser HAR vs repository client).
import { readFileSync } from "node:fs";

const har = JSON.parse(readFileSync("har.har", "utf8"));
const seen = new Set<string>();
const rows: any[] = [];
for (const e of har.log.entries) {
  const u = new URL(e.request.url);
  const m = u.pathname.match(/^\/api\/v1\/dataset\/(\d+)$/);
  if (!m) continue;
  if (seen.has(u.pathname)) continue;
  seen.add(u.pathname);
  const q = u.searchParams.get("q");
  rows.push({
    path: u.pathname,
    hasQ: Boolean(q),
    q,
    accept: e.request.headers.find((h: any) => h.name === "accept")?.value ?? null,
    status: e.response.status,
    respBytes: e.response.content?.size,
    ms: Math.round(e.time),
  });
}

console.log("distinct dataset detail URLs in HAR:", rows.length);
console.log("with q parameter:", rows.filter((r) => r.hasQ).length);
console.log("sample:", JSON.stringify(rows.slice(0, 2), null, 1));
console.log("");
console.log("repository client request (src/phase1-6-2/sync.ts:332): GET /api/v1/dataset/${id}  -> no q parameter");
console.log("repository client request (src/phase1-6/client.ts:165): GET /api/v1/dataset/${id}  -> no q parameter");
console.log("");
console.log("HAR dataset detail response sizes (bytes):", rows.map((r) => r.respBytes).join(","));
console.log("total bytes for 38 dataset details:", rows.reduce((a, r) => a + (r.respBytes ?? 0), 0));
