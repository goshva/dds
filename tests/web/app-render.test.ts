// FINAL-3.3.2.1: тесты production dispatch (resolvePage, placeholder NOT_IMPLEMENTED).
import { describe, expect, test } from "bun:test";

import { forecastNotImplemented, renderApp, resolvePage } from "../../src/web/app-render";
import { clickActionFor } from "../../src/web/app-events";
import { toErrorResult } from "../../src/web/app-result";
import { DEFAULT_PAGE, parseHash, type PageKey } from "../../src/web/routing";

describe("FINAL-3.3.2.1: dispatch существующих страниц", () => {
  test("каждый существующий маршрут выбирает свою страницу", () => {
    const expected: Array<[string, PageKey]> = [
      ["#overview", "overview"],
      ["#history", "history"],
      ["#history/90", "history"],
      ["#quality", "quality"],
      ["#provenance", "provenance"],
      ["#forecast-quality/replay/1", "forecast-quality"],
      ["#forecast-diagnostics/shadow/3", "forecast-diagnostics"],
    ];
    for (const [hash, page] of expected) {
      const decision = resolvePage(parseHash(hash));
      if (decision.kind !== "page") throw new Error(`${hash}: ожидалась страница`);
      expect(decision.page, hash).toBe(page);
    }
  });

  test("неизвестный маршрут сохраняет DEFAULT_PAGE", () => {
    for (const hash of ["#unknown", "", "#", "#for"]) {
      const decision = resolvePage(parseHash(hash));
      if (decision.kind !== "page") throw new Error(`${hash}: ожидалась страница`);
      expect(decision.page, hash).toBe(DEFAULT_PAGE);
    }
  });

  test("прогнозные страницы не переходят в Forecast-ветку", () => {
    expect(resolvePage(parseHash("#forecast-quality/shadow/1")).kind).toBe("page");
    expect(resolvePage(parseHash("#forecast-diagnostics/replay/3")).kind).toBe("page");
  });
});

describe("FINAL-3.3.2.1: dispatch Forecast (placeholder)", () => {
  test("четыре канонических маршрута дают валидное решение Forecast", () => {
    const expected: Array<[string, "replay" | "shadow", 1 | 3]> = [
      ["#forecast/replay/1", "replay", 1],
      ["#forecast/replay/3", "replay", 3],
      ["#forecast/shadow/1", "shadow", 1],
      ["#forecast/shadow/3", "shadow", 3],
    ];
    for (const [hash, mode, horizon] of expected) {
      const decision = resolvePage(parseHash(hash));
      expect(decision.kind, hash).toBe("forecast");
      if (decision.kind !== "forecast") continue;
      expect(decision.valid, hash).toBe(true);
      expect(decision.mode, hash).toBe(mode);
      expect(decision.horizon, hash).toBe(horizon);
      expect(decision.canonical, hash).toBe("#forecast/replay/1");
    }
  });

  test("некорректные маршруты не дают валидных параметров Forecast", () => {
    const invalid = [
      "#forecast", "#forecast/replay", "#forecast/unknown/1", "#forecast/replay/2",
      "#forecast/replay/1/extra", "#forecast/replay/1/", "#forecast//1", "#forecast/replay/",
    ];
    for (const hash of invalid) {
      const decision = resolvePage(parseHash(hash));
      expect(decision.kind, hash).toBe("forecast");
      if (decision.kind !== "forecast") continue;
      expect(decision.valid, hash).toBe(false);
      expect(decision.mode, hash).toBeNull();
      expect(decision.horizon, hash).toBeNull();
      expect(decision.canonical, hash).toBe("#forecast/replay/1");
    }
  });

  test("placeholder сообщает о нереализованности, а не об отсутствии данных", () => {
    const valid = forecastNotImplemented({ valid: true, mode: "shadow", horizon: 3, canonical: "#forecast/replay/1" });
    expect(valid).toContain("Страница прогнозирования ещё не реализована");
    expect(valid).toContain("NOT_IMPLEMENTED");
    expect(valid).toContain("shadow · h3");
    expect(valid).toContain("Данные прогнозов не запрашивались");
    expect(valid).not.toContain("Данные недоступны");
    expect(valid).not.toContain("<script>");

    const invalid = forecastNotImplemented({ valid: false, mode: null, horizon: null, canonical: "#forecast/replay/1" });
    expect(invalid).toContain("параметры маршрута некорректны");
    expect(invalid).toContain("#forecast/replay/1");
  });

  test("placeholder не содержит данных прогнозов и ошибок", () => {
    const html = forecastNotImplemented({ valid: true, mode: "replay", horizon: 1, canonical: "#forecast/replay/1" });
    for (const forbidden of ["forecastValue", "actual", "absoluteError", "signedError", "MAE", "WAPE", "shadow_jsonl"]) {
      expect(html, forbidden).not.toContain(forbidden);
    }
  });
});

