import { Database } from "bun:sqlite";
import { readFile } from "node:fs/promises";

type Obj = Record<string, any>;

function usage() {
  console.log(`
VkusVill Courier Discovery v0.3

Commands:
  audit <catalog.sqlite>
  summary <discovery_summary.json>
  search <catalog.sqlite> <term1> [term2 ...]
  object <catalog.sqlite> <object_type> <object_id>

Examples:
  bun run audit -- ../data/catalog.sqlite
  bun run summary -- ../data/discovery_summary.json
  bun run search -- ../data/catalog.sqlite courier delivery курьер
  bun run object -- ../data/catalog.sqlite dataset 4732
`);
}

function argsAfterCommand() {
  const args = process.argv.slice(2);
  if (args[0] === "--") args.shift();
  return args;
}

function openDb(path: string) {
  return new Database(path, { readonly: true, strict: true });
}

function tableExists(db: Database, name: string) {
  return !!db.query(
    "SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?"
  ).get(name);
}

function tableColumns(db: Database, table: string): string[] {
  const safe = table.replaceAll('"', '""');
  return (db.query(`PRAGMA table_info("${safe}")`).all() as Obj[]).map(x => x.name);
}

function parseJson(value: unknown): any {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return null; }
}

async function audit(path: string) {
  const db = openDb(path);
  try {
    const tables = db.query(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all() as Obj[];

    const result: Obj = {
      database: path,
      tables: [],
      object_type_stats: [],
      relation_stats: [],
      integrity: db.query("PRAGMA quick_check").all()
    };

    for (const row of tables) {
      const name = String(row.name);
      const safe = name.replaceAll('"', '""');
      const columns = tableColumns(db, name);
      const count = db.query(`SELECT COUNT(*) AS count FROM "${safe}"`).get() as Obj;
      result.tables.push({ name, count: count.count, columns });

      if (name === "objects" &&
          ["object_type", "object_id", "title", "payload_json"].every(c => columns.includes(c))) {
        result.object_type_stats = db.query(`
          SELECT object_type,
                 COUNT(*) AS records,
                 COUNT(DISTINCT object_id) AS unique_ids,
                 ROUND(SUM(LENGTH(payload_json))/1024.0/1024.0, 2) AS payload_mb,
                 MIN(collected_at) AS first_collected,
                 MAX(collected_at) AS last_collected
          FROM objects
          GROUP BY object_type
          ORDER BY records DESC
        `).all();

        result.courier_title_candidates = db.query(`
          SELECT object_type, object_id, title,
                 ROUND(LENGTH(payload_json)/1024.0, 2) AS payload_kb
          FROM objects
          WHERE
            LOWER(COALESCE(title,'')) LIKE '%курьер%'
            OR LOWER(COALESCE(title,'')) LIKE '%courier%'
            OR LOWER(COALESCE(title,'')) LIKE '%достав%'
            OR LOWER(COALESCE(title,'')) LIKE '%delivery%'
          ORDER BY object_type, title
          LIMIT 300
        `).all();
      }

      if (name === "relations" &&
          ["parent_type", "parent_id", "child_type", "child_id", "relation_type"].every(c => columns.includes(c))) {
        result.relation_stats = db.query(`
          SELECT relation_type, COUNT(*) AS records,
                 COUNT(DISTINCT parent_id) AS parents,
                 COUNT(DISTINCT child_id) AS children
          FROM relations
          GROUP BY relation_type
        `).all();
      }
    }

    console.log(JSON.stringify(result, null, 2));
  } finally {
    db.close();
  }
}

async function summary(path: string) {
  const data = JSON.parse(await readFile(path, "utf8")) as Obj;
  const errors: Obj[] = Array.isArray(data.endpoint_errors) ? data.endpoint_errors : [];
  const byResource: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const examples: Obj[] = [];

  for (const e of errors) {
    const resource = String(e.resource ?? "unknown");
    const status = String(e.status ?? "no_status");
    byResource[resource] = (byResource[resource] ?? 0) + 1;
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    if (examples.length < 30) examples.push(e);
  }

  console.log(JSON.stringify({
    started_at: data.started_at,
    finished_at: data.finished_at,
    auth_mode: data.auth_mode,
    resources: data.resources,
    total_errors: errors.length,
    errors_by_resource: byResource,
    errors_by_status: byStatus,
    sample_errors: examples,
    notes: data.notes
  }, null, 2));
}

async function searchDatasets(path: string, terms: string[]) {
  if (!terms.length) {
    console.error("Укажите хотя бы один поисковый термин.");
    process.exitCode = 2;
    return;
  }

  const db = openDb(path);
  try {
    if (!tableExists(db, "objects")) throw new Error("В базе нет таблицы objects");
    const columns = tableColumns(db, "objects");
    if (!["object_type", "object_id", "title", "payload_json"].every(c => columns.includes(c))) {
      throw new Error("Неожиданная схема objects");
    }

    const rows = db.query(`
      SELECT object_id, title, payload_json
      FROM objects
      WHERE object_type='dataset'
    `).all() as Obj[];

    const normalized = terms.map(t => t.toLocaleLowerCase("ru"));
    const hits = rows.map(row => {
      const payload = parseJson(row.payload_json) ?? {};
      const sql = String(payload.sql ?? "");
      const tableName = String(payload.table_name ?? "");
      const schema = String(payload.schema ?? "");
      const catalog = String(payload.catalog ?? "");
      const description = String(payload.description ?? "");
      const haystack = [row.title, tableName, schema, catalog, description, sql]
        .filter(Boolean).join("\n").toLocaleLowerCase("ru");
      const matched = normalized.filter(term => haystack.includes(term));
      if (!matched.length) return null;

      const kind = String(payload.kind ?? "");
      const score = matched.length * 10
        + (/\bid_courier\b|\bcourier_id\b/i.test(sql) ? 30 : 0)
        + (/\bdate_delivered\b|\bdate_supply\b|\bevent_date\b/i.test(sql) ? 20 : 0)
        + (/\bphone\b|\bname_courier\b|\bfio\b/i.test(sql) ? 5 : 0);

      return {
        id: row.object_id,
        title: row.title,
        table_name: tableName,
        schema,
        catalog,
        kind,
        database: payload.database?.database_name ?? null,
        sql_length: sql.length,
        matched_terms: matched,
        score,
        sql_preview: sql.slice(0, 1600)
      };
    }).filter(Boolean) as Obj[];

    hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, "ru"));
    console.log(JSON.stringify({
      terms,
      dataset_records_scanned: rows.length,
      matches: hits.length,
      results: hits
    }, null, 2));
  } finally {
    db.close();
  }
}

