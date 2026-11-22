/** Этап 1.7 — типы предметной области и реестров. */

export type EntityDecision = "KEEP" | "MERGE" | "SPLIT" | "RENAME" | "NEEDS_EVIDENCE" | "REMOVE" | "NEW";

export interface ContextKnowledge {
  id: string;
  name: string;
  purpose: string;
  datasets: number[];
  entities: string[];
  key_findings: string[];
  open_questions: string[];
  evidence: string[];
}

export interface EntityKnowledge {
  id: string;
  name: string;
  name_ru: string;
  context: string;
  purpose: string;
  prior_1_5: string | null;
  decision: EntityDecision;
  decision_reason: string;
  grain: string;
  identity: string;
  evidence: string[];
  evidence_type: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  datasets: number[];
  gaps: string[];
  notes: string;
}

export interface AttributeKnowledge {
  id: string;
  entity: string;
  name: string;
  name_ru: string;
  role: "IDENTIFIER" | "DATE" | "MEASURE" | "DIMENSION" | "STATUS" | "FOREIGN_KEY" | "TECHNICAL";
  datasets: number[];
  columns: string[];
  evidence: string[];
  evidence_type: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  pii: boolean;
  notes: string;
}

export interface RelationshipKnowledge {
  id: string;
  from: string;
  to: string;
  kind: "FK_CANDIDATE" | "BUSINESS_RULE" | "INFERRED" | "HIERARCHY";
  columns: string;
  evidence: string[];
  evidence_type: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  notes: string;
}

export interface GapKnowledge {
  id: string;
  title: string;
  context: string;
  entities: string[];
  category: "MISSING_ENTITY" | "MISSING_ATTRIBUTE" | "MISSING_RELATIONSHIP" | "UNKNOWN_GRAIN" | "CONFLICT" | "ACCESS";
  severity: "BLOCKER" | "HIGH" | "MEDIUM" | "LOW";
  description: string;
  impact: string;
  evidence: string[];
  status: "OPEN" | "PARTIAL" | "RESOLVED";
  next_action: string;
}

export interface ProcessKnowledge {
  id: string;
  name: string;
  context: string;
  steps: string[];
  entities: string[];
  evidence: string[];
  confidence: "HIGH" | "MEDIUM" | "LOW";
  notes: string;
}

export interface MvpItemKnowledge {
  id: string;
  name: string;
  entity: string;
  status: "AVAILABLE" | "PARTIAL" | "MISSING";
  evidence: string[];
  notes: string;
}

export interface MetricKnowledge {
  id: string;
  name: string;
  definition: string;
  status: "DEFINED" | "PARTIAL" | "NOT_DEFINED";
  entities: string[];
  evidence: string[];
  notes: string;
}
