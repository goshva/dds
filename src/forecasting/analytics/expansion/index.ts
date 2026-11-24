/** Публичный интерфейс модуля расширения истории (Stage 3.3.1). */

export type {
  ExpandedHistory,
  ExtractionInterval,
  HistoryObservation,
  HistoryProfile,
  HistoryReconciliationResult,
  HistoryReconciliationRow,
  ReconciliationCategory,
} from "./types";

export {
  buildExpandedHistory,
  profileHistory,
  readCanonicalCsv,
  readInterval,
  type BuildHistoryInput,
} from "./history-builder";

export { reconcileHistory, type PreviousObservation } from "./history-reconciliation";

export {
  canonicalCsvCompat,
  historyCsv,
  historyExpansionMarkdown,
  profileJson,
  reconciliationCsv,
  sourceAuditMarkdown,
  writeExpansionArtifacts,
  type ExpansionArtifacts,
} from "./reports";
