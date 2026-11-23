/**
 * Реализация {@link EventsRepository} на SQLite — журнал операционных мероприятий.
 * План и факт разделены: `planned_*` никогда не превращается в `actual_*` автоматически.
 */

import type { Database } from "bun:sqlite";

import type { EventsRepository } from "../../interfaces/repositories";
import type { DomainEventRow, UpsertCounts } from "../../interfaces/types";
import { inTransactionOrNew } from "./helpers";

export class SqliteEventsRepository implements EventsRepository {
  constructor(private readonly db: Database) {}

  upsertEvents(rows: DomainEventRow[]): UpsertCounts {
    const counts: UpsertCounts = { inserted: 0, updated: 0 };
    if (!rows.length) return counts;

    const find = this.db.query(
      "SELECT event_id FROM domain_events WHERE shop_no = ? AND event_type = ? AND IFNULL(planned_start, '') = IFNULL(?, '')",
    );
    const insert = this.db.query(
      `INSERT INTO domain_events
        (shop_no, event_date, event_type, source, planned_start, actual_start, actual_end, status, evidence_status,
         expected_effect, verification_result, ledger_note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const update = this.db.query(
      `UPDATE domain_events SET
         event_date = ?, source = ?, actual_start = ?, actual_end = ?, status = ?, evidence_status = ?,
         expected_effect = ?, verification_result = ?, ledger_note = ?
       WHERE shop_no = ? AND event_type = ? AND IFNULL(planned_start, '') = IFNULL(?, '')`,
    );

    inTransactionOrNew(this.db, () => {
      for (const row of rows) {
        const planned = row.planned_start ?? null;
        const existing = find.get(row.shop_no ?? null, row.event_type, planned) as { event_id: number } | null;
        if (existing) {
          update.run(
            row.event_date ?? null,
            row.source ?? null,
            row.actual_start ?? null,
            row.actual_end ?? null,
            row.status,
            row.evidence_status,
            row.expected_effect ?? null,
            row.verification_result ?? null,
            row.ledger_note ?? null,
            row.shop_no ?? null,
            row.event_type,
            planned,
          );
          counts.updated++;
        } else {
          insert.run(
            row.shop_no ?? null,
            row.event_date ?? null,
            row.event_type,
            row.source ?? null,
            planned,
            row.actual_start ?? null,
            row.actual_end ?? null,
            row.status,
            row.evidence_status,
            row.expected_effect ?? null,
            row.verification_result ?? null,
            row.ledger_note ?? null,
            row.created_at ?? null,
          );
          counts.inserted++;
        }
      }
    });

    return counts;
  }

  getEvents(shopNo: string, dateFrom?: string, dateTo?: string): DomainEventRow[] {
    const where: string[] = ["shop_no = ?"];
    const values: unknown[] = [shopNo];
    if (dateFrom) {
      where.push("IFNULL(event_date, planned_start) >= ?");
      values.push(dateFrom);
    }
    if (dateTo) {
      where.push("IFNULL(event_date, planned_start) <= ?");
      values.push(dateTo);
    }
    return this.db
      .query(`SELECT * FROM domain_events WHERE ${where.join(" AND ")} ORDER BY IFNULL(event_date, planned_start), event_type`)
      .all(...(values as never[])) as DomainEventRow[];
  }

  markVerification(
    eventId: number,
    patch: Pick<DomainEventRow, "status" | "evidence_status"> &
      Partial<Pick<DomainEventRow, "actual_start" | "actual_end" | "verification_result" | "ledger_note">>,
  ): void {
    this.db
      .query(
        `UPDATE domain_events SET
           status = ?, evidence_status = ?, actual_start = ?, actual_end = ?, verification_result = ?, ledger_note = ?
         WHERE event_id = ?`,
      )
      .run(
        patch.status,
        patch.evidence_status,
        patch.actual_start ?? null,
        patch.actual_end ?? null,
        patch.verification_result ?? null,
        patch.ledger_note ?? null,
        eventId,
      );
  }
}
