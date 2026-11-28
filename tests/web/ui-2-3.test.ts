// UI-2.3.1/UI-2.3.2: поведенческие тесты Part B (B1–B4) через точку внедрения `get` в renderApp.
import { describe, expect, test } from "bun:test";

import { renderApp, rerenderHistoryFromCache } from "../../src/web/app-render";
import type { ApiResult } from "../../src/web/api/client";

const META = { generatedAt: "2026-06-02T00:00:00.000Z", source: "shadow_jsonl", readOnly: true } as const;
const ok = <T>(data: T): ApiResult<T> => ({ status: "ok", data, meta: { ...META } });
const notAvailable = (reason: string): ApiResult<never> => ({ status: "not_available", data: null, meta: { ...META, reason } });
const failure = (code: string): ApiResult<never> => ({ status: "error", error: { code, message: `ошибка ${code}`, eventId: `ev-${code}` } });

function overview(status: "ok" | "error" | "not_available") {
  if (status !== "ok") return status === "error" ? failure("OVERVIEW_FAILED") : notAvailable("OVERVIEW_EMPTY");
  return ok({
    shopNo: "7745", timezone: "Europe/Moscow", metric: "qty_orders_delivered", sliceId: 20624,
    history: { days: 2, firstDate: "2026-06-01", lastDate: "2026-06-02", lastValue: 1500, completeness: "COMPLETE" },
    shadow: { snapshots: 0, pending: 0, reconciled: 0, fallbacks: 0, invalids: 0, candidate: "c", baseline: "b", horizons: [1], available: false },
    replay: { snapshots: 0, available: false },
    provenance: { freshness: "MATCH", manifestStatus: "OK", fileChecksum: "f", normalizedChecksum: "n" },
  });
}

function history(points: number) {
  const items = Array.from({ length: points }, (_, index) => ({ date: `2026-06-${String((index % 28) + 1).padStart(2, "0")}`, value: 1000 + index }));
  return ok({
    points: items, from: "2026-06-01", to: "2026-06-02", totalPoints: points, returnedPoints: points, semantics: "PROVISIONAL" as const,
    summary: { sum: 2000, average: 1000, max: 1500, min: 500, calendarDays: points, observationDays: points, missingDays: 0, complete: true, truncated: false, formula: "sum" },
    requested: { from: null, to: null }, available: { from: "2024-06-01", to: "2026-06-02" }, rangeClamped: false,
  });
}

function coverage(status: "ok" | "error" | "not_available") {
  if (status !== "ok") return status === "error" ? failure("COVERAGE_FAILED") : notAvailable("COVERAGE_EMPTY");
  return ok({ firstDate: "2024-06-01", lastDate: "2026-06-02", days: 700, gaps: 0, duplicateDates: 0, nullValues: 0, nullPolicy: "REJECTED", completeness: "COMPLETE", missingDates: [], gapIntervals: [], maxGapLength: 0, fillRatio: 0.99, fillRatioFormula: "obs/cal" });
}

interface Harness { urls: string[]; root: { innerHTML: string }; render: (hash: string) => Promise<void> }

function harness(options: { overviewStatus?: "ok" | "error" | "not_available"; points?: number; coverageStatus?: "ok" | "error" | "not_available" } = {}): Harness {
  const urls: string[] = [];
  const root = { innerHTML: "" };
  const get = ((path: string) => {
    urls.push(path);
    if (path.includes("/overview")) return Promise.resolve(overview(options.overviewStatus ?? "ok"));
    if (path.includes("/history/coverage")) return Promise.resolve(coverage(options.coverageStatus ?? "ok"));
    if (path.includes("/shadow/forecasts")) return Promise.resolve(notAvailable("SHADOW_STORE_EMPTY"));
    return Promise.resolve(history(options.points ?? 120));
  }) as never;
  return { urls, root, render: (hash: string) => renderApp(root as unknown as HTMLElement, hash, get) };
}

