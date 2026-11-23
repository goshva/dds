/**
 * Импорт плана мероприятий в журнал domain_events.
 *
 * План — это намерения, а не факт: все записи получают status='planned' и evidence_status='planned',
 * поля факта (actual_start/actual_end/verification_result) остаются пустыми до подтверждения куратором.
 * Файл плана не содержит календарных дат (только «День 1 … День 10»), поэтому planned_start = NULL,
 * а сама привязка хранится в ledger_note.
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import type { DomainEventRow } from "../storage/interfaces/types";
import type { ForecastingStore } from "../storage/sqlite/store";
import { readPlan } from "./artifact-reader";

export interface PlanImportOptions {
  path: string;
  shopNo: string;
  now?: Date;
}

export interface PlanImportSummary {
  items: number;
  inserted: number;
  updated: number;
  source: string;
}

export async function importPlan(store: ForecastingStore, options: PlanImportOptions): Promise<PlanImportSummary> {
  const now = options.now ?? new Date();
  const loadedAt = now.toISOString();
  const items = await readPlan(options.path);
  const source = basename(options.path);
  const planSha = new Bun.CryptoHasher("sha256").update(await readFile(options.path)).digest("hex");

  store.db
    .query("INSERT INTO shops (shop_no, name, created_at) VALUES (?, ?, ?) ON CONFLICT(shop_no) DO NOTHING")
    .run(options.shopNo, options.shopNo, loadedAt);

  const rows: DomainEventRow[] = items.map((item) => ({
    shop_no: options.shopNo,
    event_date: null,
    // порядковый номер в плане — часть типа события, чтобы повторный импорт был идемпотентным
    event_type: `plan_item_${String(item.ordinal).padStart(2, "0")}`,
    source: `${source}#${planSha.slice(0, 12)}`,
    planned_start: null,
    actual_start: null,
    actual_end: null,
    status: "planned",
    evidence_status: "planned",
    expected_effect: item.expected_result,
    verification_result: "требует подтверждения",
    ledger_note: [item.day, item.time, item.task, item.risk ? `риск: ${item.risk}` : ""].filter(Boolean).join(" · "),
    created_at: loadedAt,
  }));

  const counts = store.events.upsertEvents(rows);
  return { items: rows.length, inserted: counts.inserted, updated: counts.updated, source };
}
