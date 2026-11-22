// Evidence scan: does the HAR carry credentials, cookies or response bodies?
import { readFileSync } from "node:fs";

const raw = readFileSync(process.argv[2] ?? "har.har", "utf8");
const har = JSON.parse(raw);
const entries: any[] = har.log.entries;

const patterns: Record<string, RegExp> = {
  authorization_header: /"name"\s*:\s*"authorization"/i,
  cookie_header: /"name"\s*:\s*"cookie"/i,
  set_cookie: /"name"\s*:\s*"set-cookie"/i,
  bearer_literal: /Bearer\s+[A-Za-z0-9._-]{10,}/,
  jwt_like: /eyJ[A-Za-z0-9_-]{10,}\./,
  csrf_header: /"name"\s*:\s*"x-csrftoken"/i,
  response_content_text: /"content"\s*:\s*\{[^{}]*"text"/,
  result_array: /"result"\s*:\s*\[/,
  session_cookie: /session=[A-Za-z0-9._-]{8,}/,
};

const findings: Record<string, number> = {};
for (const [k, re] of Object.entries(patterns)) {
  findings[k] = (raw.match(new RegExp(re.source, "gi")) ?? []).length;
}

// cookies arrays per entry
let entriesWithRequestCookies = 0;
let entriesWithResponseCookies = 0;
let totalRequestCookies = 0;
let totalResponseCookies = 0;
for (const e of entries) {
  if (Array.isArray(e.request?.cookies) && e.request.cookies.length) {
    entriesWithRequestCookies++;
    totalRequestCookies += e.request.cookies.length;
  }
  if (Array.isArray(e.response?.cookies) && e.response.cookies.length) {
    entriesWithResponseCookies++;
    totalResponseCookies += e.response.cookies.length;
  }
}

// response body presence per entry, with detail
const bodyKinds: Record<string, number> = {};
for (const e of entries) {
  const c = e.response?.content ?? {};
  const hasText = typeof c.text === "string" && c.text.length > 0;
  const kind = `${hasText ? "text" : "no-text"}/${c.mimeType ?? "?"}`;
  bodyKinds[kind] = (bodyKinds[kind] ?? 0) + 1;
}

// what response metadata is still available
const sizeSamples = entries.slice(0, 5).map((e) => ({
  url: new URL(e.request.url).pathname,
  status: e.response.status,
  contentSize: e.response.content?.size,
  bodySize: e.response.bodySize,
  transferSize: e.response._transferSize,
  mimeType: e.response.content?.mimeType,
  contentKeys: Object.keys(e.response.content ?? {}),
}));

console.log(JSON.stringify({
  rawBytes: raw.length,
  findings,
  cookies: { entriesWithRequestCookies, entriesWithResponseCookies, totalRequestCookies, totalResponseCookies },
  bodyKinds,
  sizeSamples,
}, null, 1));
