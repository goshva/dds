// Inventory of POST request bodies and GET query strings inside a HAR file.
const harPath = process.argv[2] ?? "har.har";
const har = JSON.parse(await Bun.file(harPath).text());
const entries: any[] = har.log.entries;

const rows: any[] = [];
for (const e of entries) {
  const u = new URL(e.request.url);
  const row: any = {
    method: e.request.method,
    path: u.pathname,
    status: e.response.status,
    durationMs: Math.round(e.time),
    startedDateTime: e.startedDateTime,
    query: Object.fromEntries(u.searchParams.entries()),
    postBytes: e.request.postData?.text?.length ?? 0,
  };
  if (e.request.postData?.text) {
    try {
      const j = JSON.parse(e.request.postData.text);
      row.postKeys = Array.isArray(j) ? `array[${j.length}]` : Object.keys(j).sort();
      row.postSample = JSON.stringify(j).slice(0, 900);
    } catch {
      row.postSample = e.request.postData.text.slice(0, 900);
    }
  }
  rows.push(row);
}
console.log(JSON.stringify(rows, null, 1));
