// Timeline facts about a HAR: statuses, the async chart-data flow and error entries.
import { readFileSync } from "node:fs";

const har = JSON.parse(readFileSync(process.argv[2] ?? "har.har", "utf8"));
const entries: any[] = har.log.entries;

const rows = entries.map((e, i) => {
  const u = new URL(e.request.url);
  const c = e.response.content ?? {};
  let postSummary: string | null = null;
  if (e.request.postData?.text) {
    try {
      const j = JSON.parse(e.request.postData.text);
      postSummary = j?.datasource ? `datasource=${j.datasource.id}` : (j?.value ? "filter_state" : Object.keys(j).join(","));
    } catch { postSummary = "non-json"; }
  }
  return {
    i: i + 1,
    t: e.startedDateTime,
    ms: Math.round(e.time),
    method: e.request.method,
    path: u.pathname + (u.search ? "?" + u.search.slice(0, 80) : ""),
    status: e.response.status,
    statusText: e.response.statusText,
    respBytes: c.size,
    post: postSummary,
    reqHeadersOfInterest: Object.fromEntries(
      e.request.headers.filter((h: any) => /csrf|authorization|cookie|content-type/i.test(h.name)).map((h: any) => [h.name, h.value]),
    ),
  };
});

const non200 = rows.filter((r) => r.status !== 200);
const async202 = rows.filter((r) => r.status === 202);
const polling = rows.filter((r) => /\/api\/v1\/chart\/data\/qc-/.test(r.path));

console.log("total entries:", rows.length);
console.log("non-200 entries:");
for (const r of non200) console.log(JSON.stringify(r));
console.log("");
console.log("async 202 entries:", JSON.stringify(async202, null, 1));
console.log("");
console.log("polling entries:", JSON.stringify(polling, null, 1));
console.log("");
console.log("time span:", rows[0].t, "->", rows.at(-1)!.t);

await Bun.write("tools/har-timeline.json", JSON.stringify(rows, null, 1));
