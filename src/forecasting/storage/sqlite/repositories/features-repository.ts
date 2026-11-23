/** Реализация {@link FeaturesRepository} на SQLite. */

import type { Database } from "bun:sqlite";

import type { FeaturesRepository } from "../../interfaces/repositories";
import type { FeatureRow, UpsertCounts } from "../../interfaces/types";
import { inTransactionOrNew } from "./helpers";

export class SqliteFeaturesRepository implements FeaturesRepository {
  constructor(private readonly db: Database) {}

  upsertFeatures(rows: FeatureRow[]): UpsertCounts {
    const counts: UpsertCounts = { inserted: 0, updated: 0 };
    if (!rows.length) return counts;

    const find = this.db.query(
      "SELECT feature_id FROM forecast_features WHERE shop_no = ? AND date = ? AND feature = ? AND feature_version = ?",
    );
    const insert = this.db.query(
      `INSERT INTO forecast_features (shop_no, date, feature, value, evidence_status, feature_version, computed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const update = this.db.query(
      `UPDATE forecast_features SET value = ?, evidence_status = ?, computed_at = ?
        WHERE shop_no = ? AND date = ? AND feature = ? AND feature_version = ?`,
    );

    inTransactionOrNew(this.db, () => {
      for (const row of rows) {
        const existing = find.get(row.shop_no, row.date, row.feature, row.feature_version) as { feature_id: number } | null;
        if (existing) {
          update.run(row.value ?? null, row.evidence_status, row.computed_at, row.shop_no, row.date, row.feature, row.feature_version);
          counts.updated++;
        } else {
          insert.run(row.shop_no, row.date, row.feature, row.value ?? null, row.evidence_status, row.feature_version, row.computed_at);
          counts.inserted++;
        }
      }
    });

    return counts;
  }

  getFeatures(shopNo: string, dateFrom?: string, dateTo?: string, feature?: string): FeatureRow[] {
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
    if (feature) {
      where.push("feature = ?");
      values.push(feature);
    }
    return this.db
      .query(`SELECT * FROM forecast_features WHERE ${where.join(" AND ")} ORDER BY date, feature`)
      .all(...(values as never[])) as FeatureRow[];
  }
}
