// FINAL-3.3.2.2: тесты страницы «Прогнозирование» (два независимых блока, null/0, состояния).
import { describe, expect, test } from "bun:test";

import { renderApp } from "../../src/web/app-render";
import { forecastPage, loadForecastPage } from "../../src/web/pages/forecast";
import { forecastValueText, snapshotsBlock, snapshotsCard, type ForecastsListView } from "../../src/web/pages/forecast-snapshots";
import { reconciliationValueText, reconciliationsBlock, reconciliationsCard, type ReconciliationsView } from "../../src/web/pages/forecast-reconciliations";

const SNAPSHOT: ForecastsListView = {
  mode: "shadow",
  horizon: 1,
  total: 42,
  returned: 2,
  items: [
    { snapshotId: "snap-0001", mode: "shadow", modelId: "rolling_mean", modelVersion: "v3", variant: null, horizon: 1, originDate: "2026-06-01", targetDate: "2026-06-02", forecastValue: 0, status: "OK", inputDataVersion: "dsv-7", generatedAt: "2026-06-01T10:00:00.000Z" },
    { snapshotId: "snap-0002", mode: "shadow", modelId: "<script>bad</script>", modelVersion: "v3", variant: "b", horizon: 1, originDate: "2026-06-02", targetDate: "2026-06-03", forecastValue: null, status: "PENDING", inputDataVersion: "dsv-7", generatedAt: "2026-06-02T10:00:00.000Z" },
  ],
  provenance: { datasetChecksums: ["sum-a"], datasetVersionWarning: true, manifestStatus: "OK", manifestDatasetChecksum: "manifest-sum", freshness: "STALE", shadowFileChecksums: { forecasts: "f-sum" } },
};

const RECONCILIATION: ReconciliationsView = {
  mode: "shadow",
  total: 2,
  unknownSnapshots: 3,
  items: [
    { snapshotId: "snap-0001", modelId: "rolling_mean", horizon: 1, targetDate: "2026-06-02", forecastValue: 0, actual: 0, absoluteError: 0, signedError: 0 },
    { snapshotId: "snap-0002", modelId: "rolling_mean", horizon: 1, targetDate: "2026-06-03", forecastValue: null, actual: 1500, absoluteError: 12, signedError: -12 },
  ],
  source: "shadow_jsonl",
  note: "detected only",
};

describe("FINAL-3.3.2.2: null против нуля", () => {
  test("null — отсутствие значения, 0 — реальный ноль", () => {
    expect(forecastValueText(null)).toBe("Нет значения");
    expect(forecastValueText(0)).toBe("0");
    expect(reconciliationValueText(null)).toBe("Нет значения");
    expect(reconciliationValueText(0)).toBe("0");
  });

  test("таблица снапшотов различает null и 0 и не подменяет их", () => {
    const html = snapshotsCard(SNAPSHOT);
    expect(html).toContain("Нет значения");
    expect(html).toMatch(/>0</);
    expect(html).toContain("Показано");
    expect(html).toContain("последние 2 из 42");
    expect(html).toContain("Дата формирования");
    expect(html).toContain("Дата происхождения");
    expect(html).toContain("Дата прогноза");
    expect(html).toContain("Версия входных данных");
    expect(html).toContain("Snapshot ID");
    expect(html).toContain("snap-0001");
  });
});

describe("FINAL-3.3.2.2: безопасность и provenance", () => {
  test("значения API экранируются", () => {
    const html = snapshotsCard(SNAPSHOT);
    expect(html).not.toContain("<script>bad</script>");
    expect(html).toContain("&lt;script&gt;bad&lt;/script&gt;");
  });

  test("provenance отображается только у снапшотов", () => {
    const snapshots = snapshotsCard(SNAPSHOT);
    expect(snapshots).toContain("freshness: STALE");
    expect(snapshots).toContain("manifest: OK");
    expect(snapshots).toContain("обнаружено различие версий набора данных");
    const reconcile = reconciliationsCard(RECONCILIATION);
    for (const term of ["freshness", "manifest", "checksum данных", "datasetChecksums"]) {
      expect(reconcile, term).not.toContain(term);
    }
    expect(reconcile).toContain("источник: shadow_jsonl");
    expect(reconcile).toContain("detected only");
  });

  test("сверки не выдаются за полный список прогнозов", () => {
    const html = reconciliationsCard(RECONCILIATION);
    expect(html).toContain("сверенное подмножество прогнозных записей");
    expect(html).toContain("не полный список прогнозов");
  });
});

