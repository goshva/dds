import { describe, expect, test } from "bun:test";
import { parseSql, parseSqlExtended } from "../../phase1-2/parse-sql";

describe("parseSql (base)", () => {
  test("CTE and sources are detected", () => {
    const sql = `
      WITH a AS (SELECT id, x FROM schema.tbl WHERE x > 0),
           b AS (SELECT * FROM a)
      SELECT b.id, count(*) FROM b JOIN other.t o ON o.id = b.id GROUP BY b.id
    `;
    const p = parseSql(sql);
    expect(p.ctes.map((c) => c.name)).toEqual(["a", "b"]);
    expect(p.sources.some((s) => s.name === "tbl" && s.schema === "schema")).toBe(true);
    expect(p.joins.length).toBeGreaterThan(0);
    expect(p.groupBy.length).toBe(1);
  });

  test("Jinja in strings does not break parentheses", () => {
    const sql = `
      SELECT * FROM t
      WHERE 1=1
      {% if filter_values('shopno') %}
        AND (shopno IN ({% for value in filter_values('shopno') %}'{{ value }}'{% if not loop.last %},{% endif %}{% endfor %}))
      {% endif %}
    `;
    const p = parseSql(sql);
    expect(p.parseUncertain).toBe(false);
  });
});

describe("parseSqlExtended (phase 1.4)", () => {
  test("extracts aggregates, casts, jinja params, positions", () => {
    const sql = `
      SELECT date_trunc('day', d) AS day, count(distinct courier_id) AS cnt
      FROM agile_mart_techaudit.courier_events_logs_aggr
      WHERE d >= '{{ from_dttm }}'::date
      GROUP BY 1
    `;
    const p = parseSqlExtended(sql);
    expect(p.aggregates.some((a) => a.fn.toUpperCase() === "COUNT")).toBe(true);
    expect(p.casts.length).toBeGreaterThan(0);
    expect(p.jinja_params).toContain("from_dttm");
    expect(p.construct_lines.select?.length).toBeGreaterThan(0);
    expect(p.parse_status).toBe("PARSED");
  });

  test("ClickHouse dialect is detected with evidence", () => {
    const p = parseSqlExtended("SELECT dictGetOrNull('d', 'x', id) FROM t");
    expect(p.dialect).toBe("CLICKHOUSE");
    expect(p.dialect_evidence.length).toBeGreaterThan(0);
  });

  test("Postgres dialect is detected with evidence", () => {
    const p = parseSqlExtended("SELECT a::numeric FROM t WHERE b ~* 'x'");
    expect(p.dialect).toBe("POSTGRES");
    expect(p.dialect_evidence.length).toBeGreaterThan(0);
  });

  test("unknown construct is flagged, not silently dropped", () => {
    const p = parseSqlExtended("SELECT * FROM t PIVOT (sum(x) FOR y IN ('a'))");
    expect(p.issues.some((i) => i.includes("unsupported"))).toBe(true);
    expect(p.parse_status).toBe("UNSUPPORTED_SYNTAX");
    expect(p.selectItemCount).toBeGreaterThan(0);
  });

  test("nested SELECT is counted", () => {
    const p = parseSqlExtended("SELECT * FROM (SELECT id FROM t) s");
    expect(p.nested_select_count).toBeGreaterThan(0);
  });
});
