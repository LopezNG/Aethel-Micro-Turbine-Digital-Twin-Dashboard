export type HistoricalDatasetId = 'ex_4' | 'ex_22'

export type PredictionPhase = 'stationary' | 'transition'

export type PredictionPoint = {
  timestamp: number
  timeLabel: string
  inputVoltage: number
  groundTruthPower: number
  baselinePrediction: number
  lstmPrediction: number
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

export type FeatureImportancePoint = {
  feature: string
  importance: number
}

export type ResidualPoint = {
  sample: number
  predictedPower: number
  residual: number
}

export type SandboxStep = {
  id: string
  voltage: number
  seconds: number
}

export type SandboxPredictionPoint = PredictionPoint & {
  scenarioStep: number
}

export type HistoricalShowcase = {
  id: HistoricalDatasetId
  label: string
  subtitle: string
  data: PredictionPoint[]
  metrics: MetricComparison[]
  featureImportance: FeatureImportancePoint[]
  residuals: ResidualPoint[]
}

type VoltageSegment = {
  until: number
  voltage: number
}

const steadyPower = (voltage: number) => 0.42 + voltage * 0.72 + voltage * voltage * 0.015

function voltageAt(segments: VoltageSegment[], timestamp: number) {
  return segments.find((segment) => timestamp <= segment.until)?.voltage ?? segments.at(-1)?.voltage ?? 0
}

function buildHistoricalSeries(segments: VoltageSegment[], sampleCount: number) {
  const points: PredictionPoint[] = []
  let truth = steadyPower(segments[0]?.voltage ?? 0)
  let baseline = truth
  let lstm = truth
  let previousVoltage = segments[0]?.voltage ?? 0

  for (let index = 0; index < sampleCount; index += 1) {
    const inputVoltage = voltageAt(segments, index)
    const phase: PredictionPhase = Math.abs(inputVoltage - previousVoltage) > 0.05 ? 'transition' : 'stationary'
    const target = steadyPower(inputVoltage)
    const ripple = Math.sin(index * 0.72) * 0.035

    truth += (target - truth) * (phase === 'transition' ? 0.62 : 0.38)
    baseline += (target - baseline) * (phase === 'transition' ? 0.27 : 0.18)
    lstm += (truth - lstm) * (phase === 'transition' ? 0.78 : 0.5)

    points.push({
      timestamp: index,
      timeLabel: `${index}s`,
      inputVoltage,
      groundTruthPower: Number((truth + ripple).toFixed(3)),
      baselinePrediction: Number((baseline - (phase === 'transition' ? 0.18 : 0.025)).toFixed(3)),
      lstmPrediction: Number((lstm + ripple * 0.35).toFixed(3)),
      phase,
    })

    previousVoltage = inputVoltage
  }

  return points
}

function rootMeanSquare(values: number[]) {
  if (values.length === 0) return 0
  const squareMean = values.reduce((sum, value) => sum + value * value, 0) / values.length
  return Math.sqrt(squareMean)
}

function meanAbsolute(values: number[]) {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + Math.abs(value), 0) / values.length
}

function errorsFor(data: PredictionPoint[], key: 'baselinePrediction' | 'lstmPrediction', phase?: PredictionPhase) {
  return data
    .filter((point) => (phase ? point.phase === phase : true))
    .map((point) => point[key] - point.groundTruthPower)
}

function buildMetrics(data: PredictionPoint[]): MetricComparison[] {
  const baselineErrors = errorsFor(data, 'baselinePrediction')
  const lstmErrors = errorsFor(data, 'lstmPrediction')

  return [
    {
      id: 'global-rmse',
      label: 'Global RMSE',
      description: 'All samples',
      unit: 'kW',
      baseline: rootMeanSquare(baselineErrors),
      lstm: rootMeanSquare(lstmErrors),
      lowerIsBetter: true,
    },
    {
      id: 'mae',
      label: 'MAE',
      description: 'Mean absolute error',
      unit: 'kW',
      baseline: meanAbsolute(baselineErrors),
      lstm: meanAbsolute(lstmErrors),
      lowerIsBetter: true,
    },
    {
      id: 'transition-rmse',
      label: 'Transition-Phase RMSE',
      description: 'Only voltage step windows',
      unit: 'kW',
      baseline: rootMeanSquare(errorsFor(data, 'baselinePrediction', 'transition')),
      lstm: rootMeanSquare(errorsFor(data, 'lstmPrediction', 'transition')),
      lowerIsBetter: true,
    },
    {
      id: 'stationary-rmse',
      label: 'Stationary-Phase RMSE',
      description: 'Flat voltage windows',
      unit: 'kW',
      baseline: rootMeanSquare(errorsFor(data, 'baselinePrediction', 'stationary')),
      lstm: rootMeanSquare(errorsFor(data, 'lstmPrediction', 'stationary')),
      lowerIsBetter: true,
    },
  ]
}

