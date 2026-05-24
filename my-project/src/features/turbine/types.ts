import type { ExperimentMetadata, ExperimentMode, FilterMode, ModelInfo, ModelVersion } from '@/lib/api'

export type DatasetId = string
export type SimulationMode = 'historical' | 'manual'
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
  filterMode: FilterMode
  phase: 'steady_state' | 'rising_transition' | 'falling_transition'
  alertStatus: 'normal' | 'anomaly' | 'maintenance_required' | null
  severity: 'low' | 'medium' | 'high' | null
  message: string | null
}

export type SimulationMetrics = {
  transitionMae: number | null
  stationaryMae: number | null
  temporalLagSeconds: number | null
  confidenceWidth: number | null
  sampleCount: number
  transitionCount: number
}

export type { ExperimentMetadata, ExperimentMode, FilterMode, ModelInfo, ModelVersion }
