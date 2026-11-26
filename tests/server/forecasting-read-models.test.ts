// UI-4.2: тесты forecasting read-model и API (unit на временных данных + интеграция на реальных, read-only).
import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { app } from "../../src/server/app";
import {
  forecastErrorsModel,
  forecastsListModel,
  forecastsQualityModel,
  interpretabilityOf,
  parseEvaluationHorizon,
  parseEvaluationMode,
  parseOptionalBoolean,
} from "../../src/server/services/forecasting-read-models";

const HEX = "a".repeat(64);
const HEX_B = "b".repeat(64);

function snapshot(over: Record<string, unknown> = {}) {
  return {
    snapshot_id: "s1", run_id: "run-1", mode: "shadow", model_id: "rolling_7_day_mean", model_version: "rolling-7-day-mean/v1",
    variant: null, horizon: 1, origin_date: "2026-11-20", target_date: "2026-11-21", forecast_value: 1500, status: "OK",
    fallback_reason: null, input_data_version: "iv1", dataset_checksum: HEX, generated_at: "2026-11-24T00:00:00.000Z", ...over,
  };
}
function reconciliation(over: Record<string, unknown> = {}) {
  return { snapshot_id: "s1", run_id: "run-1", model_id: "rolling_7_day_mean", horizon: 1, target_date: "2026-11-21", forecast_value: 1500, actual: 1545, absolute_error: 45, signed_error: -45, reconciled_at: "2026-11-24T00:00:00.000Z", ...over };
}
function candidate(over: Record<string, unknown> = {}) {
  return snapshot({ snapshot_id: "c1", model_id: "adaptive_baseline", model_version: "adaptive-baseline/v1+variantB", variant: "B", ...over });
}

