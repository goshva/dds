/** UI-2.3: placeholder нереализованной страницы (вынесен из dispatch для соблюдения лимита 200 строк). */
import { card, pageHeader, statusBadge, trusted, type TrustedHtml } from "../components";
import type { ForecastHorizon, ForecastMode } from "../routing";

export function forecastNotImplemented(input: { valid: boolean; mode: ForecastMode | null; horizon: ForecastHorizon | null; canonical: string }): TrustedHtml {
  const params = input.valid ? `${input.mode} · h${input.horizon}` : "параметры маршрута некорректны";
  return trusted(`
${pageHeader({ title: "Прогнозирование", subtitle: "Исторические прогнозы и результаты теневого наблюдения", right: statusBadge({ status: "NOT_AVAILABLE", text: "NOT_IMPLEMENTED" }) })}
${card({
    title: "Страница прогнозирования ещё не реализована",
    subtitle: `режим и горизонт: ${params}`,
    body: trusted(`<div class="ds-sub">Раздел находится в разработке. Данные прогнозов не запрашивались, поэтому отсутствие прогнозов здесь не утверждается. Канонический адрес раздела: ${input.canonical}</div>`),
  })}`);
}