describe("FINAL-3.3.2.2: unknownSnapshots", () => {
  test("предупреждение появляется только при значении больше нуля", () => {
    const withUnknown = reconciliationsCard(RECONCILIATION);
    expect(withUnknown).toContain("не включена в таблицу: 3");
    expect(withUnknown).toContain("Это не количество ошибок прогноза");
    const without = reconciliationsCard({ ...RECONCILIATION, unknownSnapshots: 0 });
    expect(without).toContain("Исключённых сверок без известного снапшота нет");
    expect(without).not.toContain("не включена в таблицу");
  });
});

describe("FINAL-3.3.2.2: состояния обоих блоков", () => {
  test("loading, not_available и error различаются", () => {
    expect(snapshotsBlock(null, "shadow", 1)).toContain("Загрузка списка прогнозов");
    expect(snapshotsBlock({ status: "not_available", data: null, meta: { reason: "NO_RECORDS_FOR_MODE_AND_HORIZON" } } as never, "shadow", 1)).toContain("NO_RECORDS_FOR_MODE_AND_HORIZON");
    expect(snapshotsBlock({ status: "error", error: { code: "E1", message: "boom", eventId: "x" } } as never, "shadow", 1)).toContain("Не удалось получить список прогнозов");
    expect(reconciliationsBlock(null, "replay", 3)).toContain("Загрузка сверок с фактом");
    expect(reconciliationsBlock({ status: "not_available", data: null, meta: { reason: "NO_RECONCILIATIONS" } } as never, "replay", 3)).toContain("NO_RECONCILIATIONS");
    expect(reconciliationsBlock({ status: "error", error: { code: "E2", message: "boom", eventId: "y" } } as never, "replay", 3)).toContain("Не удалось получить сверки");
  });

  test("страница содержит переходы с текущими mode и horizon", () => {
    const html = forecastPage({ mode: "replay", horizon: 3, snapshots: null, reconciliations: null, generatedAt: null });
    expect(html).toContain("#forecast-quality/replay/3");
    expect(html).toContain("#forecast-diagnostics/replay/3");
    expect(html).toContain("#forecast/shadow/3");
    expect(html).toContain("qty_orders_delivered");
    expect(html).not.toContain("h7");
    expect(html).not.toContain("h14");
  });
});

describe("FINAL-3.3.2.2: независимость загрузки блоков", () => {

  test("оба блока показывают свои состояния независимо друг от друга", () => {
    const snapshotsOk = forecastPage({ mode: "shadow", horizon: 1, generatedAt: null, snapshots: { status: "ok", data: SNAPSHOT, meta: { generatedAt: "2026-06-02T00:00:00.000Z", source: "s", readOnly: true } } as never, reconciliations: { status: "not_available", data: null, meta: { reason: "NO_RECONCILIATIONS" } } as never });
    expect(snapshotsOk).toContain("snap-0001");
    expect(snapshotsOk).toContain("NO_RECONCILIATIONS");
    expect(snapshotsOk).not.toContain("Не удалось получить сверки");

    const reconciliationsOk = forecastPage({ mode: "replay", horizon: 3, generatedAt: null, snapshots: { status: "error", error: { code: "UPSTREAM", message: "fail", eventId: "e-1" } } as never, reconciliations: { status: "ok", data: RECONCILIATION, meta: { source: "shadow_jsonl", note: null, generatedAt: "2026-06-02T00:00:00.000Z", source2: "x", readOnly: true } } as never });
    expect(reconciliationsOk).toContain("Не удалось получить список прогнозов");
    expect(reconciliationsOk).toContain("Знаковая ошибка");
    expect(reconciliationsOk).not.toContain("NO_RECONCILIATIONS");

    const bothEmpty = forecastPage({ mode: "shadow", horizon: 3, generatedAt: null, snapshots: { status: "not_available", data: null, meta: { reason: "NO_RECORDS_FOR_MODE_AND_HORIZON" } } as never, reconciliations: { status: "not_available", data: null, meta: { reason: "NO_RECONCILIATIONS" } } as never });
    expect(bothEmpty).toContain("NO_RECORDS_FOR_MODE_AND_HORIZON");
    expect(bothEmpty).toContain("NO_RECONCILIATIONS");
  });
  test("запросы выполняются с обязательными параметрами и независимыми лимитами", async () => {
    const original = globalThis.fetch;
    const urls: string[] = [];
    try {
      globalThis.fetch = ((input: RequestInfo | URL) => { urls.push(String(input)); return Promise.resolve({ ok: true, status: 200, json: async () => ({ status: "not_available", data: null, meta: { generatedAt: "2026-06-02T00:00:00.000Z", source: "s", readOnly: true, reason: "NONE" } }) } as Response); }) as unknown as typeof fetch;
      await loadForecastPage({ mode: "shadow", horizon: 3, commit: () => undefined });
    } finally {
      globalThis.fetch = original;
    }
    const forecasts = urls.find((url) => url.includes("/api/v1/forecasts")) ?? "";
    const reconcile = urls.find((url) => url.includes("/api/v1/shadow/reconciliations")) ?? "";
    expect(forecasts).toContain("mode=shadow"); expect(forecasts).toContain("horizon=3"); expect(forecasts).toContain("limit=200");
    expect(reconcile).toContain("mode=shadow"); expect(reconcile).toContain("horizon=3"); expect(reconcile).toContain("limit=60");
    expect(urls).toHaveLength(2);
  });
});

