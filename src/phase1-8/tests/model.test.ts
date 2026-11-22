/**
 * Этап 1.8 — unit tests для логической модели.
 * Проверяют целостность ссылок и запрещённые выводы без обращения к файлам.
 */
import { describe, expect, test } from "bun:test";
import {
  CONTEXTS,
  ENTITIES,
  ATTRIBUTES,
  RELATIONSHIPS,
  EVIDENCE,
  DECISIONS,
  INVARIANTS,
  GAPS,
  PROCESSES,
  MVP_FIELDS,
  METRICS,
} from "../model";

const entityIds = new Set(ENTITIES.map((e) => e.id));
const contextIds = new Set(CONTEXTS.map((c) => c.id));
const evidenceIds = new Set(EVIDENCE.map((e) => e.id));
const decisionIds = new Set(DECISIONS.map((d) => d.id));

describe("model integrity", () => {
  test("entity IDs уникальны", () => {
    expect(entityIds.size).toBe(ENTITIES.length);
  });

  test("у каждой сущности есть bounded context", () => {
    for (const e of ENTITIES) {
      expect(contextIds.has(e.bounded_context)).toBe(true);
    }
  });

  test("все ссылки контекстов на сущности существуют", () => {
    for (const c of CONTEXTS) {
      for (const id of c.entities) {
        expect(entityIds.has(id)).toBe(true);
      }
    }
  });

  test("все связи ссылаются на существующие сущности", () => {
    for (const r of RELATIONSHIPS) {
      expect(entityIds.has(r.from_entity)).toBe(true);
      expect(entityIds.has(r.to_entity)).toBe(true);
    }
  });

  test("все атрибуты ссылаются на существующие сущности", () => {
    for (const a of ATTRIBUTES) {
      expect(entityIds.has(a.entity_id)).toBe(true);
    }
  });

  test("все evidence-ссылки существуют", () => {
    for (const e of ENTITIES) {
      for (const id of e.evidence_ids ?? []) {
        expect(evidenceIds.has(id)).toBe(true);
      }
    }
    for (const a of ATTRIBUTES) {
      for (const id of (a as any).evidence_ids ?? []) {
        expect(evidenceIds.has(id)).toBe(true);
      }
    }
    for (const r of RELATIONSHIPS) {
      for (const id of (r as any).evidence_ids ?? []) {
        expect(evidenceIds.has(id)).toBe(true);
      }
    }
  });

  test("все open_decision_ids существуют", () => {
    for (const e of ENTITIES) {
      for (const id of e.open_decision_ids ?? []) {
        expect(decisionIds.has(id)).toBe(true);
      }
    }
  });

  test("20 инвариантов INV-001…INV-020", () => {
    const ids = new Set(INVARIANTS.map((i) => i.id));
    for (let i = 1; i <= 20; i++) {
      expect(ids.has(`INV-${String(i).padStart(3, "0")}`)).toBe(true);
    }
  });

  test("Pool и Trip — разные сущности", () => {
    const pool = ENTITIES.find((e) => e.name === "Pool");
    const trip = ENTITIES.find((e) => e.name === "Trip");
    expect(pool).toBeDefined();
    expect(trip).toBeDefined();
    expect(pool?.id).not.toBe(trip?.id);
  });

  test("нет статуса VERIFIED", () => {
    for (const e of ENTITIES) {
      expect((e as any).status).not.toBe("VERIFIED");
    }
  });

  test("нет FK-нотации в связях", () => {
    for (const r of RELATIONSHIPS) {
      expect(String((r as any).kind).toUpperCase()).not.toContain("FK");
      expect(String((r as any).kind).toUpperCase()).not.toContain("FOREIGN");
    }
  });

  test("gaps и метрики непустые", () => {
    expect(GAPS.length).toBeGreaterThan(0);
    expect(METRICS.length).toBeGreaterThan(0);
    expect(PROCESSES.length).toBeGreaterThan(0);
    expect(MVP_FIELDS.length).toBeGreaterThan(0);
  });
});
