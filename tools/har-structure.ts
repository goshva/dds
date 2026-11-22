// Deep structural audit of a HAR file: keys used, content availability, request bodies.
const harPath = process.argv[2] ?? "har.har";
const har = JSON.parse(await Bun.file(harPath).text());
const entries: any[] = har.log.entries;

const logKeys = Object.keys(har.log);
const entryKeys = new Set<string>();
const requestKeys = new Set<string>();
const responseKeys = new Set<string>();
const contentKeys = new Set<string>();
const postDataKeys = new Set<string>();
const cookieNames = new Set<string>();
const requestHeaderNames = new Set<string>();
const responseHeaderNames = new Set<string>();
const authHeaderValues = new Set<string>();

let postDataCount = 0;
let postDataBytes = 0;

for (const e of entries) {
  for (const k of Object.keys(e)) entryKeys.add(k);
  for (const k of Object.keys(e.request ?? {})) requestKeys.add(k);
  for (const k of Object.keys(e.response ?? {})) responseKeys.add(k);
  for (const k of Object.keys(e.response?.content ?? {})) contentKeys.add(k);
  for (const h of e.request?.headers ?? []) {
    requestHeaderNames.add(h.name);
    if (/^(authorization|x-csrftoken|cookie)$/i.test(h.name)) authHeaderValues.add(`${h.name}=${h.value.slice(0, 24)}…(len ${h.value.length})`);
  }
  for (const h of e.response?.headers ?? []) responseHeaderNames.add(h.name);
  for (const c of e.request?.cookies ?? []) cookieNames.add(c.name);
  for (const c of e.response?.cookies ?? []) cookieNames.add(`resp:${c.name}`);
  if (e.request?.postData) {
    postDataCount++;
    const t = e.request.postData.text ?? "";
    postDataBytes += t.length;
    for (const k of Object.keys(e.request.postData)) postDataKeys.add(k);
  }
}

console.log(JSON.stringify({
  logKeys,
  entryKeys: [...entryKeys],
  requestKeys: [...requestKeys],
  responseKeys: [...responseKeys],
  contentKeys: [...contentKeys],
  postDataKeys: [...postDataKeys],
  requestHeaderNames: [...requestHeaderNames].sort(),
  responseHeaderNames: [...responseHeaderNames].sort(),
  cookieNames: [...cookieNames].sort(),
  authHeaderValues: [...authHeaderValues],
  postDataCount,
  postDataBytes,
  pagesCount: har.log.pages?.length ?? 0,
  firstEntryStarted: entries[0]?.startedDateTime,
  lastEntryStarted: entries.at(-1)?.startedDateTime,
}, null, 1));