describe("ROUTING-FORECAST-ENTRY: вход через Sidebar", () => {
  const okEmpty = (): Promise<Response> => Promise.resolve({ ok: true, status: 200, json: async () => ({ status: "not_available", data: null, meta: { generatedAt: "2026-06-02T00:00:00.000Z", source: "s", readOnly: true, reason: "NONE" } }) } as Response);

  async function run(hash: string): Promise<{ urls: string[]; replaced: string[]; html: string }> {
    const originalFetch = globalThis.fetch;
    const originalWindow = (globalThis as { window?: unknown }).window;
    const urls: string[] = []; const replaced: string[] = [];
    try {
      globalThis.fetch = ((input: RequestInfo | URL) => { urls.push(String(input)); return okEmpty(); }) as unknown as typeof fetch;
      (globalThis as { window?: unknown }).window = { location: { hash, replace: (value: string) => replaced.push(value) } };
      const root = { innerHTML: "" } as unknown as HTMLElement;
      await renderApp(root, hash);
      return { urls, replaced, html: root.innerHTML };
    } finally {
      globalThis.fetch = originalFetch;
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  }

  test("#forecast перенаправляет на канонический адрес без лишних запросов, затем грузит оба блока", async () => {
    const first = await run("#forecast");
    expect(first.replaced).toEqual(["#forecast/replay/1"]);
    expect(first.urls, "на входе запросы не выполняются").toHaveLength(0);
    expect(first.html).toContain("Загрузка списка прогнозов");
    const canonical = await run("#forecast/replay/1");
    expect(canonical.urls).toHaveLength(2);
    expect(canonical.urls.find((url) => url.includes("/api/v1/forecasts")) ?? "").toContain("mode=replay");
    expect(canonical.html).toContain("Снапшоты прогнозов");
    expect(canonical.html).toContain("Сверка с фактом");
  });

  test("канонические маршруты не перенаправляют и делают ровно два запроса", async () => {
    for (const hash of ["#forecast/replay/1", "#forecast/replay/3", "#forecast/shadow/1", "#forecast/shadow/3"]) {
      const { urls, replaced } = await run(hash);
      expect(replaced, hash).toEqual([]);
      expect(urls, hash).toHaveLength(2);
      expect(urls.some((url) => url.includes("/api/v1/forecasts")), hash).toBe(true);
      expect(urls.some((url) => url.includes("/api/v1/shadow/reconciliations")), hash).toBe(true);
    }
  });

  test("неподдерживаемый горизонт остаётся некорректным маршрутом без запросов", async () => {
    for (const hash of ["#forecast/replay/2", "#forecast/shadow/2", "#forecast/replay"]) {
      const { urls, replaced, html } = await run(hash);
      expect(urls, hash).toHaveLength(0);
      expect(replaced, hash).toEqual([]);
      expect(html, hash).toContain("Страница прогнозирования ещё не реализована");
    }
  });
});