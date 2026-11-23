/**
 * Реализация {@link MetricsRepository} на SQLite.
 *
 * Natural key наблюдения —
 *   (shop_no, date, slice_id, dimension_1, dimension_2, metric, transform_version)
 * — намеренно БЕЗ run_id, чтобы повторная загрузка того же источника оставалась идемпотентной
 * (см. docs/forecasting/audit-report.md §4).
 */

import type { Database } from "bun:sqlite";

import type { MetricsRepository } from "../../interfaces/repositories";
import type { CoverageRow, DailyMetricRow, DailyMetricsQuery, UpsertCounts } from "../../interfaces/types";
import { inTransactionOrNew } from "./helpers";

const INSERT_SQL = `INSERT INTO daily_metrics
  (shop_no, date, slice_id, chart_id, dataset_id, dimension_1, dimension_2, metric, metric_kind, value, unit,
   evidence_status, data_status, run_id, source_file, request_sha256, transform_version, loaded_at)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const UPDATE_SQL = `UPDATE daily_metrics SET
   chart_id = ?, dataset_id = ?, metric_kind = ?, value = ?, unit = ?,
   evidence_status = ?, data_status = ?, run_id = ?, source_file = ?, request_sha256 = ?, loaded_at = ?
 WHERE shop_no = ? AND date = ? AND slice_id = ? AND dimension_1 = ? AND dimension_2 = ? AND metric = ? AND transform_version = ?`;

export class SqliteMetricsRepository implements MetricsRepository {
  constructor(private readonly db: Database) {}

  upsertDailyMetrics(rows: DailyMetricRow[]): UpsertCounts {
    const counts: UpsertCounts = { inserted: 0, updated: 0 };
    if (!rows.length) return counts;

    const find = this.db.query(
      `SELECT metric_id FROM daily_metrics
        WHERE shop_no = ? AND date = ? AND slice_id = ? AND dimension_1 = ? AND dimension_2 = ? AND metric = ? AND transform_version = ?`,
    );
    const insert = this.db.query(INSERT_SQL);
    const update = this.db.query(UPDATE_SQL);

    inTransactionOrNew(this.db, () => {
      for (const row of rows) {
        const dimension1 = row.dimension_1 ?? "";
        const dimension2 = row.dimension_2 ?? "";
        const existing = find.get(
          row.shop_no,
          row.date,
          row.slice_id,
          dimension1,
          dimension2,
          row.metric,
          row.transform_version,
        ) as { metric_id: number } | null;

        if (existing) {
          update.run(
            row.chart_id ?? null,
            row.dataset_id ?? null,
            row.metric_kind,
            row.value ?? null,
            row.unit ?? null,
            row.evidence_status,
            row.data_status,
            row.run_id ?? null,
            row.source_file ?? null,
            row.request_sha256 ?? null,
            row.loaded_at,
            row.shop_no,
            row.date,
            row.slice_id,
            dimension1,
            dimension2,
            row.metric,
            row.transform_version,
          );
          counts.updated++;
        } else {
          insert.run(
            row.shop_no,
            row.date,
            row.slice_id,
            row.chart_id ?? null,
            row.dataset_id ?? null,
            dimension1,
            dimension2,
            row.metric,
            row.metric_kind,
            row.value ?? null,
            row.unit ?? null,
            row.evidence_status,
            row.data_status,
            row.run_id ?? null,
            row.source_file ?? null,
            row.request_sha256 ?? null,
            row.transform_version,
            row.loaded_at,
          );
          counts.inserted++;
        }
      }
    });

    return counts;
  }

  getDailyMetrics(query: DailyMetricsQuery): DailyMetricRow[] {
    const where: string[] = ["shop_no = ?"];
    const values: unknown[] = [query.shop_no];
    if (query.date_from) {
      where.push("date >= ?");
      values.push(query.date_from);
    }
    if (query.date_to) {
      where.push("date <= ?");
      values.push(query.date_to);
    }
    if (query.metric) {
      where.push("metric = ?");
      values.push(query.metric);
    }
    if (query.slice_id !== undefined) {
      where.push("slice_id = ?");
      values.push(query.slice_id);
    }
    if (query.dimension_1 !== undefined) {
      where.push("dimension_1 = ?");
      values.push(query.dimension_1);
    }
    if (query.dimension_2 !== undefined) {
      where.push("dimension_2 = ?");
      values.push(query.dimension_2);
    }
    if (query.transform_version) {
      where.push("transform_version = ?");
      values.push(query.transform_version);
    }
    const limit = query.limit && query.limit > 0 ? ` LIMIT ${Math.trunc(query.limit)}` : "";
    const sql = `SELECT * FROM daily_metrics WHERE ${where.join(" AND ")} ORDER BY date, metric, slice_id, dimension_1, dimension_2${limit}`;
    return this.db.query(sql).all(...(values as never[])) as DailyMetricRow[];
  }

  getMetricSeries(shopNo: string, metric: string, dateFrom?: string, dateTo?: string): DailyMetricRow[] {
    return this.getDailyMetrics({ shop_no: shopNo, metric, date_from: dateFrom, date_to: dateTo });
  }

  /** Наличие данных по дням: сколько наблюдений и метрик, плюс худший `data_status` дня. */
  getCoverage(shopNo: string, dateFrom?: string, dateTo?: string): CoverageRow[] {
    const where: string[] = ["shop_no = ?"];
    const values: unknown[] = [shopNo];
    if (dateFrom) {
      where.push("date >= ?");
      values.push(dateFrom);
    }
    if (dateTo) {
      where.push("date <= ?");
      values.push(dateTo);
    }
    return this.db
      .query(
        `SELECT date,
                COUNT(*) AS observations,
                COUNT(DISTINCT metric) AS metrics,
                CASE WHEN SUM(CASE WHEN data_status <> 'full' THEN 1 ELSE 0 END) > 0 THEN 'partial' ELSE 'full' END AS data_status
           FROM daily_metrics
          WHERE ${where.join(" AND ")}
          GROUP BY date
          ORDER BY date`,
      )
      .all(...(values as never[])) as CoverageRow[];
  }
}
