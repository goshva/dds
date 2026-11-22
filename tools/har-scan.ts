// HAR inventory scanner: extracts every HTTP transaction from a HAR 1.2 log
// and reports method, URL, status, mime type, body sizes and JSON top-level shape.
import { writeFileSync } from "node:fs";

type Entry = {
  startedDateTime: string;
  time: number;
  request: { method: string; url: string; headers: { name: string; value: string }[]; postData?: { mimeType?: string; text?: string } };
  response: {
    status: number;
    statusText: string;
    headers: { name: string; value: string }[];
    content: { size: number; mimeType: string; text?: string; encoding?: string };
    redirectURL?: string;
  };
  _resourceType?: string;
};

const harPath = process.argv[2] ?? "har.har";
const outPath = process.argv[3] ?? "tools/har-inventory.json";

const raw = await Bun.file(harPath).text();
const har = JSON.parse(raw) as { log: { version: string; creator: any; pages: any[]; entries: Entry[] } };
const entries = har.log.entries;

function hostOf(u: string): string {
  try { return new URL(u).host; } catch { return "<invalid>"; }
}
function pathOf(u: string): string {
  try { const x = new URL(u); return x.pathname; } catch { return u; }
}
function queryKeys(u: string): string[] {
  try { return [...new URL(u).searchParams.keys()].sort(); } catch { return []; }
}

const groups = new Map<string, {
  method: string; pathTemplate: string; host: string;
  count: number; statuses: Record<string, number>; mime: Record<string, number>;
  queryKeys: Set<string>; totalBodyBytes: number; maxBodyBytes: number;
  sampleUrls: string[]; firstSeen: string; lastSeen: string;
}>();

for (const e of entries) {
  const u = e.request.url;
  const host = hostOf(u);
  const p = pathOf(u);
  // collapse numeric / uuid path segments into placeholders
  const template = p.replace(/\/\d+(?=\/|$)/g, "/{id}").replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}(?=\/|$)/gi, "/{uuid}");
  const key = `${e.request.method} ${host}${template}`;
  let g = groups.get(key);
  if (!g) {
    g = { method: e.request.method, pathTemplate: template, host, count: 0, statuses: {}, mime: {}, queryKeys: new Set(), totalBodyBytes: 0, maxBodyBytes: 0, sampleUrls: [], firstSeen: e.startedDateTime, lastSeen: e.startedDateTime };
    groups.set(key, g);
  }
  g.count++;
  g.statuses[String(e.response.status)] = (g.statuses[String(e.response.status)] ?? 0) + 1;
  const mime = (e.response.content?.mimeType ?? "").split(";")[0];
  g.mime[mime] = (g.mime[mime] ?? 0) + 1;
  for (const k of queryKeys(u)) g.queryKeys.add(k);
  const size = e.response.content?.size ?? 0;
  g.totalBodyBytes += size;
  g.maxBodyBytes = Math.max(g.maxBodyBytes, size);
  if (g.sampleUrls.length < 3) g.sampleUrls.push(u);
  if (e.startedDateTime < g.firstSeen) g.firstSeen = e.startedDateTime;
  if (e.startedDateTime > g.lastSeen) g.lastSeen = e.startedDateTime;
}

const summary = [...groups.values()]
  .map((g) => ({
    method: g.method,
    host: g.host,
    path: g.pathTemplate,
    count: g.count,
    statuses: g.statuses,
    mime: g.mime,
    queryKeys: [...g.queryKeys],
    totalBodyBytes: g.totalBodyBytes,
    maxBodyBytes: g.maxBodyBytes,
    firstSeen: g.firstSeen,
    lastSeen: g.lastSeen,
    sampleUrls: g.sampleUrls,
  }))
  .sort((a, b) => b.count - a.count);

const pageTitles = har.log.pages.map((p: any) => ({ id: p.id, title: p.title, startedDateTime: p.startedDateTime }));

const statusTotals: Record<string, number> = {};
const methodTotals: Record<string, number> = {};
const resourceTypes: Record<string, number> = {};
for (const e of entries) {
  statusTotals[String(e.response.status)] = (statusTotals[String(e.response.status)] ?? 0) + 1;
  methodTotals[e.request.method] = (methodTotals[e.request.method] ?? 0) + 1;
  const rt = e._resourceType ?? "unknown";
  resourceTypes[rt] = (resourceTypes[rt] ?? 0) + 1;
}

const out = {
  generatedAt: new Date().toISOString(),
  harVersion: har.log.version,
  creator: har.log.creator,
  pages: pageTitles,
  entryCount: entries.length,
  timeRange: entries.length
    ? { first: entries.map((e) => e.startedDateTime).sort()[0], last: entries.map((e) => e.startedDateTime).sort().slice(-1)[0] }
    : null,
  statusTotals,
  methodTotals,
  resourceTypes,
  groups: summary,
};

writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
console.log(`entries=${entries.length} groups=${summary.length} -> ${outPath}`);
