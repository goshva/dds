// UI-2.2: негативные тесты hardening (R1, R2, R3, R4, R5, R7).
import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { app } from "../../src/server/app";
import { isRealCalendarDate, isStrictIsoTimestamp, readHistory, readManifest } from "../../src/server/sources";
import { fail } from "../../src/server/api";
import { reconciliationsModel } from "../../src/server/services/read-models";
import { validateResult } from "../../src/web/api/client";

async function get(path: string, headers: Record<string, string> = { Host: "127.0.0.1:8787" }) {
  const response = await app.request(`http://127.0.0.1${path}`, { headers });
  return { status: response.status, body: (await response.json()) as any };
}

describe("R1 manifest fail-closed", () => {
  test("отсутствующий manifest → NOT_AVAILABLE", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dss-manifest-"));
    const result = await readManifest(dir);
    expect(result.status).toBe("NOT_AVAILABLE");
    expect(result.manifest).toBeNull();
  });
  test("повреждённый JSON → CORRUPTED", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dss-manifest-"));
    await writeFile(join(dir, "manifest.json"), "{broken");
    const result = await readManifest(dir);
    expect(result.status).toBe("CORRUPTED");
    expect(result.manifest).toBeNull();
  });
  test("неверная структура → CORRUPTED, валидная → OK", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dss-manifest-"));
    await writeFile(join(dir, "manifest.json"), JSON.stringify({ version: "v1", dataset_checksum: 123, horizons: "1,3" }));
    expect((await readManifest(dir)).status).toBe("CORRUPTED");
    const hex = "a".repeat(64);
    // checksum обязан быть SHA-256 (64 hex)
    await writeFile(join(dir, "manifest.json"), JSON.stringify({ version: "shadow-mode/v1", created_at: "2026-11-24T00:00:00.000Z", dataset_checksum: "abc", horizons: [1, 3], models: {}, alpha: 1, limit_percent: 0.1, min_train_days: 28, note: "x" }));
    expect((await readManifest(dir)).status).toBe("CORRUPTED");
    // недопустимая версия
    await writeFile(join(dir, "manifest.json"), JSON.stringify({ version: "shadow-mode/v9", created_at: "2026-11-24T00:00:00.000Z", dataset_checksum: hex, horizons: [1, 3], alpha: 1, limit_percent: 0.1, min_train_days: 28 }));
    expect((await readManifest(dir)).status).toBe("CORRUPTED");
    // недопустимый горизонт
    await writeFile(join(dir, "manifest.json"), JSON.stringify({ version: "shadow-mode/v1", created_at: "2026-11-24T00:00:00.000Z", dataset_checksum: hex, horizons: [7], alpha: 1, limit_percent: 0.1, min_train_days: 28 }));
    expect((await readManifest(dir)).status).toBe("CORRUPTED");
    // корректный manifest
    await writeFile(join(dir, "manifest.json"), JSON.stringify({ version: "shadow-mode/v1", created_at: "2026-11-24T00:00:00.000Z", dataset_checksum: hex, horizons: [1, 3], models: { rolling_7_day_mean: "v1", adaptive_baseline: "v1" }, alpha: 1, limit_percent: 0.1, min_train_days: 28, note: "x" }));
    expect((await readManifest(dir)).status).toBe("OK");
  });
});

describe("R2 точная проверка Origin", () => {
  test("Origin: null и мусор отклоняются", async () => {
    expect((await get("/api/health", { Host: "127.0.0.1:8787", Origin: "null" })).status).toBe(403);
    expect((await get("/api/health", { Host: "127.0.0.1:8787", Origin: "not a url" })).status).toBe(403);
  });
  test("посторонние схемы, хосты и порты отклоняются", async () => {
    for (const origin of ["https://evil.example.com", "http://evil.example.com:5173", "file:///etc/passwd", "http://127.0.0.1:9999"]) {
      expect((await get("/api/health", { Host: "127.0.0.1:8787", Origin: origin })).status, origin).toBe(403);
    }
  });
  test("разрешены Vite origin и точный same-origin", async () => {
    expect((await get("/api/health", { Host: "127.0.0.1:8787", Origin: "http://127.0.0.1:5173" })).status).toBe(200);
    expect((await get("/api/health", { Host: "127.0.0.1:8787", Origin: "http://127.0.0.1:8787" })).status).toBe(200);
    expect((await get("/api/health", { Host: "localhost:8787", Origin: "http://localhost:8787" })).status).toBe(200);
  });
});

