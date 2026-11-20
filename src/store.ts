import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export class CatalogStore {
  private db: Database;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS objects (
        object_type TEXT NOT NULL,
        object_id TEXT NOT NULL,
        title TEXT,
        payload_json TEXT NOT NULL,
        collected_at TEXT NOT NULL,
        PRIMARY KEY(object_type, object_id)
      );
      CREATE TABLE IF NOT EXISTS relations (
        parent_type TEXT NOT NULL,
        parent_id TEXT NOT NULL,
        child_type TEXT NOT NULL,
        child_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        collected_at TEXT NOT NULL,
        PRIMARY KEY(parent_type,parent_id,child_type,child_id,relation_type)
      );
    `);
  }

  saveObject(type: string, id: string, title: string, payload: unknown) {
    this.db.query(`INSERT INTO objects(object_type,object_id,title,payload_json,collected_at)
      VALUES(?,?,?,?,?)
      ON CONFLICT(object_type,object_id) DO UPDATE SET
      title=excluded.title,payload_json=excluded.payload_json,collected_at=excluded.collected_at`)
      .run(type, id, title, JSON.stringify(payload), new Date().toISOString());
  }

  saveRelation(parentType: string, parentId: string, childType: string, childId: string, relation: string) {
    this.db.query(`INSERT OR IGNORE INTO relations VALUES(?,?,?,?,?,?)`)
      .run(parentType, parentId, childType, childId, relation, new Date().toISOString());
  }

  close() { this.db.close(); }
}
