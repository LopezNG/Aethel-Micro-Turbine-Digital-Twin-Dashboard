export type PredictionPhase = 'steady_state' | 'rising_transition' | 'falling_transition'

export type PredictionPoint = {
  timestamp: number
  timeLabel: string
  inputVoltage: number
  groundTruthPower: number | null
  baselinePrediction: number | null
  lstmPrediction: number | null
  uncertaintyLower: number | null
  uncertaintyUpper: number | null
  uncertaintyMethod: string | null
  coverage: number | null
  phase: PredictionPhase
}

export type MetricComparison = {
  id: string
  label: string
  description: string
  unit: string
  baseline: number
  lstm: number
  lowerIsBetter: boolean
}

export type ExplainabilityPoint = {
  label: string
  importance: number
  raw_change_kw?: number
  rawValue?: number
  unit?: string
}

export type ExplainabilityResponse = {
  available: boolean
  model: string
  method?: string
  reason?: string
  items: ExplainabilityPoint[]
}

export type ResidualPoint = {
  sample: number
  timestamp: number
  predictedPower: number
  residual: number
  phase: PredictionPhase
}

export type CrossCorrelationRow = {
  label: string
  values: Array<number | null>
}

export type CrossCorrelationPayload = {
  lags: number[]
  rows: CrossCorrelationRow[]
}

export type ResponseEvent = {
  step_time: number
  direction: 'rising' | 'falling'
  from_voltage?: number
  to_voltage?: number
  rise_time_seconds: number | null
  settling_time_seconds: number | null
  overshoot_percent: number | null
  peak_response_kw: number | null
  final_value_kw: number | null
  initial_value_kw?: number | null
}

export type ResponseCharacteristicsPayload = {
  available: boolean
  reason: string | null
  events: ResponseEvent[]
  steps?: ResponseEvent[]
}

export type BackendPredictionPoint = {
  timestamp: number
  input_voltage: number
  ground_truth_power_kw: number | null
  predicted_power_kw: number
  uncertainty_lower_kw: number
  uncertainty_upper_kw: number
  uncertainty_method?: string
  coverage?: number | null
  residual: number | null
  phase: PredictionPhase
}

export type BackendPredictionPayload = {
  model: 'baseline' | 'lstm'
  uncertainty_method?: string
  uncertainty_source?: string
  coverage?: number | null
  points: BackendPredictionPoint[]
}

export type BackendMetric = {
  mae: number
  rmse: number
  r2: number | null
  mape: number | null
  peak_absolute_error: number
  latency_ms: number
  stationary_rmse: number | null
  rising_transition_rmse: number | null
  falling_transition_rmse: number | null
}

export type SummaryPayload = {
  experiments: Record<string, { baseline?: BackendMetric; lstm?: BackendMetric }>
  overall: { baseline?: BackendMetric; lstm?: BackendMetric }
}
