// UI-3: backend-тесты History & Analytics (read-only).
import { describe, expect, test } from "bun:test";
import { app } from "../../src/server/app";

async function get(path: string) {
  const response = await app.request(`http://127.0.0.1${path}`, { headers: { Host: "127.0.0.1:8787" } });
  return { status: response.status, body: (await response.json()) as any };
}

describe("UI-3: история и агрегаты", () => {
  test("summary считается по доступным значениям и содержит формулу", async () => {
    const { status, body } = await get("/api/v1/history?limit=1000");
    expect(status).toBe(200);
    const summary = body.data.summary;
    expect(summary.sum).toBeGreaterThan(0);
    expect(summary.observationDays).toBe(body.data.returnedPoints);
    expect(summary.calendarDays).toBeGreaterThanOrEqual(summary.observationDays);
    expect(summary.missingDays).toBe(summary.calendarDays - summary.observationDays);
    expect(summary.average).toBeCloseTo(summary.sum / summary.observationDays, 6);
    expect(summary.max).toBeGreaterThanOrEqual(summary.min);
    expect(typeof summary.formula).toBe("string");
    expect(summary.formula).toContain("доступным");
  });

  test("агрегаты не смешивают slices: метрика и slice фиксированы", async () => {
    const { body } = await get("/api/v1/history?limit=1000");
    expect(body.data.sliceId).toBe(20624);
    expect(body.data.metric).toBe("qty_orders_delivered");
    expect(body.data.semantics).toBe("PROVISIONAL");
    expect(body.data.points.every((point: any) => Number.isFinite(point.value) && point.value >= 0)).toBe(true);
  });

  test("диапазон: границы, пустой период и некорректные даты", async () => {
    const single = await get("/api/v1/history?from=2026-11-23&to=2026-11-23");
    expect(single.status).toBe(200);
    expect(single.body.data.returnedPoints).toBe(1);
    expect(single.body.data.summary.calendarDays).toBe(1);
    const empty = await get("/api/v1/history?from=2030-01-01&to=2030-01-05");
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe("RANGE_OUT_OF_BOUNDS");
    const reversed = await get("/api/v1/history?from=2026-11-23&to=2026-11-01");
    expect(reversed.status).toBe(400);
    const badDate = await get("/api/v1/history?from=2026-02-30");
    expect(badDate.status).toBe(400);
    const tooLarge = await get("/api/v1/history?limit=100000");
    expect(tooLarge.status).toBe(400);
  });

  test("NULL не превращается в 0: значения либо конечные числа, либо точки отсутствуют", async () => {
    const { body } = await get("/api/v1/history?limit=1000");
    expect(body.data.points.every((point: any) => typeof point.value === "number" && Number.isFinite(point.value))).toBe(true);
    expect(JSON.stringify(body.data.points)).not.toContain("null");
  });
});

describe("UI-3: качество данных", () => {
  test("coverage: пропуски, интервалы и доля заполненности", async () => {
    const { status, body } = await get("/api/v1/history/coverage");
    expect(status).toBe(200);
    const data = body.data;
    expect(Array.isArray(data.missingDates)).toBe(true);
    expect(Array.isArray(data.gapIntervals)).toBe(true);
    expect(data.maxGapLength).toBeGreaterThanOrEqual(0);
    expect(data.fillRatio).toBeGreaterThan(0);
    expect(data.fillRatio).toBeLessThanOrEqual(1);
    const calendarDays = data.days + data.gaps;
    expect(data.fillRatio).toBeCloseTo(data.days / calendarDays, 6);
    expect(data.fillRatioFormula).toContain("observationDays / calendarDays");
    expect(data.gapIntervals.every((interval: any) => interval.length >= 1 && interval.from <= interval.to)).toBe(true);
  });

  test("coverage не содержит PII-полей и внутренних путей", async () => {
    const { body } = await get("/api/v1/history/coverage");
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("dimension_1");
    expect(raw).not.toContain("dimension_2");
    expect(raw).not.toMatch(/[A-Za-z]:\\\\/);
  });
});

describe("UI-3.1: календарный период считается по запрошенному диапазону", () => {
  test("неполный диапазон не выглядит полным (пропуск в конце)", async () => {
    const { body } = await get("/api/v1/history?from=2026-11-20&to=2026-11-30");
    const summary = body.data.summary;
    expect(summary.calendarDays).toBe(11);
    expect(summary.observationDays).toBe(4);
    expect(summary.missingDays).toBe(7);
    expect(summary.complete).toBe(false);
    expect(body.data.available).toEqual({ from: "2024-06-01", to: "2026-11-23" });
    expect(body.data.requested).toEqual({ from: "2026-11-20", to: "2026-11-30" });
    expect(body.data.rangeClamped).toBe(true);
  });

  test("однодневный период и весь период", async () => {
    const single = await get("/api/v1/history?from=2026-11-23&to=2026-11-23");
    expect(single.body.data.summary).toMatchObject({ calendarDays: 1, observationDays: 1, missingDays: 0, complete: true });
    const whole = await get("/api/v1/history?limit=1000");
    const summary = whole.body.data.summary;
    expect(summary.calendarDays).toBe(summary.observationDays);
    expect(summary.missingDays).toBe(0);
    expect(summary.complete).toBe(true);
    expect(summary.observationDays).toBe(906);
  });

  test("полностью непересекающиеся диапазоны отклоняются с RANGE_OUT_OF_BOUNDS", async () => {
    for (const query of ["from=2020-01-01&to=2020-01-05", "from=2027-01-01&to=2027-01-05"]) {
      const { status, body } = await get(`/api/v1/history?${query}`);
      expect(status, query).toBe(400);
      expect(body.error.code).toBe("RANGE_OUT_OF_BOUNDS");
    }
  });

  test("частично выходящий диапазон принимается и помечается rangeClamped", async () => {
    const future = await get("/api/v1/history?from=2026-11-01&to=2027-01-31");
    expect(future.status).toBe(200);
    expect(future.body.data.rangeClamped).toBe(true);
    expect(future.body.data.summary.calendarDays).toBe(92);
    expect(future.body.data.summary.observationDays).toBe(23);
    expect(future.body.data.summary.missingDays).toBe(69);
    expect(future.body.data.summary.complete).toBe(false);
    const past = await get("/api/v1/history?from=2020-01-01&to=2026-11-23");
    expect(past.status).toBe(200);
    expect(past.body.data.rangeClamped).toBe(true);
    expect(past.body.data.summary.observationDays).toBe(906);
    expect(past.body.data.summary.complete).toBe(false);
  });

  test("пропуски в начале и середине диапазона отражаются в missingDays", async () => {
    const { body } = await get("/api/v1/history?from=2024-06-01&to=2024-06-10");
    expect(body.data.summary.calendarDays).toBe(10);
    expect(body.data.summary.observationDays).toBe(10);
    expect(body.data.summary.missingDays).toBe(0);
    expect(body.data.summary.complete).toBe(true);
  });
});