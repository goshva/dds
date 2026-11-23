/** Реализация {@link ForecastRepository} на SQLite: запуски, результаты, оценки точности, сценарии. */

import type { Database } from "bun:sqlite";

import type { ForecastRepository } from "../../interfaces/repositories";
import type {
  ForecastEvaluationRow,
  ForecastResultRow,
  ForecastRunRow,
  NewForecastRun,
  ScenarioResultRow,
  ScenarioRow,
  UpsertCounts,
} from "../../interfaces/types";
import { inTransactionOrNew, lastInsertId } from "./helpers";

export class SqliteForecastRepository implements ForecastRepository {
  constructor(private readonly db: Database) {}

  createRun(input: NewForecastRun): number {
    const info = this.db
      .query(
        `INSERT INTO forecast_runs
           (shop_no, created_at, horizon_days, model_name, model_version, target_metric, features_version, input_snapshot_id, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.shop_no,
        input.created_at,
        input.horizon_days,
        input.model_name,
        input.model_version,
        input.target_metric,
        input.features_version ?? null,
        input.input_snapshot_id ?? null,
        input.status,
        input.notes ?? null,
      );
    return lastInsertId(info);
  }

  getRun(runId: number): ForecastRunRow | null {
    return (this.db.query("SELECT * FROM forecast_runs WHERE run_id = ?").get(runId) as ForecastRunRow | null) ?? null;
  }

  listRuns(shopNo: string, limit = 50): ForecastRunRow[] {
    return this.db
      .query("SELECT * FROM forecast_runs WHERE shop_no = ? ORDER BY created_at DESC, run_id DESC LIMIT ?")
      .all(shopNo, limit) as ForecastRunRow[];
  }

  saveResults(runId: number, rows: ForecastResultRow[]): UpsertCounts {
    const counts: UpsertCounts = { inserted: 0, updated: 0 };
    if (!rows.length) return counts;

    const find = this.db.query("SELECT result_id FROM forecast_results WHERE run_id = ? AND target_date = ? AND metric = ?");
    const insert = this.db.query(
      `INSERT INTO forecast_results
         (run_id, target_date, metric, p10, p50, p90, optimistic, baseline, pessimistic, confidence_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const update = this.db.query(
      `UPDATE forecast_results SET p10 = ?, p50 = ?, p90 = ?, optimistic = ?, baseline = ?, pessimistic = ?, confidence_status = ?
        WHERE run_id = ? AND target_date = ? AND metric = ?`,
    );

    inTransactionOrNew(this.db, () => {
      for (const row of rows) {
        const existing = find.get(runId, row.target_date, row.metric) as { result_id: number } | null;
        if (existing) {
          update.run(
            row.p10 ?? null,
            row.p50 ?? null,
            row.p90 ?? null,
            row.optimistic ?? null,
            row.baseline ?? null,
            row.pessimistic ?? null,
            row.confidence_status,
            runId,
            row.target_date,
            row.metric,
          );
          counts.updated++;
        } else {
          insert.run(
            runId,
            row.target_date,
            row.metric,
            row.p10 ?? null,
            row.p50 ?? null,
            row.p90 ?? null,
            row.optimistic ?? null,
            row.baseline ?? null,
            row.pessimistic ?? null,
            row.confidence_status,
          );
          counts.inserted++;
        }
      }
    });

    return counts;
  }

  getResults(runId: number): ForecastResultRow[] {
    return this.db
      .query("SELECT * FROM forecast_results WHERE run_id = ? ORDER BY target_date, metric")
      .all(runId) as ForecastResultRow[];
  }

  saveEvaluations(runId: number, rows: ForecastEvaluationRow[]): UpsertCounts {
    const counts: UpsertCounts = { inserted: 0, updated: 0 };
    if (!rows.length) return counts;

    const find = this.db.query("SELECT eval_id FROM forecast_evaluations WHERE run_id = ? AND target_date = ? AND metric = ?");
    const insert = this.db.query(
      `INSERT INTO forecast_evaluations
         (run_id, target_date, metric, actual_value, predicted_value, absolute_error, percentage_error, model_version, evaluated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const update = this.db.query(
      `UPDATE forecast_evaluations SET actual_value = ?, predicted_value = ?, absolute_error = ?, percentage_error = ?, model_version = ?, evaluated_at = ?
        WHERE run_id = ? AND target_date = ? AND metric = ?`,
    );

    inTransactionOrNew(this.db, () => {
      for (const row of rows) {
        const existing = find.get(runId, row.target_date, row.metric) as { eval_id: number } | null;
        if (existing) {
          update.run(
            row.actual_value ?? null,
            row.predicted_value ?? null,
            row.absolute_error ?? null,
            row.percentage_error ?? null,
            row.model_version ?? null,
            row.evaluated_at,
            runId,
            row.target_date,
            row.metric,
          );
          counts.updated++;
        } else {
          insert.run(
            runId,
            row.target_date,
            row.metric,
            row.actual_value ?? null,
            row.predicted_value ?? null,
            row.absolute_error ?? null,
            row.percentage_error ?? null,
            row.model_version ?? null,
            row.evaluated_at,
          );
          counts.inserted++;
        }
      }
    });

    return counts;
  }

  getEvaluations(runId: number): ForecastEvaluationRow[] {
    return this.db
      .query("SELECT * FROM forecast_evaluations WHERE run_id = ? ORDER BY target_date, metric")
      .all(runId) as ForecastEvaluationRow[];
  }

  createScenario(row: ScenarioRow): number {
    const info = this.db
      .query(
        `INSERT INTO scenarios (shop_no, created_at, name, kind, input_parameters, assumptions, data_status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.shop_no,
        row.created_at,
        row.name,
        row.kind,
        row.input_parameters ?? null,
        row.assumptions ?? null,
        row.data_status,
      );
    return lastInsertId(info);
  }

  getScenario(scenarioId: number): ScenarioRow | null {
    return (this.db.query("SELECT * FROM scenarios WHERE scenario_id = ?").get(scenarioId) as ScenarioRow | null) ?? null;
  }

  saveScenarioResults(scenarioId: number, rows: ScenarioResultRow[]): UpsertCounts {
    const counts: UpsertCounts = { inserted: 0, updated: 0 };
    if (!rows.length) return counts;

    const find = this.db.query("SELECT scenario_result_id FROM scenario_results WHERE scenario_id = ? AND target_date = ? AND metric = ?");
    const insert = this.db.query(
      `INSERT INTO scenario_results (scenario_id, target_date, metric, value, capacity_required, capacity_available, deficit)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const update = this.db.query(
      `UPDATE scenario_results SET value = ?, capacity_required = ?, capacity_available = ?, deficit = ?
        WHERE scenario_id = ? AND target_date = ? AND metric = ?`,
    );

    inTransactionOrNew(this.db, () => {
      for (const row of rows) {
        const existing = find.get(scenarioId, row.target_date, row.metric) as { scenario_result_id: number } | null;
        if (existing) {
          update.run(
            row.value ?? null,
            row.capacity_required ?? null,
            row.capacity_available ?? null,
            row.deficit ?? null,
            scenarioId,
            row.target_date,
            row.metric,
          );
          counts.updated++;
        } else {
          insert.run(
            scenarioId,
            row.target_date,
            row.metric,
            row.value ?? null,
            row.capacity_required ?? null,
            row.capacity_available ?? null,
            row.deficit ?? null,
          );
          counts.inserted++;
        }
      }
    });

    return counts;
  }

  getScenarioResults(scenarioId: number): ScenarioResultRow[] {
    return this.db
      .query("SELECT * FROM scenario_results WHERE scenario_id = ? ORDER BY target_date, metric")
      .all(scenarioId) as ScenarioResultRow[];
  }
}