async function inspectObject(path: string, type: string, id: string) {
  const db = openDb(path);
  try {
    const row = db.query(`
      SELECT object_type, object_id, title, payload_json, collected_at
      FROM objects
      WHERE object_type=? AND object_id=?
    `).get(type, id) as Obj | null;

    if (!row) {
      console.error(`Объект не найден: ${type}/${id}`);
      process.exitCode = 1;
      return;
    }

    console.log(JSON.stringify({
      ...row,
      payload: parseJson(row.payload_json) ?? row.payload_json
    }, null, 2));
  } finally {
    db.close();
  }
}

const args = argsAfterCommand();
const command = args.shift() ?? "help";

try {
  switch (command) {
    case "audit":
      if (!args[0]) throw new Error("Укажите путь к catalog.sqlite");
      await audit(args[0]);
      break;
    case "summary":
      if (!args[0]) throw new Error("Укажите путь к discovery_summary.json");
      await summary(args[0]);
      break;
    case "search":
      if (!args[0]) throw new Error("Укажите путь к catalog.sqlite");
      await searchDatasets(args[0], args.slice(1));
      break;
    case "object":
      if (args.length < 3) throw new Error("Нужно: object <db> <type> <id>");
      await inspectObject(args[0], args[1], args[2]);
      break;
    default:
      usage();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