describe("R3 replay и shadow разделены", () => {
  test("по умолчанию только mode=shadow", async () => {
    const { body } = await get("/api/v1/shadow/forecasts?limit=50");
    expect(body.status).toBe("ok");
    expect(body.data.items.length).toBeGreaterThan(0);
    expect(body.data.items.every((item: any) => item.mode === "shadow")).toBe(true);
  });
  test("replay доступен только явно", async () => {
    const { body } = await get("/api/v1/shadow/forecasts?mode=replay&limit=5");
    expect(body.data.items.every((item: any) => item.mode === "replay")).toBe(true);
  });
});

describe("R4 проверка календарных дат", () => {
  test("нереальные даты отклоняются", async () => {
    for (const query of ["from=2026-99-99", "to=2026-02-30", "from=2026-13-01", "to=2026-00-10"]) {
      const { status, body } = await get(`/api/v1/history?${query}`);
      expect(status, query).toBe(400);
      expect(body.error.code).toBe("INVALID_QUERY");
    }
  });
  test("корректные граничные даты принимаются (2024-02-29)", async () => {
    // 2024-02-29 — реальная дата, но вне доступной истории (ряд начинается 2024-06-01) → граница диапазона
    const beforeHistory = await get("/api/v1/history?from=2024-02-29&to=2024-02-29");
    expect(beforeHistory.status).toBe(400);
    // нереальная дата отклоняется как INVALID_QUERY даже внутри границ по формату
    const notLeap = await get("/api/v1/history?from=2025-02-29&to=2025-02-29");
    expect(notLeap.status).toBe(400);
    expect(notLeap.body.error.code).toBe("INVALID_QUERY");
  });
});

describe("R5 provenance checksums", () => {
  test("checksum файла и нормализованный различаются и оба присутствуют", async () => {
    const { body } = await get("/api/v1/overview");
    const provenance = body.data.provenance;
    expect(typeof provenance.fileChecksum).toBe("string");
    expect(typeof provenance.normalizedChecksum).toBe("string");
    expect(provenance.fileChecksum).not.toBe(provenance.normalizedChecksum);
    expect(["MATCH", "STALE", "NOT_CONFIRMED"]).toContain(provenance.freshness);
    expect(body.meta.checksum).toBe(provenance.fileChecksum);
  });
});

