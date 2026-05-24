export type DatasetId = 'ex_9' | 'ex_22'
export type SimulationMode = 'historical' | 'manual'
export type ModelVersion = 'baseline' | 'lstm'
export type ConnectionStatus = 'connecting' | 'open' | 'closed' | 'error'

export type TelemetryPoint = {
  sequence: number
  serverTime: number
  dataset: DatasetId
  time: number
  sourceVoltage: number
  inputVoltage: number
  elPower: number | null
  predictedPower: number
  confidenceLow: number
  confidenceHigh: number
  filteredVoltage: number
  uncertainty: number
  modelVersion: ModelVersion
  modelSource: string
  mode: SimulationMode
  isTransition: boolean
  latencyMs: number
}

export type SimulationMetrics = {
  transitionMae: number | null
  stationaryMae: number | null
  temporalLagSeconds: number | null
  confidenceWidth: number | null
  sampleCount: number
  transitionCount: number
}
