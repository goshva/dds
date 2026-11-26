/** UI-2: маршруты API. Только GET; бизнес-записи отсутствуют. */
import { Hono } from "hono";

import { fail, notAvailable, ok, SourceError } from "./api";
import { coverageModel, historyModel, monitorModel, overviewModel, reconciliationsModel, shadowForecastsModel } from "./services/read-models";
import { forecastErrorsModel, forecastsListModel, forecastsQualityModel, parseEvaluationHorizon, parseEvaluationMode, parseOptionalBoolean, parseOptionalModel } from "./services/forecasting-read-models";

export const apiRoutes = new Hono();

apiRoutes.get("/api/health", (context) =>
  context.json(ok({ service: "dss-api", readOnly: true, version: "ui-2" }, "process")),
);

apiRoutes.get("/api/v1/overview", async (context) => {
  try {
    const model = await overviewModel();
    // R5: meta.checksum — checksum исходного CSV; нормализованный — в data.provenance
    return context.json(ok(model, "canonical_csv+shadow_jsonl", { checksum: model.provenance.fileChecksum, note: `freshness=${model.provenance.freshness}` }));
  } catch (error) {
    return fail(context, error);
  }
});

apiRoutes.get("/api/v1/history", async (context) => {
  try {
    const query = context.req.query();
    const { model, checksum, fileChecksum } = await historyModel(query);
    if (!model.returnedPoints) return context.json(notAvailable("NO_POINTS_IN_RANGE", "canonical_csv"));
    // R5: checksum исходного файла и нормализованных точек различаются явно
    return context.json(ok(model, "canonical_csv", { checksum: fileChecksum, note: `normalized=${checksum}` }));
  } catch (error) {
    return fail(context, error);
  }
});

apiRoutes.get("/api/v1/history/coverage", async (context) => {
  try {
    const model = await coverageModel();
    if (!model.days) return context.json(notAvailable("SOURCE_EMPTY", "canonical_csv"));
    return context.json(ok(model, "canonical_csv"));
  } catch (error) {
    return fail(context, error);
  }
});

apiRoutes.get("/api/v1/shadow/forecasts", async (context) => {
  try {
    const model = await shadowForecastsModel(context.req.query());
    if (!model.totals.snapshots) return context.json(notAvailable("SHADOW_STORE_EMPTY", "shadow_jsonl"));
    return context.json(ok(model, "shadow_jsonl", { checksum: model.checksums.forecasts ?? "NOT_AVAILABLE" }));
  } catch (error) {
    return fail(context, error);
  }
});

apiRoutes.get("/api/v1/shadow/reconciliations", async (context) => {
  try {
    const model = await reconciliationsModel(context.req.query());
    if (!model.total) return context.json(notAvailable("NO_RECONCILIATIONS", `shadow_jsonl:${model.mode}`));
    return context.json(ok(model, "shadow_jsonl"));
  } catch (error) {
    return fail(context, error);
  }
});

apiRoutes.get("/api/v1/shadow/monitor", async (context) => {
  try {
    const model = await monitorModel();
    if (!model.forecasts) return context.json(notAvailable("SHADOW_STORE_EMPTY", "shadow_jsonl"));
    return context.json(ok(model, "shadow_jsonl"));
  } catch (error) {
    return fail(context, error);
  }
});

apiRoutes.get("/api/v1/forecasts/quality", async (context) => {
  try {
    const query = context.req.query();
    const mode = parseEvaluationMode(query.mode);
    const horizon = parseEvaluationHorizon(query.horizon);
    const paired = parseOptionalBoolean(query.paired, "paired");
    const model = await forecastsQualityModel({ mode, horizon, paired });
    if (!model.availability.available) return context.json(notAvailable(model.availability.reason ?? "NOT_AVAILABLE", `shadow_jsonl:${mode}:h${horizon}`));
    return context.json(ok(model, "shadow_jsonl+canonical_csv", { checksum: model.provenance.shadowFileChecksums.forecasts ?? "NOT_AVAILABLE", note: `interpretability=${model.interpretabilityStatus}` }));
  } catch (error) {
    return fail(context, error);
  }
});

apiRoutes.get("/api/v1/forecasts", async (context) => {
  try {
    const query = context.req.query();
    const mode = parseEvaluationMode(query.mode);
    const horizon = parseEvaluationHorizon(query.horizon);
    const model = parseOptionalModel(query.model);
    const limit = query.limit === undefined ? undefined : Number(query.limit);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 1000)) throw new SourceError("INVALID_QUERY", "limit must be an integer between 1 and 1000", 400);
    const result = await forecastsListModel({ mode, horizon, model, limit });
    if (!result.total) return context.json(notAvailable("NO_RECORDS_FOR_MODE_AND_HORIZON", `shadow_jsonl:${mode}:h${horizon}`));
    return context.json(ok(result, "shadow_jsonl", { checksum: result.provenance.shadowFileChecksums.forecasts ?? "NOT_AVAILABLE" }));
  } catch (error) {
    return fail(context, error);
  }
});

apiRoutes.get("/api/v1/forecasts/errors", async (context) => {
  try {
    const query = context.req.query();
    const mode = parseEvaluationMode(query.mode);
    const limit = query.limit === undefined ? undefined : Number(query.limit);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 1000)) throw new SourceError("INVALID_QUERY", "limit must be an integer between 1 and 1000", 400);
    const result = await forecastErrorsModel({ mode, code: query.code, limit });
    // errors.jsonl отсутствует: отсутствие файла не означает отсутствие ошибок
    if (!result.total) return context.json(notAvailable("NO_DETECTED_DIAGNOSTICS", `shadow_jsonl:${mode}`));
    return context.json(ok(result, "shadow_jsonl", { note: "persisted errors unavailable; detected diagnostics only" }));
  } catch (error) {
    return fail(context, error);
  }
});
/** Любые изменяющие методы для бизнес-ресурсов запрещены. */
for (const method of ["post", "put", "patch", "delete"] as const) {
  apiRoutes[method]("/api/*", (context) => {
    const eventId = crypto.randomUUID();
    console.error(`[dss-api] code=METHOD_NOT_ALLOWED event=${eventId}`);
    return context.json({ status: "error", error: { code: "METHOD_NOT_ALLOWED", message: "Only GET is supported", eventId } }, 405);
  });
}