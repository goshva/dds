/** Реализация {@link RawRepository} на SQLite: запуски импорта и неизменённые исходные payload. */

import type { Database } from "bun:sqlite";

import type { RawRepository } from "../../interfaces/repositories";
import type { ExtractionRunRow, NewExtractionRun, NewRawExtraction, RawExtractionRow } from "../../interfaces/types";
import { buildUpdate, inTransactionOrNew, lastInsertId, sha256 } from "./helpers";

const RUN_PATCH_FIELDS = [
  "finished_at",
  "rows_raw",
  "rows_loaded",
  "quality_status",
  "status",
  "notes",
  "manifest_path",
  "manifest_sha256",
  "period_from",
  "period_to",
  "tool_version",
] as const;

export class SqliteRawRepository implements RawRepository {
  constructor(private readonly db: Database) {}

  createRun(input: NewExtractionRun): number {
    const info = this.db
      .query(
        `INSERT INTO extraction_runs
           (started_at, mode, shop_no, period_from, period_to, tool_version, manifest_path, manifest_sha256, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.started_at,
        input.mode,
        input.shop_no ?? null,
        input.period_from ?? null,
        input.period_to ?? null,
        input.tool_version ?? null,
        input.manifest_path ?? null,
        input.manifest_sha256 ?? null,
        input.status ?? "running",
        input.notes ?? null,
      );
    return lastInsertId(info);
  }

  finishRun(runId: number, patch: Partial<ExtractionRunRow>): void {
    const update = buildUpdate(patch as Record<string, unknown>, RUN_PATCH_FIELDS);
    if (!update) return;
    this.db
      .query(`UPDATE extraction_runs SET ${update.sql} WHERE run_id = ?`)
      .run(...(update.values as never[]), runId);
  }

  getRun(runId: number): ExtractionRunRow | null {
    return (this.db.query("SELECT * FROM extraction_runs WHERE run_id = ?").get(runId) as ExtractionRunRow | null) ?? null;
  }

  listRuns(limit = 50): ExtractionRunRow[] {
    return this.db
      .query("SELECT * FROM extraction_runs ORDER BY started_at DESC, run_id DESC LIMIT ?")
      .all(limit) as ExtractionRunRow[];
  }

  addExtraction(input: NewRawExtraction): { raw_id: number; duplicate: boolean } {
    const payloadSha256 = sha256(input.payload);
    return inTransactionOrNew(this.db, () => {
      const existing = this.db
        .query("SELECT raw_id FROM raw_extractions WHERE payload_sha256 = ?")
        .get(payloadSha256) as { raw_id: number } | null;
      if (existing) return { raw_id: existing.raw_id, duplicate: true };

      const info = this.db
        .query(
          `INSERT INTO raw_extractions (run_id, source_kind, source_ref, payload, payload_sha256, bytes, loaded_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.run_id,
          input.source_kind,
          input.source_ref,
          input.payload,
          payloadSha256,
          Buffer.byteLength(input.payload, "utf8"),
          input.loaded_at,
        );
      return { raw_id: lastInsertId(info), duplicate: false };
    });
  }

  getExtractionByHash(payloadSha256: string): RawExtractionRow | null {
    return (
      (this.db.query("SELECT * FROM raw_extractions WHERE payload_sha256 = ?").get(payloadSha256) as RawExtractionRow | null) ??
      null
    );
  }
}
