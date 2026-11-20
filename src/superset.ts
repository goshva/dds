import type { Config } from "./config";

export class SupersetClient {
  private token = "";
  private csrf = "";

  constructor(private cfg: Config) {
    this.token = cfg.accessToken;
  }

  private async request(path: string, init: RequestInit = {}): Promise<any> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (this.token) headers.set("Authorization", `Bearer ${this.token}`);
    if (this.csrf) headers.set("X-CSRFToken", this.csrf);
    try {
      const response = await fetch(new URL(path, this.cfg.baseUrl), {
        ...init, headers, signal: controller.signal
      });
      const body = await response.text();
      let parsed: any;
      try { parsed = body ? JSON.parse(body) : null; }
      catch { parsed = { raw_text: body.slice(0, 4000) }; }
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status} ${response.statusText}: ${JSON.stringify(parsed).slice(0, 1500)}`);
        (error as any).status = response.status;
        throw error;
      }
      return parsed;
    } finally {
      clearTimeout(timer);
    }
  }

  async login(): Promise<void> {
    if (this.token) return;
    if (!this.cfg.username || !this.cfg.password) {
      throw new Error("Set SUPERSET_ACCESS_TOKEN or SUPERSET_USERNAME + SUPERSET_PASSWORD");
    }
    const result = await this.request("/api/v1/security/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: this.cfg.username,
        password: this.cfg.password,
        provider: this.cfg.provider,
        refresh: true
      })
    });
    if (!result?.access_token) throw new Error("Login response did not contain access_token");
    this.token = result.access_token;
  }

  async getCsrf(): Promise<void> {
    try {
      const result = await this.request("/api/v1/security/csrf_token/");
      this.csrf = result?.result ?? "";
    } catch (error) {
      // Read-only GET discovery can still proceed with JWT if CSRF endpoint is restricted.
      console.warn(`[WARN] CSRF endpoint unavailable: ${String(error)}`);
    }
  }

  async get(path: string): Promise<any> {
    return this.request(path);
  }

  async list(resource: "dashboard" | "chart" | "dataset"): Promise<any[]> {
    const collected: any[] = [];
    for (let page = 0; page < this.cfg.maxPages; page++) {
      const q = encodeURIComponent(`(page:${page},page_size:${this.cfg.pageSize})`);
      const result = await this.get(`/api/v1/${resource}/?q=${q}`);
      const rows = Array.isArray(result?.result) ? result.result : [];
      collected.push(...rows);
      const count = Number(result?.count ?? result?.result?.length ?? rows.length);
      if (rows.length === 0 || collected.length >= count || rows.length < this.cfg.pageSize) break;
    }
    return collected;
  }

  async tryGet(path: string): Promise<{ ok: true; data: any } | { ok: false; error: string; status?: number }> {
    try { return { ok: true, data: await this.get(path) }; }
    catch (e) { return { ok: false, error: String(e), status: (e as any)?.status }; }
  }

  authMode(): string {
    return this.cfg.accessToken ? "provided-jwt" : "username-password";
  }
}
