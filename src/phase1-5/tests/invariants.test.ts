import { describe, expect, test } from "bun:test";
import { MAPPING, EVENTS } from "../registries";

// Чистые функции-проверки ключевых инвариантов (эмуляция бизнес-логики).

const deliveredNotBeforeCreated = (o: { order_created_at: string; delivered_at?: string | null }) =>
  !o.delivered_at || new Date(o.delivered_at) >= new Date(o.order_created_at);

const shiftIntervalValid = (s: { actual_start_at?: string | null; actual_end_at?: string | null }) =>
  !s.actual_start_at || !s.actual_end_at || new Date(s.actual_end_at) >= new Date(s.actual_start_at);

const mentorNotTrainee = (m: { mentor_courier_id: string; trainee_courier_id: string }) =>
  m.mentor_courier_id !== m.trainee_courier_id;

const uniqueAccrual = (attempts: string[]) => new Set(attempts).size === attempts.length;

const sameZoneAndShop = (orders: Array<{ zone_id: string; shop_id: string }>) =>
  new Set(orders.map((o) => o.zone_id)).size <= 1 && new Set(orders.map((o) => o.shop_id)).size <= 1;

const batchSizeAllowed = (n: number, override = false) => n <= 5 || override;

const readyRequiresEvent = (order: { ready_at?: string | null; has_ready_event: boolean }) =>
  !order.ready_at || order.has_ready_event;

const accrualNotFromOrderAmount = (accrual: { amount_source: string }) => accrual.amount_source !== "sum_paid";

describe("integrity invariants", () => {
  test("delivered_at >= order_created_at", () => {
    expect(deliveredNotBeforeCreated({ order_created_at: "2026-11-21T08:00:00Z", delivered_at: "2026-11-21T09:00:00Z" })).toBe(true);
    expect(deliveredNotBeforeCreated({ order_created_at: "2026-11-21T08:00:00Z", delivered_at: "2026-11-21T07:00:00Z" })).toBe(false);
    expect(deliveredNotBeforeCreated({ order_created_at: "2026-11-21T08:00:00Z", delivered_at: null })).toBe(true);
  });

  test("shift end >= start", () => {
    expect(shiftIntervalValid({ actual_start_at: "2026-11-21T08:00:00Z", actual_end_at: "2026-11-21T18:00:00Z" })).toBe(true);
    expect(shiftIntervalValid({ actual_start_at: "2026-11-21T08:00:00Z", actual_end_at: "2026-11-21T07:00:00Z" })).toBe(false);
  });

  test("mentor != trainee", () => {
    expect(mentorNotTrainee({ mentor_courier_id: "a", trainee_courier_id: "b" })).toBe(true);
    expect(mentorNotTrainee({ mentor_courier_id: "a", trainee_courier_id: "a" })).toBe(false);
  });

  test("one accrual per delivery attempt", () => {
    expect(uniqueAccrual(["att-1", "att-2"])).toBe(true);
    expect(uniqueAccrual(["att-1", "att-1"])).toBe(false);
  });

  test("trip composition is same zone and shop", () => {
    expect(sameZoneAndShop([{ zone_id: "z1", shop_id: "s1" }, { zone_id: "z1", shop_id: "s1" }])).toBe(true);
    expect(sameZoneAndShop([{ zone_id: "z1", shop_id: "s1" }, { zone_id: "z2", shop_id: "s1" }])).toBe(false);
  });

  test("sixth order is rejected without override", () => {
    expect(batchSizeAllowed(5)).toBe(true);
    expect(batchSizeAllowed(6)).toBe(false);
    expect(batchSizeAllowed(6, true)).toBe(true);
  });

  test("READY requires confirmed event", () => {
    expect(readyRequiresEvent({ ready_at: "2026-11-21T08:20:00Z", has_ready_event: true })).toBe(true);
    expect(readyRequiresEvent({ ready_at: "2026-11-21T08:20:00Z", has_ready_event: false })).toBe(false);
    expect(readyRequiresEvent({ ready_at: null, has_ready_event: false })).toBe(true);
  });

  test("sum_paid is never the accrual source", () => {
    expect(accrualNotFromOrderAmount({ amount_source: "tariff" })).toBe(true);
    expect(accrualNotFromOrderAmount({ amount_source: "sum_paid" })).toBe(false);
  });
});

describe("registries", () => {
  test("ORDER_READY exists and has required payload", () => {
    const e = EVENTS.find((x) => x.type === "ORDER_READY");
    expect(e).toBeDefined();
    expect(e!.payload).toContain("order_id");
    expect(e!.payload).toContain("ready_at");
  });

  test("no mapping uses sum_paid for courier accruals", () => {
    const bad = MAPPING.filter((m) => m.domain_table.includes("accrual") && m.superset_field === "sum_paid");
    expect(bad).toEqual([]);
    const bad2 = MAPPING.filter((m) => m.domain_table.includes("accrual") && m.superset_field === "sum_order");
    expect(bad2).toEqual([]);
  });
});
