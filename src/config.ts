export interface Config {
  baseUrl: string;
  username: string;
  password: string;
  provider: string;
  accessToken: string;
  timeoutMs: number;
  pageSize: number;
  maxPages: number;
  outputDir: string;
  sqlitePath: string;
  courierKeywords: string[];
  excludeKeywords: string[];
}

function intEnv(name: string, fallback: number): number {
  const raw = Bun.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function words(name: string, fallback: string): string[] {
  return (Bun.env[name] ?? fallback)
    .split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
}

export function loadConfig(): Config {
  const baseUrl = (Bun.env.SUPERSET_URL ?? "").replace(/\/+$/, "");
  if (!baseUrl) throw new Error("SUPERSET_URL is required");

  const parsed = new URL(baseUrl);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    throw new Error("SUPERSET_URL must use HTTPS outside localhost");
  }

  return {
    baseUrl,
    username: Bun.env.SUPERSET_USERNAME ?? "",
    password: Bun.env.SUPERSET_PASSWORD ?? "",
    provider: Bun.env.SUPERSET_PROVIDER ?? "db",
    accessToken: Bun.env.SUPERSET_ACCESS_TOKEN ?? "",
    timeoutMs: intEnv("HTTP_TIMEOUT_SECONDS", 30) * 1000,
    pageSize: intEnv("PAGE_SIZE", 100),
    maxPages: intEnv("MAX_PAGES", 50),
    outputDir: Bun.env.OUTPUT_DIR ?? "./output",
    sqlitePath: Bun.env.SQLITE_PATH ?? "./data/catalog.sqlite",
    courierKeywords: words("COURIER_KEYWORDS", "courier,курьер,доставка,delivery,доставк,курьерск,shipment,rider,driver,логист"),
    excludeKeywords: words("EXCLUDE_KEYWORDS", "sku,артикул,ассортимент,товар,product,товарная,корзин")
  };
}
