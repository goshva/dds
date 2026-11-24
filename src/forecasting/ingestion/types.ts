/**
 * Слой загрузки артефактов Superset в SQLite.
 *
 * Принципы:
 *  - исходные артефакты только читаются и никогда не изменяются;
 *  - каждый импорт фиксируется в extraction_runs, а исходные payload'ы — в raw_extractions (дедуп по sha256);
 *  - статусы достоверности и качества проставляются на уровне наблюдения, а не всего запуска;
 *  - отсутствующие значения остаются NULL и не превращаются в нули.
 */

export interface ImportOptions {
  /** каталог выгрузки (манифест, quality, CSV наблюдений) */
  runDir: string;
  /** метка источника для провенанса (например: legacy-6w или api-refresh) */
  sourceLabel: string;
  /** версия преобразования, попадающая в natural key наблюдения */
  transformVersion: string;
  /**
   * Ожидаемый даркстор. Если не задан — валидатор использует значение по умолчанию MVP (7745).
   * Импорт другого магазина возможен только при явной передаче его здесь.
   */
  shopNo?: string;
  /** режим запуска, записываемый в extraction_runs.mode */
  mode?: string;
}

export interface ImportSummary {
  run_id: number;
  source_label: string;
  transform_version: string;
  period_from: string;
  period_to: string;
  quality_status: string;
  observations_read: number;
  inserted: number;
  updated: number;
  raw_payloads_new: number;
  raw_payloads_duplicate: number;
  slices: number[];
  skipped_rows: number;
}

export interface ImportedRunMetadata {
  shop_no: string;
  period: { from: string; to: string; time_range: string };
  sources: Array<{ slice_id: number; dataset_id: number | null; request_sha256: string }>;
}
