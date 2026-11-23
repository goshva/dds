// Validates the eight-block DDS extraction config against the local catalogue and the
// dataset access matrix. Guards the rule "no block is READY just because it has chart ids".
import { describe, expect, test } from "bun:test";

const ROOT = "C:/soft/bun/dds";
const readJson = async (rel: string) => JSON.parse(await Bun.file(`${ROOT}/${rel}`).text());
const unwrap = (j: any, k: string): any[] => (Array.isArray(j) ? j : (j?.[k] ?? []));

const config = await readJson("tools/dds-blocks.json");
const charts = unwrap(await readJson("reports/phase-01-6-2/charts_inventory.json"), "charts");
const datasets = unwrap(await readJson("reports/phase-01-6-2/datasets_inventory.json"), "datasets");
const access = await readJson("reports/phase-01-9/dataset_access_matrix.json");

const chartById = new Map<number, any>(charts.map((c: any) => [c.chart_id, c]));
const datasetIds = new Set<number>(datasets.map((d: any) => Number(d.dataset_id)));
const verdict = new Map<string, string>((access.results ?? []).map((r: any) => [String(r.dataset_id), r.verdict]));

const REQUIRED_BLOCKS = ["tmc", "waits_ziz", "assembly", "late", "slots", "mentorship", "photo_audit", "coverage"];
const ALLOWED_STATUSES = ["READY", "BLOCKED_ACCESS", "PARTIAL", "NOT_FOUND"];

describe("dds-blocks config", () => {
  test("contains exactly the eight required blocks", () => {
    expect(config.blocks.length).toBe(8);
    expect(config.blocks.map((b: any) => b.key).sort()).toEqual([...REQUIRED_BLOCKS].sort());
  });

  test("every block carries the required fields", () => {
    for (const b of config.blocks) {
      expect(ALLOWED_STATUSES).toContain(b.status);
      expect(typeof b.status_reason).toBe("string");
      expect(b.status_reason.length).toBeGreaterThan(10);
      expect(Array.isArray(b.datasets) && b.datasets.length).toBeTruthy();
      expect(Array.isArray(b.required_rights) && b.required_rights.length).toBeTruthy();
      expect(Array.isArray(b.chart_ids)).toBe(true);
      expect(Array.isArray(b.dimensions) && b.dimensions.length).toBeTruthy();
      expect(Array.isArray(b.metrics) && b.metrics.length).toBeTruthy();
      expect(b.period?.weeks).toBeGreaterThan(0);
      expect(b.limits?.row_limit).toBeGreaterThan(0);
      expect(typeof b.run_command).toBe("string");
    }
  });

  test("chart ids exist and belong to the block's datasets", () => {
    for (const b of config.blocks) {
      for (const id of b.chart_ids) {
        const chart = chartById.get(id);
        expect(chart, `chart ${id} of block ${b.key} must exist in the local catalogue`).toBeDefined();
        expect(b.datasets.map((d: any) => d.dataset_id)).toContain(chart.dataset_id);
      }
    }
  });

  test("dataset ids exist in the local catalogue", () => {
    for (const b of config.blocks) {
      for (const d of b.datasets) {
        expect(datasetIds.has(Number(d.dataset_id)), `dataset ${d.dataset_id} of block ${b.key}`).toBe(true);
      }
    }
  });

  test("no block is READY without verified access to all of its datasets", () => {
    for (const b of config.blocks) {
      if (b.status !== "READY") continue;
      for (const d of b.datasets) {
        expect(verdict.get(String(d.dataset_id))).toBe("ALLOWED");
      }
    }
    // in this environment access is only verified for 3035, so nothing may be READY
    expect(config.blocks.filter((b: any) => b.status === "READY")).toEqual([]);
  });

  test("blocked datasets are exactly the ones the access matrix rejected", () => {
    for (const b of config.blocks) {
      for (const id of b.blocked_datasets) {
        expect(verdict.get(String(id))).toBe("NOT_AUTHORIZED");
      }
      expect(b.access_state).toBeDefined();
    }
  });

  test("access legend documents every dataset state used", () => {
    expect(Object.keys(config.access_legend).sort()).toEqual(["ALLOWED", "NOT_AUTHORIZED", "UNVERIFIED"]);
  });
});
