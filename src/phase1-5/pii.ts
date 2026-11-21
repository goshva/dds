/**
 * Этап 1.5 — безопасный скан PII для fixtures и отчётов.
 * Не считает 10-значные dataset ID номером ИНН: требуется контекст поля.
 */
export type PiiHit = { name: string; sample: string };

const PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "phone", re: /\+7[\s\-()]*\d{3}[\s\-()]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}/ },
  { name: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  { name: "inn_context", re: /(?:inn|инн)["'\s:=]{1,4}\d{10,12}/i },
  { name: "snils", re: /\b\d{3}-\d{3}-\d{3}\s?\d{2}\b/ },
  { name: "passport", re: /\b\d{2}\s?\d{2}\s?\d{6}\b/ },
  { name: "bearer", re: /Bearer\s+[A-Za-z0-9._\-]{10,}/i },
  { name: "password", re: /password\s*[:=]\s*["']?[^"'\s]{4,}/i },
  { name: "real_name_sample", re: /\b(Иванов|Петров|Сидоров|Иван|Пётр|Петр)\b/ },
];

export function scanPiiSafe(text: string): PiiHit[] {
  const hits: PiiHit[] = [];
  for (const p of PATTERNS) {
    const m = text.match(p.re);
    if (m) hits.push({ name: p.name, sample: m[0].slice(0, 40) });
  }
  return hits;
}