function buildResiduals(data: PredictionPoint[]) {
  return data.map((point, sample) => ({
    sample,
    predictedPower: point.lstmPrediction,
    residual: Number((point.lstmPrediction - point.groundTruthPower).toFixed(3)),
  }))
}

export const FEATURE_IMPORTANCE: FeatureImportancePoint[] = [
  { feature: 'Voltage t-1s', importance: 0.92 },
  { feature: 'Voltage t-3s', importance: 0.76 },
  { feature: 'Rolling Mean', importance: 0.68 },
  { feature: 'Voltage t-5s', importance: 0.52 },
  { feature: 'Step Delta', importance: 0.43 },
  { feature: 'Load Memory', importance: 0.31 },
]

const EX_4_DATA = buildHistoricalSeries(
  [
    { until: 4, voltage: 3.1 },
    { until: 8, voltage: 7.0 },
    { until: 13, voltage: 7.0 },
    { until: 17, voltage: 4.5 },
    { until: 23, voltage: 6.2 },
    { until: 30, voltage: 5.1 },
  ],
  31,
)

const EX_22_DATA = buildHistoricalSeries(
  [
    { until: 5, voltage: 2.8 },
    { until: 9, voltage: 5.8 },
    { until: 14, voltage: 5.8 },
    { until: 18, voltage: 8.2 },
    { until: 23, voltage: 6.2 },
    { until: 30, voltage: 6.2 },
  ],
  31,
)

export const HISTORICAL_SHOWCASES: Record<HistoricalDatasetId, HistoricalShowcase> = {
  ex_4: {
    id: 'ex_4',
    label: 'Ex_4 Historical Test Set',
    subtitle: 'Low-to-high voltage step with mid-run recovery',
    data: EX_4_DATA,
    metrics: buildMetrics(EX_4_DATA),
    featureImportance: FEATURE_IMPORTANCE,
    residuals: buildResiduals(EX_4_DATA),
  },
  ex_22: {
    id: 'ex_22',
    label: 'Ex_22 Historical Test Set',
    subtitle: 'Multi-step profile with high-voltage transient',
    data: EX_22_DATA,
    metrics: buildMetrics(EX_22_DATA),
    featureImportance: FEATURE_IMPORTANCE,
    residuals: buildResiduals(EX_22_DATA),
  },
}

export const DEFAULT_SANDBOX_STEPS: SandboxStep[] = [
  { id: 'step-1', voltage: 3, seconds: 5 },
  { id: 'step-2', voltage: 7, seconds: 10 },
  { id: 'step-3', voltage: 5.5, seconds: 6 },
]

export function buildSandboxPrediction(steps: SandboxStep[]): SandboxPredictionPoint[] {
  const sanitizedSteps = steps
    .map((step) => ({
      ...step,
      voltage: Math.min(Math.max(step.voltage, 0), 10),
      seconds: Math.max(Math.round(step.seconds), 1),
    }))
    .filter((step) => step.seconds > 0)

  const points: SandboxPredictionPoint[] = []
  let truth = steadyPower(sanitizedSteps[0]?.voltage ?? 0)
  let baseline = truth
  let lstm = truth
  let timestamp = 0
  let previousVoltage = sanitizedSteps[0]?.voltage ?? 0

  sanitizedSteps.forEach((step, stepIndex) => {
    for (let offset = 0; offset < step.seconds; offset += 1) {
      const phase: PredictionPhase = Math.abs(step.voltage - previousVoltage) > 0.05 || offset < 2 ? 'transition' : 'stationary'
      const target = steadyPower(step.voltage)
      const ripple = Math.sin((timestamp + 2) * 0.58) * 0.025

      truth += (target - truth) * (phase === 'transition' ? 0.66 : 0.34)
      baseline += (target - baseline) * (phase === 'transition' ? 0.25 : 0.17)
      lstm += (truth - lstm) * (phase === 'transition' ? 0.8 : 0.52)

      points.push({
        timestamp,
        timeLabel: `${timestamp}s`,
        inputVoltage: step.voltage,
        groundTruthPower: Number((truth + ripple).toFixed(3)),
        baselinePrediction: Number((baseline - (phase === 'transition' ? 0.16 : 0.02)).toFixed(3)),
        lstmPrediction: Number((lstm + ripple * 0.25).toFixed(3)),
        phase,
        scenarioStep: stepIndex + 1,
      })

      previousVoltage = step.voltage
      timestamp += 1
    }
  })

  return points
}