describe("UI-2.3.2 B4: статус источника (overview) сохраняется при пагинации", () => {
  const cases: Array<["ok" | "error" | "not_available", string]> = [["ok", "источник: OK"], ["error", "источник: PARTIAL"], ["not_available", "источник: NOT_AVAILABLE"]];
  for (const [status, expected] of cases) {
    test(`overview=${status} → «${expected}» до и после Next/Prev`, async () => {
      const bench = harness({ overviewStatus: status });
      await bench.render("#history/all");
      expect(bench.root.innerHTML).toContain(expected);
      const tableBefore = bench.root.innerHTML.includes("Таблица истории");
      expect(tableBefore).toBe(true);
      const callsAfterLoad = bench.urls.length;
      rerenderHistoryFromCache(() => { throw new Error("fallback не ожидается"); });
      expect(bench.urls.length).toBe(callsAfterLoad);
      expect(bench.root.innerHTML).toContain(expected);
      expect(bench.root.innerHTML).toContain("Таблица истории");
    });
  }

  test("пустой успешный History сохраняет статус и не маскируется под недоступность", async () => {
    const bench = harness({ overviewStatus: "error", points: 0 });
    await bench.render("#history/all");
    expect(bench.root.innerHTML).toContain("источник: PARTIAL");
    expect(bench.root.innerHTML).not.toContain("Таблица истории");
    expect(bench.root.innerHTML).toContain("данных нет");
    rerenderHistoryFromCache(() => { throw new Error("fallback не ожидается"); });
    expect(bench.root.innerHTML).toContain("источник: PARTIAL");
  });

  test("ошибка Coverage не меняет статус источника и не мешает данным", async () => {
    const bench = harness({ coverageStatus: "error" });
    await bench.render("#history/all");
    expect(bench.root.innerHTML).toContain("источник: OK");
    expect(bench.root.innerHTML).toContain("Таблица истории");
    expect(bench.root.innerHTML).toContain("coverage API недоступен");
  });

  test("отсутствие Coverage → [Н/Д], статус источника сохраняется", async () => {
    const bench = harness({ coverageStatus: "not_available" });
    await bench.render("#history/all");
    expect(bench.root.innerHTML).toContain("[Н/Д]");
    expect(bench.root.innerHTML).toContain("источник: OK");
  });
});

describe("UI-2.3.2 B2: пагинация использует кэш без запросов", () => {
  test("перерисовка не выполняет запросов и не уходит в fallback", async () => {
    const bench = harness();
    await bench.render("#history/all");
    const calls = bench.urls.length;
    expect(calls).toBe(3);
    let fellBack = false;
    rerenderHistoryFromCache(() => { fellBack = true; });
    expect(fellBack).toBe(false);
    expect(bench.urls.length).toBe(calls);
    expect(bench.root.innerHTML).toContain("Таблица истории");
  });

  test("смена диапазона обновляет кэш и не выполняет лишних запросов при перерисовке", async () => {
    const bench = harness();
    await bench.render("#history/90");
    const calls = bench.urls.length;
    expect(calls).toBe(4);
    expect(bench.urls.filter((url) => url.endsWith("/api/v1/history")).length).toBe(2);
    rerenderHistoryFromCache(() => { throw new Error("fallback не ожидается"); });
    expect(bench.urls.length).toBe(calls);
    expect(bench.root.innerHTML).toContain("Таблица истории");
  });
});

describe("UI-2.3.2 B1/B3: изоляция shadow и переиспользование полного ряда", () => {
  test("shadow запрашивается только на Overview", async () => {
    const overviewBench = harness();
    await overviewBench.render("#overview");
    expect(overviewBench.urls.filter((url) => url.includes("/shadow/forecasts"))).toHaveLength(1);
    for (const hash of ["#history", "#quality", "#provenance", "#history/90"]) {
      const bench = harness();
      await bench.render(hash);
      expect(bench.urls.filter((url) => url.includes("/shadow/forecasts")), hash).toHaveLength(0);
    }
  });

  test("при range=all полный ряд не запрашивается, при 90 — запрашивается", async () => {
    const all = harness();
    await all.render("#history/all");
    expect(all.urls.filter((url) => url.endsWith("/api/v1/history"))).toHaveLength(1);
    const range = harness();
    await range.render("#history/90");
    expect(range.urls.filter((url) => url.endsWith("/api/v1/history"))).toHaveLength(2);
  });
});
