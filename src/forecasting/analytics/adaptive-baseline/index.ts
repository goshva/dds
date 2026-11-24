/** Публичный интерфейс вычислителя адаптивного baseline (Stage 3.4.5, изолированный модуль). */

export {
  calculateAdaptiveBaseline,
  calculateForVariant,
  DEFAULT_MIN_WEEKDAY_OBSERVATIONS,
  VARIANT_A_WEEKDAYS,
  type AdaptiveBaselineConfig,
  type AdaptiveBaselineInput,
  type AdaptiveBaselineResult,
  type AdaptiveDiagnostics,
  type AdaptiveStatus,
  type HistoryObservation,
  type Variant,
  type WeekdayProfile,
} from "./calculator";