describe("FINAL-3.3.2.2: маршрут Forecast загружает два независимых источника", () => {
  test("валидные маршруты запрашивают /forecasts и /reconciliations с mode и horizon", async () => {
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];
    try {
      globalThis.fetch = ((input: RequestInfo | URL) => {
        urls.push(String(input));
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ status: "not_available", data: null, meta: { generatedAt: "2026-06-02T00:00:00.000Z", source: "shadow_jsonl", readOnly: true, reason: "NONE" } }) } as Response);
      }) as unknown as typeof fetch;
      const root = { innerHTML: "" } as unknown as HTMLElement;
      for (const [hash, mode, horizon] of [["#forecast/replay/1", "replay", "1"], ["#forecast/replay/3", "replay", "3"], ["#forecast/shadow/1", "shadow", "1"], ["#forecast/shadow/3", "shadow", "3"]] as const) {
        urls.length = 0;
        await renderApp(root, hash);
        expect(urls.filter((url) => url.includes("/api/v1/forecasts")), hash).toHaveLength(1);
        expect(urls.filter((url) => url.includes("/api/v1/shadow/reconciliations")), hash).toHaveLength(1);
        const forecasts = urls.find((url) => url.includes("/api/v1/forecasts")) ?? "";
        expect(forecasts, hash).toContain(`mode=${mode}`);
        expect(forecasts, hash).toContain(`horizon=${horizon}`);
        expect(root.innerHTML, hash).toContain("Снапшоты прогнозов");
        expect(root.innerHTML, hash).toContain("Сверка с фактом");
        expect(root.innerHTML, hash).not.toContain("NOT_IMPLEMENTED");
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("некорректные маршруты показывают placeholder и не делают запросов", async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    try {
      globalThis.fetch = (() => { calls++; return Promise.reject(new Error("network must not be used")); }) as unknown as typeof fetch;
      const root = { innerHTML: "" } as unknown as HTMLElement;
      for (const hash of ["#forecast/replay", "#forecast/unknown/1", "#forecast/replay/2", "#forecast/replay/1/extra", "#forecast//1"]) {
        await renderApp(root, hash);
        expect(calls, hash).toBe(0);
        expect(root.innerHTML, hash).toContain("Страница прогнозирования ещё не реализована");
        expect(root.innerHTML, hash).toContain("NOT_IMPLEMENTED");
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
describe("FINAL-3.3.2.1-HARDENING: делегирование кликов (FIX-3)", () => {
  test("действия распознаются по id, посторонние — нет", () => {
    expect(clickActionFor("ds-apply")).toBe("apply-range");
    expect(clickActionFor("ds-reset")).toBe("reset-range");
    expect(clickActionFor("ds-page-prev")).toBe("page-prev");
    expect(clickActionFor("ds-page-next")).toBe("page-next");
    expect(clickActionFor("ds-unknown")).toBeNull();
    expect(clickActionFor(null)).toBeNull();
    expect(clickActionFor(undefined)).toBeNull();
  });


});

describe("FINAL-3.3.2.1-HARDENING: обработка исключений (FIX-4)", () => {
  test("исключения любого типа дают безопасный error-результат", () => {
    for (const thrown of [null, undefined, "строка", 42, new Error("boom"), { code: "X", message: "y" }]) {
      const result = toErrorResult(thrown);
      expect(result.status).toBe("error");
      if (result.status !== "error") continue;
      expect(typeof result.error.code).toBe("string");
      expect(result.error.code.length).toBeGreaterThan(0);
      expect(typeof result.error.message).toBe("string");
      expect(result.error.message.length).toBeGreaterThan(0);
      expect(result.error.message).not.toBe("undefined");
      expect(result.error.eventId.startsWith("client-")).toBe(true);
      expect(result.error.message.length).toBeLessThanOrEqual(200);
    }
  });

  test("уникальность eventId и обрезка длинного сообщения", () => {
    const first = toErrorResult(new Error("a"));
    const second = toErrorResult(new Error("a"));
    if (first.status === "error" && second.status === "error") expect(first.error.eventId).not.toBe(second.error.eventId);
    const long = toErrorResult(new Error("x".repeat(500)));
    if (long.status === "error") expect(long.error.message.length).toBe(200);
  });
});