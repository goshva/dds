/**
 * Этап 1.7 — пути, константы и общие помощники.
 *
 * Все артефакты этапа пишутся в docs/phase-01-7 и reports/phase-01-7.
 * Предыдущие этапы только читаются.
 */
import { join } from "node:path";

export const DOCS = "docs/phase-01-7";
export const DIAGRAMS = join(DOCS, "diagrams");
export const REPORTS = "reports/phase-01-7";
export const EVIDENCE = join(REPORTS, "evidence");

export const SNAP_162 = "data/snapshots/phase-01-6-2";
export const REPORTS_162 = "reports/phase-01-6-2";
export const PACKAGE = "analysis_package";
export const REPORTS_16 = "reports/phase-01-6";
export const DOCS_16 = "docs/phase-01-6";
export const DOCS_15 = "docs/phase-01-5";
export const REPORTS_14 = "reports/phase-01-4";
export const EXTRACTED_14 = "data/extracted/phase-01-4";

/** Типы свидетельств по ТЗ §2.3. */
export const EVIDENCE_TYPES = [
  "ACTUAL_DATA",
  "FILTER_VALUES",
  "SQL_DERIVED",
  "SQL_DEFINITION",
  "METADATA_ONLY",
  "INFERRED",
  "BUSINESS_REQUIREMENT",
  "NOT_FOUND",
  "NOT_VERIFIABLE",
  "CONTRADICTED",
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

/** Статусы источника сущности по ТЗ §5.3. */
export const SOURCE_STATUSES = [
  "FOUND_IN_SUPERSET_SQL",
  "FOUND_IN_SUPERSET_METADATA",
  "FOUND_IN_FILTER_VALUES",
  "FOUND_AS_SQL_DERIVED",
  "INFERRED_FROM_MULTIPLE_SOURCES",
  "BUSINESS_REQUIRED_NOT_FOUND",
  "NOT_VERIFIABLE",
  "CONTRADICTED",
  "NOT_IN_SCOPE",
] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

export const CONFIDENCE = ["HIGH", "MEDIUM", "LOW", "NONE"] as const;
export type Confidence = (typeof CONFIDENCE)[number];

export const MVP_SCOPE = ["MVP", "MVP_SUPPORT", "NOT_REQUIRED_FOR_MVP", "LATER", "OUT_OF_SCOPE"] as const;
export type MvpScope = (typeof MVP_SCOPE)[number];

export const DECISION_STATUSES = [
  "AGREED",
  "PARTIAL_EVIDENCE",
  "NEEDS_BUSINESS_APPROVAL",
  "NOT_VERIFIABLE",
  "CONTRADICTED",
  "DEFERRED",
] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export const RELATIONSHIP_STATUSES = [
  "SQL_JOIN_CANDIDATE",
  "KEY_CANDIDATE",
  "BUSINESS_RELATIONSHIP_REQUIRED",
  "INFERRED_RELATIONSHIP",
  "VERIFIED_BY_DATA",
  "NOT_VERIFIABLE",
  "CONTRADICTED",
] as const;
export type RelationshipStatus = (typeof RELATIONSHIP_STATUSES)[number];

export const GAP_TYPES = [
  "NOT_FOUND_IN_SUPERSET",
  "NOT_VERIFIABLE_ACCESS",
  "NOT_IN_METADATA",
  "BUSINESS_RULE_MISSING",
  "MASTER_SOURCE_MISSING",
  "EVENT_SOURCE_MISSING",
  "IDENTITY_UNRESOLVED",
  "SEMANTICS_UNRESOLVED",
  "OWNER_UNKNOWN",
  "CONFLICTING_EVIDENCE",
] as const;
export type GapType = (typeof GAP_TYPES)[number];

export const GAP_PRIORITIES = ["P0_BLOCKER", "P1_HIGH", "P2_MEDIUM", "P3_LOW"] as const;
export type GapPriority = (typeof GAP_PRIORITIES)[number];

/** Трассировочная ссылка на evidence: EV-0001 ... */
export function evId(n: number): string {
  return `EV-${String(n).padStart(4, "0")}`;
}