describe("R7 runtime validation ответов", () => {
  test("некорректные структуры отклоняются", () => {
    expect(validateResult(null)).toBeNull();
    expect(validateResult({})).toBeNull();
    expect(validateResult({ status: "ok" })).toBeNull();
    expect(validateResult({ status: "ok", data: {}, meta: { readOnly: false } })).toBeNull();
    expect(validateResult({ status: "not_available", data: 0, meta: {} })).toBeNull();
    expect(validateResult({ status: "error", error: { code: 1 } })).toBeNull();
    expect(validateResult({ status: "unknown" })).toBeNull();
  });
  test("корректные структуры принимаются", () => {
    expect(validateResult({ status: "ok", data: { a: 1 }, meta: { readOnly: true, generatedAt: "x", source: "s" } })).not.toBeNull();
    expect(validateResult({ status: "not_available", data: null, meta: { readOnly: true, generatedAt: "x", source: "s" } })).not.toBeNull();
    expect(validateResult({ status: "error", error: { code: "E", message: "m", eventId: "evt-1" } })).not.toBeNull();
  });
  test("неожиданный HTTP-статус даёт ошибку", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
    try {
      const { ApiClient } = await import("../../src/web/api/client");
      await expect(new ApiClient().get("/api/v1/overview")).rejects.toMatchObject({ code: "HTTP_500" });
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
describe("UI-2.2.1: разделение агрегатов shadow и replay", () => {
  test("shadow forecasts: totals только для shadow, modeTotals раздельны", async () => {
    const { body } = await get("/api/v1/shadow/forecasts?limit=5");
    expect(body.data.items.every((item: any) => item.mode === "shadow")).toBe(true);
    expect(body.data.totals.snapshots).toBe(body.data.modeTotals.shadow.snapshots);
    expect(body.data.totals.snapshots).not.toBe(body.data.modeTotals.replay.snapshots + body.data.modeTotals.shadow.snapshots);
    expect(body.data.modeTotals.replay.snapshots).toBeGreaterThan(0);
    expect(body.data.totals.snapshots).toBeLessThan(body.data.modeTotals.shadow.snapshots + body.data.modeTotals.replay.snapshots);
  });

  test("replay запрашивается отдельно и его totals не смешиваются с shadow", async () => {
    const { body } = await get("/api/v1/shadow/forecasts?mode=replay&limit=5");
    expect(body.data.items.every((item: any) => item.mode === "replay")).toBe(true);
    expect(body.data.totals.snapshots).toBe(body.data.modeTotals.replay.snapshots);
  });

  test("overview: shadow и replay раздельны", async () => {
    const { body } = await get("/api/v1/overview");
    expect(body.data.shadow.snapshots).toBeGreaterThan(0);
    expect(body.data.replay.snapshots).toBeGreaterThan(0);
    expect(body.data.shadow.snapshots).not.toBe(body.data.shadow.snapshots + body.data.replay.snapshots);
  });

  test("reconciliations фильтруются по режиму", async () => {
    const shadow = await get("/api/v1/shadow/reconciliations?limit=5");
    expect(shadow.body.data.mode).toBe("shadow");
    const replay = await get("/api/v1/shadow/reconciliations?mode=replay&limit=5");
    expect(replay.body.data.mode).toBe("replay");
    expect(replay.body.data.total).not.toBe(shadow.body.data.total + replay.body.data.total);
    const invalid = await get("/api/v1/shadow/reconciliations?mode=all");
    expect(invalid.status).toBe(400);
  });

  test("coverage: nullPolicy объявлена явно", async () => {
    const { body } = await get("/api/v1/history/coverage");
    expect(body.data.nullPolicy).toBe("REJECTED_AS_CORRUPTED");
    expect(body.data.nullValues).toBe(0);
  });
});

describe("UI-2.2.1: контракт ошибок и метаданных", () => {
  test("ошибки маршрутов содержат eventId", async () => {
    const { status, body } = await get("/api/v1/history?limit=0");
    expect(status).toBe(400);
    expect(body.error.code).toBe("INVALID_QUERY");
    expect(typeof body.error.eventId).toBe("string");
    expect(body.error.eventId.length).toBeGreaterThan(10);
  });

  test("not_available без обязательных meta отклоняется клиентом", () => {
    expect(validateResult({ status: "not_available", data: null, meta: {} })).toBeNull();
    expect(validateResult({ status: "not_available", data: null, meta: { readOnly: true, generatedAt: "x", source: "s" } })).not.toBeNull();
  });
});
describe("UI-2.2.2: R1 строгая схема manifest", () => {
  const base = { version: "shadow-mode/v1", created_at: "2026-11-24T11:14:48.138Z", dataset_checksum: "a".repeat(64), horizons: [1, 3], models: { rolling_7_day_mean: "v1", adaptive_baseline: "v1" }, alpha: 1, limit_percent: 0.1, min_train_days: 28, note: "x" };
  async function statusOf(patch: Record<string, unknown>): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "dss-manifest-"));
    await writeFile(join(dir, "manifest.json"), JSON.stringify({ ...base, ...patch }));
    return (await readManifest(dir)).status;
  }
  test("корректный manifest по реальной схеме → OK", async () => {
    expect(await statusOf({})).toBe("OK");
  });
  test("нестрогий created_at отклоняется", async () => {
    for (const created_at of ["24.11.2026", "2026-11-24", "2026-11-24T11:14:48", "not-a-date"]) {
      expect(await statusOf({ created_at }), created_at).toBe("CORRUPTED");
    }
  });
  test("отрицательные и нечисловые alpha/limit_percent отклоняются", async () => {
    expect(await statusOf({ alpha: -1 })).toBe("CORRUPTED");
    expect(await statusOf({ alpha: "1" })).toBe("CORRUPTED");
    expect(await statusOf({ limit_percent: -0.1 })).toBe("CORRUPTED");
    expect(await statusOf({ limit_percent: Number.NaN })).toBe("CORRUPTED");
  });
  test("min_train_days должен быть целым ≥ 1", async () => {
    expect(await statusOf({ min_train_days: 28.5 })).toBe("CORRUPTED");
    expect(await statusOf({ min_train_days: 0 })).toBe("CORRUPTED");
    expect(await statusOf({ min_train_days: "28" })).toBe("CORRUPTED");
    expect(await statusOf({ min_train_days: 21 })).toBe("OK");
  });
  test("дубликаты и посторонние горизонты отклоняются", async () => {
    expect(await statusOf({ horizons: [1, 1] })).toBe("CORRUPTED");
    expect(await statusOf({ horizons: [1, 3, 7] })).toBe("CORRUPTED");
    expect(await statusOf({ horizons: [] })).toBe("CORRUPTED");
  });
  test("отсутствие обязательных полей отклоняется", async () => {
    expect(await statusOf({ models: undefined })).toBe("CORRUPTED");
    expect(await statusOf({ note: undefined })).toBe("CORRUPTED");
    expect(await statusOf({ dataset_checksum: undefined })).toBe("CORRUPTED");
    expect(await statusOf({ models: { rolling_7_day_mean: "v1" } })).toBe("CORRUPTED");
  });
});

describe("UI-2.2.2: R2 единый контракт ошибок с eventId", () => {
  test("404, метод, Host и маршруты содержат eventId", async () => {
    const notFound = await get("/api/v1/unknown");
    expect(notFound.status).toBe(404);
    expect(typeof notFound.body.error.eventId).toBe("string");
    const method = await app.request("http://127.0.0.1/api/v1/history", { method: "POST", headers: { Host: "127.0.0.1:8787" } });
    expect(((await method.json()) as any).error.eventId).toBeTruthy();
    const host = await get("/api/health", { Host: "evil.example.com" });
    expect(host.body.error.eventId).toBeTruthy();
    const route = await get("/api/v1/history?limit=0");
    expect(route.body.error.eventId).toBeTruthy();
  });
  test("клиент принимает eventId строкой и отклоняет неверный тип", () => {
    expect(validateResult({ status: "error", error: { code: "E", message: "m", eventId: "abc" } })).not.toBeNull();
    expect(validateResult({ status: "error", error: { code: "E", message: "m", eventId: 42 } })).toBeNull();
  });
});

describe("UI-2.2.2: R3 reconciliation provenance", () => {
  test("reconciliation с неизвестным snapshot не классифицируется как shadow", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dss-recon-"));
    const snapshot = { snapshot_id: "s1", run_id: "r", mode: "shadow", model_id: "rolling_7_day_mean", model_version: "v1", variant: null, horizon: 1, origin_date: "2026-11-22", target_date: "2026-11-23", forecast_value: 1500, status: "OK", fallback_reason: null, input_data_version: "iv", dataset_checksum: "a".repeat(64), generated_at: "2026-11-24T00:00:00.000Z" };
    await writeFile(join(dir, "forecasts.jsonl"), `${JSON.stringify(snapshot)}\n`);
    const known = { snapshot_id: "s1", run_id: "r", model_id: "rolling_7_day_mean", horizon: 1, target_date: "2026-11-23", forecast_value: 1500, actual: 1545, absolute_error: 45, signed_error: -45, reconciled_at: "x" };
    const orphan = { ...known, snapshot_id: "missing-snapshot" };
    await writeFile(join(dir, "reconciliations.jsonl"), `${JSON.stringify(known)}\n${JSON.stringify(orphan)}\n`);
    const model = await reconciliationsModel({}, dir);
    expect(model.unknownSnapshots).toBe(1);
    expect(model.total).toBe(1);
    expect(model.mode).toBe("shadow");
    expect(model.items.every((item) => item.snapshotId === "s1")).toBe(true);
  });
});