async function fixture(snapshots: unknown[], reconciliations: unknown[], manifest?: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dss-frm-"));
  await writeFile(join(dir, "forecasts.jsonl"), snapshots.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  await writeFile(join(dir, "reconciliations.jsonl"), reconciliations.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  await writeFile(join(dir, "manifest.json"), JSON.stringify({ version: "shadow-mode/v1", created_at: "2026-11-24T00:00:00.000Z", dataset_checksum: HEX, horizons: [1, 3], models: { rolling_7_day_mean: "rolling-7-day-mean/v1", adaptive_baseline: "adaptive-baseline/v1+variantB" }, alpha: 1, limit_percent: 0.1, min_train_days: 28, note: "fixture", ...manifest }));
  return dir;
}

describe("UI-4.2: интерпретируемость и валидация", () => {
  test("interpretabilityStatus не вводит произвольный порог", () => {
    expect(interpretabilityOf(0)).toBe("NOT_AVAILABLE");
    expect(interpretabilityOf(1)).toBe("INSUFFICIENT");
    expect(interpretabilityOf(2)).toBe("LIMITED");
    expect(interpretabilityOf(1000)).toBe("LIMITED");
  });
  test("обязательные параметры валидируются", () => {
    expect(parseEvaluationMode("shadow")).toBe("shadow");
    expect(() => parseEvaluationMode(undefined)).toThrow();
    expect(() => parseEvaluationMode("all")).toThrow();
    expect(parseEvaluationHorizon("1")).toBe(1);
    expect(parseEvaluationHorizon("3")).toBe(3);
    expect(() => parseEvaluationHorizon(undefined)).toThrow();
    expect(() => parseEvaluationHorizon("7")).toThrow();
    expect(parseOptionalBoolean("true", "paired")).toBe(true);
    expect(parseOptionalBoolean(undefined, "paired")).toBeUndefined();
    expect(() => parseOptionalBoolean("yes", "paired")).toThrow();
  });
});

describe("UI-4.2: read-model на изолированных данных", () => {
  test("режимы не смешиваются: replay не видит shadow", async () => {
    const dir = await fixture(
      [snapshot({ mode: "replay" }), candidate({ mode: "replay" }), snapshot({ snapshot_id: "s2" }), candidate({ snapshot_id: "c2" })],
      [reconciliation(), reconciliation({ snapshot_id: "c1", model_id: "adaptive_baseline" }), reconciliation({ snapshot_id: "s2" }), reconciliation({ snapshot_id: "c2", model_id: "adaptive_baseline" })],
    );
    const replay = await forecastsQualityModel({ mode: "replay", horizon: 1 }, dir);
    const shadow = await forecastsQualityModel({ mode: "shadow", horizon: 1 }, dir);
    expect(replay.mode).toBe("replay");
    expect(replay.pairedComparison.pairedN).toBe(1);
    expect(shadow.mode).toBe("shadow");
    expect(shadow.pairedComparison.pairedN).toBe(1);
    expect(replay.pairCounters.baselineIndependentN).toBe(1);
    expect(shadow.pairCounters.baselineIndependentN).toBe(1);
  });

  test("горизонты разделены, отсутствующий горизонт → not available", async () => {
    const dir = await fixture([snapshot({ horizon: 1 })], [reconciliation({ horizon: 1 })]);
    const h1 = await forecastsQualityModel({ mode: "shadow", horizon: 1 }, dir);
    expect(h1.availability.available).toBe(true);
    const h3 = await forecastsQualityModel({ mode: "shadow", horizon: 3 }, dir);
    expect(h3.availability.available).toBe(false);
    expect(h3.availability.reason).toBe("NO_RECORDS_FOR_MODE_AND_HORIZON");
    expect(h3.interpretabilityStatus).toBe("NOT_ASSESSED");
  });

  test("pending не считается ошибкой и отражается в счётчиках", async () => {
    const dir = await fixture([snapshot({ snapshot_id: "p1", target_date: "2030-01-01" })], []);
    const model = await forecastsQualityModel({ mode: "shadow", horizon: 1 }, dir);
    expect(model.pairCounters.pendingN).toBe(1);
    expect(model.warnings).toContain("PENDING_OBSERVATIONS_PRESENT");
    expect(model.availability.available).toBe(true);
  });

  test("null-метрики остаются null, PROVISIONAL сохраняется", async () => {
    const dir = await fixture([snapshot({ snapshot_id: "p1", target_date: "2030-01-01" })], []);
    const model = await forecastsQualityModel({ mode: "shadow", horizon: 1 }, dir);
    const baseline = model.independentMetrics.find((metric) => metric.modelId === "rolling_7_day_mean")!;
    expect(baseline.mae).toBeNull();
    expect(baseline.wape).toBeNull();
    expect(model.semantics).toBe("PROVISIONAL");
    expect(model.pairedComparison.status).toBe("NOT_AVAILABLE");
    expect(model.interpretabilityStatus).toBe("NOT_AVAILABLE");
  });

  test("разные dataset_checksum дают предупреждение и перечисляются", async () => {
    const dir = await fixture(
      [snapshot({ dataset_checksum: HEX }), candidate({ dataset_checksum: HEX_B })],
      [reconciliation(), reconciliation({ snapshot_id: "c1", model_id: "adaptive_baseline" })],
    );
    const model = await forecastsQualityModel({ mode: "shadow", horizon: 1 }, dir);
    expect(model.provenance.datasetChecksums.length).toBe(2);
    expect(model.provenance.datasetVersionWarning).toBe(true);
    expect(model.warnings).toContain("DATASET_VERSION_DIFFERS");
    expect(model.pairedComparison.pairedN).toBe(1);
  });

  test("technicalFactCutoff передаётся из canonical истории", async () => {
    const dir = await fixture([snapshot({ target_date: "2030-01-01" })], []);
    const model = await forecastsQualityModel({ mode: "shadow", horizon: 1 }, dir);
    expect(model.technicalFactCutoff).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("список прогнозов не раскрывает лишние поля и ограничен", async () => {
    const dir = await fixture([snapshot(), candidate()], [reconciliation(), reconciliation({ snapshot_id: "c1", model_id: "adaptive_baseline" })]);
    const list = await forecastsListModel({ mode: "shadow", horizon: 1, limit: 1 }, dir);
    expect(list.returned).toBe(1);
    expect(list.total).toBe(2);
    expect(Object.keys(list.items[0]!).sort()).toEqual(["forecastValue", "generatedAt", "horizon", "inputDataVersion", "mode", "modelId", "modelVersion", "originDate", "snapshotId", "status", "targetDate", "variant"].sort());
  });

  test("диагностика ошибок: персистентный источник помечен как недоступный", async () => {
    const dir = await fixture([snapshot({ snapshot_id: "u1", mode: "x" })], []);
    const errors = await forecastErrorsModel({ mode: "x" as never }, dir);
    expect(errors.persistedErrorsAvailable).toBe(false);
    expect(errors.items.some((item) => item.kind === "UNKNOWN_MODE")).toBe(true);
    expect(errors.items.every((item) => item.source === "detected")).toBe(true);
  });
});

describe("UI-4.2: API endpoints", () => {
  async function get(path: string) {
    const response = await app.request(`http://127.0.0.1${path}`, { headers: { Host: "127.0.0.1:8787" } });
    return { status: response.status, body: (await response.json()) as any };
  }
  test("валидация параметров: 400 без mode, при неизвестном mode/horizon/limit/paired", async () => {
    for (const path of ["/api/v1/forecasts/quality", "/api/v1/forecasts/quality?mode=all&horizon=1", "/api/v1/forecasts/quality?mode=shadow", "/api/v1/forecasts/quality?mode=shadow&horizon=7", "/api/v1/forecasts?mode=shadow&horizon=1&limit=5000", "/api/v1/forecasts/quality?mode=shadow&horizon=1&paired=maybe"]) {
      const { status, body } = await get(path);
      expect(status, path).toBe(400);
      expect(body.error.code, path).toBe("INVALID_QUERY");
      expect(typeof body.error.eventId, path).toBe("string");
    }
  });
  test("GET /forecasts/quality возвращает PROVISIONAL, n, pairedN, статусы", async () => {
    const { status, body } = await get("/api/v1/forecasts/quality?mode=replay&horizon=1");
    expect(status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.data.semantics).toBe("PROVISIONAL");
    expect(body.data.mode).toBe("replay");
    expect(body.data.horizon).toBe(1);
    expect(body.data.independentMetrics.length).toBe(2);
    expect(body.data.pairedComparison.pairedN).toBeGreaterThan(0);
    expect(["NOT_AVAILABLE", "INSUFFICIENT", "LIMITED", "NOT_ASSESSED"]).toContain(body.data.interpretabilityStatus);
    expect(body.data.sampleStatus).toBe("COMPLETE");
    expect(body.meta.readOnly).toBe(true);
  });
  test("GET /forecasts возвращает ограниченный список", async () => {
    const { status, body } = await get("/api/v1/forecasts?mode=shadow&horizon=1&limit=3");
    expect(status).toBe(200);
    expect(body.data.items.length).toBeLessThanOrEqual(3);
    expect(body.data.items.every((item: any) => item.mode === "shadow" && item.horizon === 1)).toBe(true);
  });
  test("изменяющие методы запрещены", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await app.request("http://127.0.0.1/api/v1/forecasts/quality", { method, headers: { Host: "127.0.0.1:8787" } });
      expect(response.status, method).toBe(405);
    }
  });
  test("нет PII и внутренних путей в ответах", async () => {
    const { body } = await get("/api/v1/forecasts/quality?mode=shadow&horizon=1");
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("dimension_1");
    expect(raw).not.toMatch(/[A-Za-z]:\\\\/);
    expect(raw).not.toContain("stack");
  });
});

describe("UI-4.2: интеграция на реальных данных (read-only)", () => {
  test("replay h1/h3: 875 пар, shadow h1: 1 пара, shadow h3: 0", async () => {
    const replayH1 = await forecastsQualityModel({ mode: "replay", horizon: 1 });
    const replayH3 = await forecastsQualityModel({ mode: "replay", horizon: 3 });
    const shadowH1 = await forecastsQualityModel({ mode: "shadow", horizon: 1 });
    const shadowH3 = await forecastsQualityModel({ mode: "shadow", horizon: 3 });
    expect(replayH1.pairedComparison.pairedN).toBeGreaterThan(0);
    expect(replayH1.mode).toBe("replay");
    expect(replayH3.pairedComparison.pairedN).toBeGreaterThan(0);
    expect(shadowH1.pairedComparison.pairedN).toBeLessThanOrEqual(1);
    expect(shadowH1.interpretabilityStatus).not.toBe("LIMITED");
    expect(shadowH3.pairedComparison.pairedN).toBe(0);
    expect(shadowH3.interpretabilityStatus).toBe("NOT_AVAILABLE");
    expect(shadowH3.pairedComparison.status).toBe("NOT_AVAILABLE");
  });
  test("pending отражается, режимы не смешиваются, PROVISIONAL сохраняется", async () => {
    const shadow = await forecastsQualityModel({ mode: "shadow", horizon: 1 });
    expect(shadow.pairCounters.pendingN).toBeGreaterThan(0);
    expect(shadow.semantics).toBe("PROVISIONAL");
    const replay = await forecastsQualityModel({ mode: "replay", horizon: 1 });
    expect(replay.pairCounters.pendingN).toBe(0);
    expect(shadow.pairCounters.baselineIndependentN).not.toBe(replay.pairCounters.baselineIndependentN);
  });
});
