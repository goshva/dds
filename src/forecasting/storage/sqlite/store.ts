/**
 * Хранилище прогнозной системы: единственное место, владеющее соединением с SQLite,
 * и фасад, отдающий репозитории. Бизнес-логика не обращается к `bun:sqlite` напрямую.
 */

import type { Database } from "bun:sqlite";

import type {
  EventsRepository,
  FeaturesRepository,
  ForecastRepository,
  MetricsRepository,
  RawRepository,
} from "../interfaces/repositories";
import { closeDatabase, databaseInfo, openDatabase, type DatabaseInfo, type OpenDatabaseOptions } from "./connection";
import { migrate, type MigrationReport } from "./migrations";
import { SqliteEventsRepository } from "./repositories/events-repository";
import { SqliteFeaturesRepository } from "./repositories/features-repository";
import { SqliteForecastRepository } from "./repositories/forecast-repository";
import { SqliteMetricsRepository } from "./repositories/metrics-repository";
import { SqliteRawRepository } from "./repositories/raw-repository";

export interface OpenStoreOptions extends OpenDatabaseOptions {
  /** применить миграции сразу после открытия (по умолчанию true, кроме readonly) */
  migrateOnOpen?: boolean;
  now?: string;
}

export interface ForecastingStore {
  readonly path: string;
  readonly db: Database;
  readonly raw: RawRepository;
  readonly metrics: MetricsRepository;
  readonly features: FeaturesRepository;
  readonly events: EventsRepository;
  readonly forecast: ForecastRepository;
  info(): DatabaseInfo;
  close(): void;
}

/** Открывает прогнозную базу, при необходимости применяет миграции и подключает репозитории. */
export async function openStore(path: string, opts: OpenStoreOptions = {}): Promise<ForecastingStore & { migration?: MigrationReport }> {
  const db = await openDatabase(path, opts);
  let migration: MigrationReport | undefined;
  const shouldMigrate = opts.migrateOnOpen ?? !opts.readonly;
  if (shouldMigrate) {
    migration = await migrate(db);
  }

  const store: ForecastingStore & { migration?: MigrationReport } = {
    path,
    db,
    raw: new SqliteRawRepository(db),
    metrics: new SqliteMetricsRepository(db),
    features: new SqliteFeaturesRepository(db),
    events: new SqliteEventsRepository(db),
    forecast: new SqliteForecastRepository(db),
    info: () => databaseInfo(db, path),
    close: () => closeDatabase(db),
    migration,
  };
  return store;
}
