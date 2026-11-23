/** Интерфейсы репозиториев: контракты, не зависящие от конкретной СУБД. */

import type {
  CoverageRow,
  DailyMetricRow,
  DailyMetricsQuery,
  DomainEventRow,
  ExtractionRunRow,
  FeatureRow,
  ForecastEvaluationRow,
  ForecastResultRow,
  ForecastRunRow,
  NewExtractionRun,
  NewForecastRun,
  NewRawExtraction,
  RawExtractionRow,
  ScenarioResultRow,
  ScenarioRow,
  UpsertCounts,
} from "./types";

/** Запуски импорта и неизменённые исходные артефакты. */
export interface RawRepository {
  createRun(input: NewExtractionRun): number;
  finishRun(runId: number, patch: Partial<ExtractionRunRow>): void;
  getRun(runId: number): ExtractionRunRow | null;
  listRuns(limit?: number): ExtractionRunRow[];
  /** Возвращает raw_id и признак того, что такой payload уже был загружен (по sha256). */
  addExtraction(input: NewRawExtraction): { raw_id: number; duplicate: boolean };
  getExtractionByHash(payloadSha256: string): RawExtractionRow | null;
}

/** Дневные показатели: natural key наблюдения без run_id. */
export interface MetricsRepository {
  upsertDailyMetrics(rows: DailyMetricRow[]): UpsertCounts;
  getDailyMetrics(query: DailyMetricsQuery): DailyMetricRow[];
  getMetricSeries(shopNo: string, metric: string, dateFrom?: string, dateTo?: string): DailyMetricRow[];
  getCoverage(shopNo: string, dateFrom?: string, dateTo?: string): CoverageRow[];
}

export interface FeaturesRepository {
  upsertFeatures(rows: FeatureRow[]): UpsertCounts;
  getFeatures(shopNo: string, dateFrom?: string, dateTo?: string, feature?: string): FeatureRow[];
}

export interface EventsRepository {
  upsertEvents(rows: DomainEventRow[]): UpsertCounts;
  getEvents(shopNo: string, dateFrom?: string, dateTo?: string): DomainEventRow[];
  markVerification(
    eventId: number,
    patch: Pick<DomainEventRow, "status" | "evidence_status"> &
      Partial<Pick<DomainEventRow, "actual_start" | "actual_end" | "verification_result" | "ledger_note">>,
  ): void;
}

export interface ForecastRepository {
  createRun(input: NewForecastRun): number;
  getRun(runId: number): ForecastRunRow | null;
  listRuns(shopNo: string, limit?: number): ForecastRunRow[];
  saveResults(runId: number, rows: ForecastResultRow[]): UpsertCounts;
  getResults(runId: number): ForecastResultRow[];
  saveEvaluations(runId: number, rows: ForecastEvaluationRow[]): UpsertCounts;
  getEvaluations(runId: number): ForecastEvaluationRow[];
  createScenario(row: ScenarioRow): number;
  getScenario(scenarioId: number): ScenarioRow | null;
  saveScenarioResults(scenarioId: number, rows: ScenarioResultRow[]): UpsertCounts;
  getScenarioResults(scenarioId: number): ScenarioResultRow[];
}