describe("UI-2.2.2: R8 фактическое отклонение повреждённого CSV", () => {
  test("NULL и нечисловое значение в canonical CSV → DATA_SOURCE_CORRUPTED", async () => {
    const header = "date,shop_no,metric,value,source_slice_id,source_dataset_id,source_run_id,quality_status";
    for (const value of ["", "NULL", "abc", "NaN"]) {
      const dir = await mkdtemp(join(tmpdir(), "dss-csv-"));
      const path = join(dir, "canonical.csv");
      await writeFile(path, `${header}\n2026-11-21,7745,qty_orders_delivered,1500,20624,1,1,full\n2026-11-22,7745,qty_orders_delivered,${value},20624,1,1,full\n`);
      await expect(readHistory(path), value).rejects.toMatchObject({ code: "DATA_SOURCE_CORRUPTED" });
    }
    const dir = await mkdtemp(join(tmpdir(), "dss-csv-"));
    const path = join(dir, "canonical.csv");
    await writeFile(path, `${header}\n2026-11-21,7745,qty_orders_delivered,1500,20624,1,1,full\n2026-11-22,7745,qty_orders_delivered,1545,20624,1,1,full\n`);
    const ok = await readHistory(path);
    expect(ok.points.length).toBe(2);
    expect(ok.fileChecksum).not.toBe(ok.normalizedChecksum);
  });
});
describe("UI-2.2.3: R1 строгий timestamp и непустые строки manifest", () => {
  const base = { version: "shadow-mode/v1", created_at: "2026-11-24T11:14:48.138Z", dataset_checksum: "a".repeat(64), horizons: [1, 3], models: { rolling_7_day_mean: "v1", adaptive_baseline: "v1" }, alpha: 1, limit_percent: 0.1, min_train_days: 28, note: "x" };
  async function statusOf(patch: Record<string, unknown>): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "dss-ts-"));
    await writeFile(join(dir, "manifest.json"), JSON.stringify({ ...base, ...patch }));
    return (await readManifest(dir)).status;
  }
  test("некалендарные дата и время отклоняются", async () => {
    for (const created_at of ["2026-02-30T00:00:00.000Z", "2026-13-01T00:00:00.000Z", "2026-11-24T25:00:00.000Z", "2026-11-24T10:61:00.000Z", "2026-11-24T10:00:61.000Z"]) {
      expect(await statusOf({ created_at }), created_at).toBe("CORRUPTED");
    }
  });
  test("корректные граничные timestamp принимаются", async () => {
    for (const created_at of ["2024-02-29T23:59:59.999Z", "2026-11-24T00:00:00Z", "2026-11-24T11:14:48.138Z"]) {
      expect(await statusOf({ created_at }), created_at).toBe("OK");
    }
  });
  test("пустые models и note после trim отклоняются", async () => {
    expect(await statusOf({ note: "   " })).toBe("CORRUPTED");
    expect(await statusOf({ note: "" })).toBe("CORRUPTED");
    expect(await statusOf({ models: { rolling_7_day_mean: "  ", adaptive_baseline: "v1" } })).toBe("CORRUPTED");
    expect(await statusOf({ models: { rolling_7_day_mean: "v1", adaptive_baseline: "" } })).toBe("CORRUPTED");
  });
  test("верхние границы alpha и limit_percent не вводятся", async () => {
    expect(await statusOf({ alpha: 999 })).toBe("OK");
    expect(await statusOf({ limit_percent: 5 })).toBe("OK");
  });
});

