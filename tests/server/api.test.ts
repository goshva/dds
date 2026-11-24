// UI-2: контрактные тесты read-only API (app.request, без сети).
import { describe, expect, test } from "bun:test";
import { app } from "../../src/server/app";

async function get(path: string) {
  const response = await app.request(`http://127.0.0.1${path}`);
  return { status: response.status, body: (await response.json()) as any };
}

describe("health и методы", () => {
  test("health: ok, readOnly, generatedAt", async () => {
    const { status, body } = await get("/api/health");
    expect(status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.meta.readOnly).toBe(true);
    expect(typeof body.meta.generatedAt).toBe("string");
  });
  test("404 без stack trace и без путей", async () => {
    const { status, body } = await get("/api/v1/unknown");
    expect(status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(JSON.stringify(body)).not.toContain("at ");
  });
  test("POST/PUT/PATCH/DELETE запрещены", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await app.request("http://127.0.0.1/api/v1/history", { method });
      expect(response.status, method).toBe(405);
    }
  });
});

describe("источники (read-only)", () => {
  test("overview: реальные данные, без PII/путей/SQL", async () => {
    const { status, body } = await get("/api/v1/overview");
    expect(status).toBe(200);
    expect(body.data.shopNo).toBe("7745");
    expect(body.data.timezone).toBe("Europe/Moscow");
    expect(body.data.metric).toBe("qty_orders_delivered");
    expect(body.data.sliceId).toBe(20624);
    expect(body.data.semantics).toBe("PROVISIONAL");
    expect(body.data.history.days).toBeGreaterThan(900);
    expect(body.data.history.lastValue).toBeGreaterThan(0);
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("dimension_1");
    expect(raw).not.toContain("SELECT");
    expect(raw).not.toContain("forecasting.sqlite");
    expect(raw).not.toMatch(/[A-Za-z]:\\\\/);
  });
  test("history: limit, отсутствие нулей, пустой диапазон → not_available", async () => {
    const { body } = await get("/api/v1/history?limit=5");
    expect(body.data.returnedPoints).toBe(5);
    expect(body.data.points.every((point: any) => Number.isFinite(point.value))).toBe(true);
    // UI-3.1: полностью непересекающийся диапазон отклоняется, а не маскируется под пустой
    const outOfBounds = await get("/api/v1/history?from=2030-01-01&to=2030-01-02");
    expect(outOfBounds.status).toBe(400);
    expect(outOfBounds.body.error.code).toBe("RANGE_OUT_OF_BOUNDS");
  });
  test("history: некорректные параметры → 400 INVALID_QUERY", async () => {
    for (const query of ["limit=0", "limit=99999", "limit=abc", "from=24-11-2026", "from=2026-11-24&to=2026-01-01"]) {
      const { status, body } = await get(`/api/v1/history?${query}`);
      expect(status, query).toBe(400);
      expect(body.error.code).toBe("INVALID_QUERY");
    }
  });
  test("coverage: полнота без фиктивных значений", async () => {
    const { body } = await get("/api/v1/history/coverage");
    expect(body.data.gaps).toBe(0);
    expect(body.data.duplicateDates).toBe(0);
    expect(body.data.completeness).toBe("COMPLETE");
  });
  test("shadow forecasts: replay/shadow разделены, horizon валидируется", async () => {
    const { body } = await get("/api/v1/shadow/forecasts?limit=10");
    expect(body.data.totals.snapshots).toBeGreaterThan(0);
    expect(body.data.modeTotals.replay.snapshots).toBeGreaterThan(0);
    expect(body.data.items.every((item: any) => item.mode === "shadow")).toBe(true);
    expect(body.data.horizons).toEqual([1, 3]);
    expect((await get("/api/v1/shadow/forecasts?horizon=7")).status).toBe(400);
  });
  test("reconciliations и monitor читаются", async () => {
    const reconciliations = await get("/api/v1/shadow/reconciliations?limit=5");
    expect(reconciliations.status).toBe(200);
    expect(reconciliations.body.data.items.length).toBeGreaterThan(0);
    const monitor = await get("/api/v1/shadow/monitor");
    expect(monitor.status).toBe(200);
    expect(monitor.body.data.forecasts).toBeGreaterThan(0);
    expect(Array.isArray(monitor.body.data.metrics)).toBe(true);
  });
});
describe("UI-2.1: Host и Origin (DNS rebinding, посторонние страницы)", () => {
  test("чужой Host отклоняется (403)", async () => {
    const response = await app.request("http://127.0.0.1/api/health", { headers: { Host: "evil.example.com" } });
    expect(response.status).toBe(403);
    const body = (await response.json()) as any;
    expect(body.error.code).toBe("HOST_NOT_ALLOWED");
  });

  test("Host без порта и с портом разрешён", async () => {
    for (const host of ["127.0.0.1", "127.0.0.1:8787", "localhost:8787"]) {
      const response = await app.request("http://127.0.0.1/api/health", { headers: { Host: host } });
      expect(response.status, host).toBe(200);
    }
  });

  test("посторонний Origin отклоняется, Vite origin разрешён", async () => {
    const blocked = await app.request("http://127.0.0.1/api/health", { headers: { Host: "127.0.0.1:8787", Origin: "https://evil.example.com" } });
    expect(blocked.status).toBe(403);
    const allowed = await app.request("http://127.0.0.1/api/health", { headers: { Host: "127.0.0.1:8787", Origin: "http://127.0.0.1:5173" } });
    expect(allowed.status).toBe(200);
  });

  test("запрос без Origin (curl/тесты) разрешён", async () => {
    const response = await app.request("http://127.0.0.1/api/v1/overview", { headers: { Host: "127.0.0.1:8787" } });
    expect(response.status).toBe(200);
  });
});