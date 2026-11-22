// Inventory of a HAR file: what content is actually stored per entry.
const harPath = process.argv[2] ?? "har.har";
const har = JSON.parse(await Bun.file(harPath).text());
const entries: any[] = har.log.entries;
let withText = 0;
const rows: any[] = [];
for (const e of entries) {
  const c = e.response.content ?? {};
  const hasText = typeof c.text === "string" && c.text.length > 0;
  if (hasText) withText++;
  rows.push({
    url: new URL(e.request.url).pathname,
    status: e.response.status,
    size: c.size,
    mime: c.mimeType,
    encoding: c.encoding ?? null,
    hasText,
    textLen: hasText ? c.text.length : 0,
    comment: c.comment ?? null,
  });
}
console.log("entries", entries.length, "withText", withText);
console.log(JSON.stringify(rows, null, 1));