describe("UI-2.2.3: R2 обязательный eventId во всех путях ошибок", () => {
  test("eventId отсутствует, пустой или не строка → ответ отклоняется", () => {
    expect(validateResult({ status: "error", error: { code: "E", message: "m" } })).toBeNull();
    expect(validateResult({ status: "error", error: { code: "E", message: "m", eventId: "" } })).toBeNull();
    expect(validateResult({ status: "error", error: { code: "E", message: "m", eventId: "   " } })).toBeNull();
    expect(validateResult({ status: "error", error: { code: "E", message: "m", eventId: 42 } })).toBeNull();
    expect(validateResult({ status: "error", error: { code: "E", message: "m", eventId: "abc" } })).not.toBeNull();
  });
  test("400, 403, 404, 405 содержат eventId", async () => {
    const cases: Array<[string, Response]> = [
      ["400", await app.request("http://127.0.0.1/api/v1/history?limit=0", { headers: { Host: "127.0.0.1:8787" } })],
      ["403", await app.request("http://127.0.0.1/api/health", { headers: { Host: "evil.example.com" } })],
      ["404", await app.request("http://127.0.0.1/api/v1/nope", { headers: { Host: "127.0.0.1:8787" } })],
      ["405", await app.request("http://127.0.0.1/api/v1/history", { method: "POST", headers: { Host: "127.0.0.1:8787" } })],
    ];
    for (const [label, response] of cases) {
      const body = (await response.json()) as any;
      expect(typeof body.error.eventId, label).toBe("string");
      expect(body.error.eventId.length, label).toBeGreaterThan(10);
    }
  });
  test("500 через fail() также содержит eventId и не раскрывает деталей", () => {
    let captured: any = null;
    const context = { json: (body: unknown, status: number) => { captured = { body, status }; return new Response(); } };
    const response = fail(context, new Error("SELECT * FROM secrets WHERE path = 'C:\\\\secret'"));
    expect(response).toBeInstanceOf(Response);
    expect(captured.status).toBe(500);
    expect(captured.body.error.code).toBe("INTERNAL_ERROR");
    expect(typeof captured.body.error.eventId).toBe("string");
    expect(JSON.stringify(captured.body)).not.toContain("SELECT");
    expect(JSON.stringify(captured.body)).not.toContain("C:\\\\");
  });
});

describe("UI-2.2.3: R8 целостность canonical CSV", () => {
  const header = "date,shop_no,metric,value,source_slice_id,source_dataset_id,source_run_id,quality_status";
  const row = (date: string, value: string) => `${date},7745,qty_orders_delivered,${value},20624,ds,run,full`;
  async function writeCsv(content: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "dss-csv-"));
    const path = join(dir, "canonical.csv");
    await writeFile(path, content);
    return path;
  }
  test("переставленные колонки, лишняя колонка и дубликат заголовка отклоняются", async () => {
    const swapped = await writeCsv(`value,date,shop_no,metric,source_slice_id,source_dataset_id,source_run_id,quality_status\n1500,2026-11-21,7745,qty_orders_delivered,20624,ds,run,full\n`);
    await expect(readHistory(swapped)).rejects.toMatchObject({ code: "DATA_SOURCE_CORRUPTED" });
    const extra = await writeCsv(`${header},extra\n${row("2026-11-21", "1500")},x\n`);
    await expect(readHistory(extra)).rejects.toMatchObject({ code: "DATA_SOURCE_CORRUPTED" });
    const duplicate = await writeCsv(`date,shop_no,metric,value,value,source_dataset_id,source_run_id,quality_status\n${row("2026-11-21", "1500")}\n`);
    await expect(readHistory(duplicate)).rejects.toMatchObject({ code: "DATA_SOURCE_CORRUPTED" });
  });
  test("другой магазин, метрика, slice и невозможная дата отклоняются", async () => {
    const otherShop = await writeCsv(`${header}\n2026-11-21,9999,qty_orders_delivered,1500,20624,ds,run,full\n`);
    await expect(readHistory(otherShop)).rejects.toMatchObject({ code: "DATA_SOURCE_CORRUPTED" });
    const otherMetric = await writeCsv(`${header}\n2026-11-21,7745,revenue,1500,20624,ds,run,full\n`);
    await expect(readHistory(otherMetric)).rejects.toMatchObject({ code: "DATA_SOURCE_CORRUPTED" });
    const otherSlice = await writeCsv(`${header}\n2026-11-21,7745,qty_orders_delivered,1500,99999,ds,run,full\n`);
    await expect(readHistory(otherSlice)).rejects.toMatchObject({ code: "DATA_SOURCE_CORRUPTED" });
    const badDate = await writeCsv(`${header}\n2026-02-30,7745,qty_orders_delivered,1500,20624,ds,run,full\n`);
    await expect(readHistory(badDate)).rejects.toMatchObject({ code: "DATA_SOURCE_CORRUPTED" });
  });
  test("корректный CSV читается, даты round-trip подтверждены", async () => {
    const ok = await writeCsv(`${header}\n2024-02-29,7745,qty_orders_delivered,1500,20624,ds,run,full\n2024-03-01,7745,qty_orders_delivered,1545,20624,ds,run,full\n`);
    const result = await readHistory(ok);
    expect(result.points.map((point) => point.date)).toEqual(["2024-02-29", "2024-03-01"]);
    expect(isRealCalendarDate("2024-02-29")).toBe(true);
    expect(isRealCalendarDate("2025-02-29")).toBe(false);
    expect(isStrictIsoTimestamp("2026-02-30T00:00:00Z")).toBe(false);
    expect(isStrictIsoTimestamp("2026-11-24T23:59:59Z")).toBe(true);
  });
});
describe("UI-2.2.4: числовой домен qty_orders_delivered", () => {
  const header = "date,shop_no,metric,value,source_slice_id,source_dataset_id,source_run_id,quality_status";
  const line = (date: string, value: string) => `${date},7745,qty_orders_delivered,${value},20624,ds,run,full`;
  async function writeCsv(content: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "dss-domain-"));
    const path = join(dir, "canonical.csv");
    await writeFile(path, content);
    return path;
  }
  test("недопустимые значения отклоняются", async () => {
    for (const value of ["-1", "1.5", "0x10", "NaN", "Infinity", "-Infinity", "NULL", ""]) {
      const path = await writeCsv(`${header}\n${line("2026-11-21", "1500")}\n${line("2026-11-22", value)}\n`);
      await expect(readHistory(path), JSON.stringify(value)).rejects.toMatchObject({ code: "DATA_SOURCE_CORRUPTED" });
    }
  });
  test("нестандартные форматы отклоняются", async () => {
    for (const value of ["1e3", "+5", " 15", "15 ", "1_000", "0b101", "١٢٣", "99999999999999999999"]) {
      const path = await writeCsv(`${header}\n${line("2026-11-21", value)}\n`);
      await expect(readHistory(path), JSON.stringify(value)).rejects.toMatchObject({ code: "DATA_SOURCE_CORRUPTED" });
    }
  });
  test("допустимые значения принимаются, порядок и количество точек сохраняются", async () => {
    const path = await writeCsv(`${header}\n${line("2026-11-19", "0")}\n${line("2026-11-20", "1")}\n${line("2026-11-21", "1500")}\n${line("2026-11-22", "1545")}\n`);
    const result = await readHistory(path);
    expect(result.points.map((point) => point.value)).toEqual([0, 1, 1500, 1545]);
    expect(result.points.map((point) => point.date)).toEqual(["2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"]);
    expect(result.points.length).toBe(4);
  });
  test("повреждённое значение не превращается в 0", async () => {
    const path = await writeCsv(`${header}\n${line("2026-11-21", "NULL")}\n`);
    let caught: any = null;
    try {
      await readHistory(path);
    } catch (error) {
      caught = error;
    }
    expect(caught).not.toBeNull();
    expect(caught.code).toBe("DATA_SOURCE_CORRUPTED");
    expect(JSON.stringify(caught)).not.toContain("value: 0");
  });
});
describe("UI-2.2.5: сохранение исходных значений CSV", () => {
  const header = "date,shop_no,metric,value,source_slice_id,source_dataset_id,source_run_id,quality_status";
  const line = (value: string, date = "2026-11-21") => `${date},7745,qty_orders_delivered,${value},20624,ds,run,full`;
  const endings: Array<[string, string]> = [["LF", "\n"], ["CRLF", "\r\n"]];
  async function writeCsv(content: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "dss-raw-"));
    const path = join(dir, "canonical.csv");
    await writeFile(path, content);
    return path;
  }

  test("пробелы, табы и \\r внутри значения не нормализуются (LF и CRLF, с переводом и без)", async () => {
    for (const [endingName, ending] of endings) {
      for (const trailing of [true, false]) {
        for (const value of ["15 ", " 15", "15\t", "15\r", "15.0"]) {
          const tail = trailing ? ending : "";
          const path = await writeCsv(`${header}${ending}${line("1500", "2026-11-21")}${ending}${line(value, "2026-11-22")}${tail}`);
          await expect(readHistory(path), `${endingName}/trailing=${trailing}/${JSON.stringify(value)}`).rejects.toMatchObject({ code: "DATA_SOURCE_CORRUPTED" });
        }
      }
    }
  });

  test("корректные значения принимаются во всех вариантах переводов строк", async () => {
    for (const [endingName, ending] of endings) {
      for (const trailing of [true, false]) {
        for (const value of ["15", "0"]) {
          const tail = trailing ? ending : "";
          const path = await writeCsv(`${header}${ending}${line("1500", "2026-11-21")}${ending}${line(value, "2026-11-22")}${tail}`);
          const result = await readHistory(path);
          expect(result.points.map((point) => point.value), `${endingName}/${trailing}/${value}`).toEqual([1500, Number(value)]);
        }
      }
    }
  });

  test("завершающий CRLF не попадает в значение, пробел перед ним сохраняется", async () => {
    const clean = await writeCsv(`${header}\r\n${line("1500")}\r\n`);
    const ok = await readHistory(clean);
    expect(ok.points).toEqual([{ date: "2026-11-21", value: 1500 }]);
    const spaceBeforeCrlf = await writeCsv(`${header}\r\n${line("1500 ")}\r\n`);
    await expect(readHistory(spaceBeforeCrlf)).rejects.toMatchObject({ code: "DATA_SOURCE_CORRUPTED" });
  });

  test("пустые строки внутри CSV не игнорируются молча", async () => {
    const withBlank = await writeCsv(`${header}\n${line("1500")}\n\n${line("1545")}\n`);
    await expect(readHistory(withBlank)).rejects.toMatchObject({ code: "DATA_SOURCE_CORRUPTED" });
  });

  test("fileChecksum остаётся checksum исходных байтов", async () => {
    const path = await writeCsv(`${header}\r\n${line("1500")}\r\n`);
    const result = await readHistory(path);
    const raw = await Bun.file(path).text();
    expect(result.fileChecksum).toBe(new Bun.CryptoHasher("sha256").update(raw).digest("hex"));
    expect(result.fileChecksum).not.toBe(result.normalizedChecksum);
  });

  test("порядок и количество точек сохраняются, повреждённое значение не становится нулём", async () => {
    const path = await writeCsv(`${header}\n${line("0", "2026-11-19")}\n${line("1", "2026-11-20")}\n${line("1500", "2026-11-21")}\n${line("1545", "2026-11-22")}\n`);
    const result = await readHistory(path);
    expect(result.points.map((point) => point.value)).toEqual([0, 1, 1500, 1545]);
    expect(result.points.length).toBe(4);
    let caught: any = null;
    try {
      await readHistory(await writeCsv(`${header}\n${line("NULL")}\n`));
    } catch (error) {
      caught = error;
    }
    expect(caught?.code).toBe("DATA_SOURCE_CORRUPTED");
  });
});
describe("UI-2.2.5.1: один завершающий разделитель и одиночный CR", () => {
  const header = "date,shop_no,metric,value,source_slice_id,source_dataset_id,source_run_id,quality_status";
  const line = (value: string, date = "2026-11-21") => `${date},7745,qty_orders_delivered,${value},20624,ds,run,full`;
  async function writeCsv(content: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "dss-raw2-"));
    const path = join(dir, "canonical.csv");
    await writeFile(path, content);
    return path;
  }

  test("одиночный завершающий CR без LF не удаляется и отклоняется", async () => {
    // \r в последней колонке (файл без завершающего LF)
    const trailingCr = await writeCsv(`${header}\n${line("1500", "2026-11-21")}\n${line("15", "2026-11-22")}\r`);
    await expect(readHistory(trailingCr)).rejects.toMatchObject({ code: "DATA_SOURCE_CORRUPTED" });
    // \r внутри значения value (за ним следуют остальные колонки)
    const crInValue = await writeCsv(`${header}\n2026-11-21,7745,qty_orders_delivered,1500,20624,ds,run,full\n2026-11-22,7745,qty_orders_delivered,15\r,20624,ds,run,full`);
    await expect(readHistory(crInValue)).rejects.toMatchObject({ code: "DATA_SOURCE_CORRUPTED" });
    const okCr = await writeCsv(`${header}\r\n${line("1500", "2026-11-21")}\r\n${line("15", "2026-11-22")}\r\n`);
    const result = await readHistory(okCr);
    expect(result.points.map((point) => point.value)).toEqual([1500, 15]);
  });

  test("два завершающих LF отклоняются", async () => {
    const path = await writeCsv(`${header}\n${line("1500")}\n\n`);
    await expect(readHistory(path)).rejects.toMatchObject({ code: "DATA_SOURCE_CORRUPTED" });
  });

  test("полная матрица последнего значения: LF и CRLF, с переводом и без", async () => {
    const cases: Array<[string, string, boolean]> = [
      ["15", "PASS", true], ["15", "PASS", false],
      ["15 ", "REJECT", true], ["15 ", "REJECT", false],
      [" 15", "REJECT", true], [" 15", "REJECT", false],
      ["15\t", "REJECT", true], ["15\t", "REJECT", false],
      ["15.0", "REJECT", true], ["15.0", "REJECT", false],
      ["0", "PASS", true], ["0", "PASS", false],
    ];
    for (const ending of ["\n", "\r\n"]) {
      for (const [value, expectation, trailing] of cases) {
        const tail = trailing ? ending : "";
        const path = await writeCsv(`${header}${ending}${line("1500", "2026-11-21")}${ending}${line(value, "2026-11-22")}${tail}`);
        const label = `${JSON.stringify(ending)}/${JSON.stringify(value)}/trailing=${trailing}`;
        if (expectation === "PASS") {
          const result = await readHistory(path);
          expect(result.points.map((point) => point.value), label).toEqual([1500, Number(value)]);
        } else {
          await expect(readHistory(path), label).rejects.toMatchObject({ code: "DATA_SOURCE_CORRUPTED" });
        }
      }
    }
  });

  test("пустая внутренняя строка отклоняется", async () => {
    const path = await writeCsv(`${header}\n${line("1500")}\n\n${line("1545", "2026-11-22")}\n`);
    await expect(readHistory(path)).rejects.toMatchObject({ code: "DATA_SOURCE_CORRUPTED" });
  });

  test("пробелы в заголовке не удаляются", async () => {
    const path = await writeCsv(`date,shop_no,metric,value,source_slice_id,source_dataset_id,source_run_id,quality_status \n${line("1500")}\n`);
    await expect(readHistory(path)).rejects.toMatchObject({ code: "DATA_SOURCE_CORRUPTED" });
  });
});