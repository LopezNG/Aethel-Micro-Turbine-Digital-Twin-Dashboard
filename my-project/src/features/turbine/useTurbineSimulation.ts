import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE_URL, apiGet, toWebSocketUrl } from '@/lib/api'
import type {
  ConnectionStatus,
  DatasetId,
  ExperimentMetadata,
  ExperimentMode,
  FilterMode,
  ModelInfo,
  ModelVersion,
  SimulationMetrics,
  SimulationMode,
  TelemetryPoint,
} from './types'

const MAX_POINTS = 220

type ControlMessage = {
  mode?: SimulationMode
  input_voltage?: number
  model?: ModelVersion
  model_version?: ModelVersion
  paused?: boolean
  tick_ms?: number
  dataset?: DatasetId
  experiment_id?: DatasetId
  filter_mode?: FilterMode
}

type ErrorPayload = {
  type: 'error' | 'control_error'
  message: string
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function numberValue(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function stringValue(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function parseTelemetry(payload: Record<string, unknown>): TelemetryPoint | null {
  if (payload.type !== 'telemetry') return null

  const mode = stringValue(payload.mode) === 'manual' ? 'manual' : 'historical'
  const modelVersion = stringValue(payload.model_version) === 'baseline' ? 'baseline' : 'lstm'
  const dataset = stringValue(payload.experiment_id, stringValue(payload.dataset, 'ex_22'))
  const elPower = typeof payload.el_power === 'number' ? payload.el_power : null
  const filterMode = ['voltage', 'power', 'both'].includes(stringValue(payload.filter_mode))
    ? (payload.filter_mode as FilterMode)
    : 'none'
  const phase = ['rising_transition', 'falling_transition'].includes(stringValue(payload.phase))
    ? (payload.phase as TelemetryPoint['phase'])
    : 'steady_state'
  const alertStatus = ['normal', 'anomaly', 'maintenance_required'].includes(stringValue(payload.alert_status))
    ? (payload.alert_status as TelemetryPoint['alertStatus'])
    : null
  const severity = ['low', 'medium', 'high'].includes(stringValue(payload.severity))
    ? (payload.severity as TelemetryPoint['severity'])
    : null

  return {
    sequence: numberValue(payload.sequence),
    serverTime: numberValue(payload.server_time),
    dataset,
    time: numberValue(payload.time),
    sourceVoltage: numberValue(payload.source_voltage),
    inputVoltage: numberValue(payload.input_voltage),
    elPower,
    predictedPower: numberValue(payload.predicted_power),
    confidenceLow: numberValue(payload.confidence_low),
    confidenceHigh: numberValue(payload.confidence_high),
    filteredVoltage: numberValue(payload.filtered_voltage),
    uncertainty: numberValue(payload.uncertainty),
    modelVersion,
    modelSource: stringValue(payload.model_source, 'unknown'),
    mode,
    isTransition: Boolean(payload.is_transition),
    latencyMs: numberValue(payload.latency_ms),
    filterMode,
    phase,
    alertStatus,
    severity,
    message: typeof payload.message === 'string' ? payload.message : null,
  }
}

function mean(values: number[]) {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function crossed(
  direction: number,
  value: number,
  threshold: number,
) {
  return direction >= 0 ? value >= threshold : value <= threshold
}

function estimateTemporalLag(points: TelemetryPoint[]) {
  const eligible = points.filter((point) => point.elPower !== null)
  if (eligible.length < 16) return null

  for (let index = eligible.length - 2; index >= 2; index -= 1) {
    const previous = eligible[index - 1]
    const current = eligible[index]
    const delta = current.inputVoltage - previous.inputVoltage
    if (Math.abs(delta) < 0.08) continue

    const window = eligible.slice(index, Math.min(index + 28, eligible.length))
    if (window.length < 8 || previous.elPower === null) return null

    const actualTail = window
      .slice(-5)
      .map((point) => point.elPower)
      .filter((value): value is number => value !== null)
    const steadyActual = mean(actualTail)
    if (steadyActual === null || Math.abs(steadyActual - previous.elPower) < 12) return null

    const direction = steadyActual - previous.elPower
    const threshold = previous.elPower + direction * 0.5
    const actualCross = window.find(
      (point) => point.elPower !== null && crossed(direction, point.elPower, threshold),
    )
    const predictionCross = window.find((point) =>
      crossed(direction, point.predictedPower, threshold),
    )

    if (!actualCross || !predictionCross) return null
    return Math.abs(predictionCross.time - actualCross.time)
  }

  return null
}

function calculateMetrics(points: TelemetryPoint[]): SimulationMetrics {
  const transitionErrors: number[] = []
  const stationaryErrors: number[] = []
  let transitionCountdown = 0
  let transitionCount = 0

  points.forEach((point, index) => {
    const previous = points[index - 1]
    const voltageDelta = previous ? Math.abs(point.inputVoltage - previous.inputVoltage) : 0
    if (point.isTransition || voltageDelta >= 0.08) {
      transitionCountdown = 8
      transitionCount += 1
    }

    if (point.elPower !== null) {
      const error = Math.abs(point.predictedPower - point.elPower)
      if (transitionCountdown > 0) {
        transitionErrors.push(error)
      } else {
        stationaryErrors.push(error)
      }
    }

    transitionCountdown = Math.max(transitionCountdown - 1, 0)
  })

  const confidenceWidths = points.map((point) => point.confidenceHigh - point.confidenceLow)

  return {
    transitionMae: mean(transitionErrors),
    stationaryMae: mean(stationaryErrors),
    temporalLagSeconds: estimateTemporalLag(points),
    confidenceWidth: mean(confidenceWidths),
    sampleCount: points.length,
    transitionCount,
  }
}

export function useTurbineSimulation() {
  const [points, setPoints] = useState<TelemetryPoint[]>([])
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [lastError, setLastError] = useState<string | null>(null)
  const [experiments, setExperiments] = useState<ExperimentMetadata[]>([])
  const [models, setModels] = useState<ModelInfo[]>([])
  const [experimentMode, setExperimentModeState] = useState<ExperimentMode | 'all'>('all')
  const [includeUnknown, setIncludeUnknownState] = useState(false)
  const [filterMode, setFilterModeState] = useState<FilterMode>('none')
  const [mode, setModeState] = useState<SimulationMode>('historical')
  const [modelVersion, setModelVersionState] = useState<ModelVersion>('lstm')
  const [manualVoltage, setManualVoltageState] = useState(3)
  const [dataset, setDatasetState] = useState<DatasetId>('ex_22')
  const [tickMs, setTickMsState] = useState(250)
  const [paused, setPausedState] = useState(false)

  const socketRef = useRef<WebSocket | null>(null)
  const reconnectRef = useRef<number | null>(null)
  const reconnectAttemptRef = useRef(0)
  const desiredStateRef = useRef({
    mode,
    modelVersion,
    manualVoltage,
    dataset,
    tickMs,
    paused,
    filterMode,
  })

  useEffect(() => {
    desiredStateRef.current = {
      mode,
      modelVersion,
      manualVoltage,
      dataset,
      tickMs,
      paused,
      filterMode,
    }
  }, [dataset, filterMode, manualVoltage, mode, modelVersion, paused, tickMs])

  const sendControl = useCallback((message: ControlMessage) => {
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    socket.send(JSON.stringify(message))
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadOptions() {
      try {
        const [experimentPayload, modelPayload] = await Promise.all([
          apiGet<{ experiments: ExperimentMetadata[] }>('/api/experiments', {
            mode: experimentMode === 'all' ? undefined : experimentMode,
            include_unknown: experimentMode === 'all' || includeUnknown,
          }),
          apiGet<{ models: ModelInfo[] }>('/api/models'),
        ])
        if (cancelled) return
        setExperiments(experimentPayload.experiments)
        const availableModels = modelPayload.models.filter((model) => model.available)
        setModels(availableModels)
        if (availableModels.length > 0 && !availableModels.some((model) => model.id === modelVersion)) {
          setModelVersionState(availableModels[0].id)
        }
        if (
          experimentPayload.experiments.length > 0 &&
          !experimentPayload.experiments.some((experiment) => experiment.experiment_id === dataset)
        ) {
          const nextDataset = experimentPayload.experiments[0].experiment_id
          setDatasetState(nextDataset)
          setPoints([])
          sendControl({ experiment_id: nextDataset, dataset: nextDataset })
        }
      } catch (error) {
        if (!cancelled) setLastError(error instanceof Error ? error.message : 'Unable to load experiments')
      }
    }

    loadOptions()
    return () => {
      cancelled = true
    }
  }, [dataset, experimentMode, includeUnknown, modelVersion, sendControl])

  useEffect(() => {
    let cancelled = false
    const wsBase = toWebSocketUrl(API_BASE_URL)

    const connect = () => {
      if (cancelled) return
      const desired = desiredStateRef.current
      setStatus('connecting')

      const url = new URL(`${wsBase}/ws/live`)
      url.searchParams.set('experiment_id', desired.dataset)
      url.searchParams.set('tick_ms', String(desired.tickMs))
      url.searchParams.set('model', desired.modelVersion)
      url.searchParams.set('filter_mode', desired.filterMode)

      const socket = new WebSocket(url)
      socketRef.current = socket

      socket.onopen = () => {
        reconnectAttemptRef.current = 0
        setStatus('open')
        setLastError(null)
        const current = desiredStateRef.current
        sendControl({
          dataset: current.dataset,
          experiment_id: current.dataset,
          mode: current.mode,
          model: current.modelVersion,
          model_version: current.modelVersion,
          input_voltage: current.manualVoltage,
          tick_ms: current.tickMs,
          paused: current.paused,
          filter_mode: current.filterMode,
        })
      }

      socket.onmessage = (event) => {
        let parsedPayload: unknown
        try {
          parsedPayload = JSON.parse(String(event.data))
        } catch {
          setLastError('Received malformed telemetry payload.')
          return
        }

        const parsed = asRecord(parsedPayload)
        if (!parsed) return

        const telemetry = parseTelemetry(parsed)
        if (telemetry) {
          setPoints((existing) => [...existing, telemetry].slice(-MAX_POINTS))
          return
        }

        if (parsed.type === 'ready') {
          setLastError(null)
          return
        }

        if (parsed.type === 'error' || parsed.type === 'control_error') {
          setLastError((parsed as ErrorPayload).message)
        }
      }

      socket.onerror = () => {
        setStatus('error')
        setLastError('Telemetry socket encountered a transport error.')
      }

      socket.onclose = () => {
        if (cancelled) return
        setStatus('closed')
        const attempt = reconnectAttemptRef.current + 1
        reconnectAttemptRef.current = attempt
        const delay = Math.min(750 * 2 ** attempt, 5000)
        reconnectRef.current = window.setTimeout(connect, delay)
      }
    }

    connect()

    return () => {
      cancelled = true
      if (reconnectRef.current !== null) {
        window.clearTimeout(reconnectRef.current)
      }
      socketRef.current?.close(1000, 'component unmounted')
      socketRef.current = null
    }
  }, [sendControl])

  const setMode = useCallback(
    (nextMode: SimulationMode) => {
      setModeState(nextMode)
      sendControl({ mode: nextMode })
    },
    [sendControl],
  )

  const setModelVersion = useCallback(
    (nextModel: ModelVersion) => {
      setModelVersionState(nextModel)
      sendControl({ model: nextModel, model_version: nextModel })
    },
    [sendControl],
  )

  const setManualVoltage = useCallback(
    (nextVoltage: number) => {
      const safeVoltage = clamp(Number(nextVoltage.toFixed(3)), 0, 10)
      setManualVoltageState(safeVoltage)
      setModeState('manual')
      sendControl({ mode: 'manual', input_voltage: safeVoltage })
    },
    [sendControl],
  )

  const setDataset = useCallback(
    (nextDataset: DatasetId) => {
      setDatasetState(nextDataset)
      setPoints([])
      sendControl({ dataset: nextDataset, experiment_id: nextDataset })
    },
    [sendControl],
  )

  const setPaused = useCallback(
    (nextPaused: boolean) => {
      setPausedState(nextPaused)
      sendControl({ paused: nextPaused })
    },
    [sendControl],
  )

  const setTickMs = useCallback(
    (nextTickMs: number) => {
      const safeTick = Math.round(clamp(nextTickMs, 50, 5000))
      setTickMsState(safeTick)
      sendControl({ tick_ms: safeTick })
    },
    [sendControl],
  )

  const setExperimentMode = useCallback(
    (nextMode: ExperimentMode | 'all') => {
      setExperimentModeState(nextMode)
    },
    [],
  )

  const setIncludeUnknown = useCallback((nextIncludeUnknown: boolean) => {
    setIncludeUnknownState(nextIncludeUnknown)
  }, [])

  const setFilterMode = useCallback(
    (nextFilterMode: FilterMode) => {
      setFilterModeState(nextFilterMode)
      setPoints([])
      sendControl({ filter_mode: nextFilterMode })
    },
    [sendControl],
  )

  const metrics = useMemo(() => calculateMetrics(points), [points])
  const currentPoint = points.at(-1) ?? null

  return {
    points,
    currentPoint,
    metrics,
    status,
    lastError,
    experiments,
    models,
    experimentMode,
    includeUnknown,
    filterMode,
    mode,
    modelVersion,
    manualVoltage,
    dataset,
    tickMs,
    paused,
    setMode,
    setModelVersion,
    setManualVoltage,
    setDataset,
    setTickMs,
    setPaused,
    setExperimentMode,
    setIncludeUnknown,
    setFilterMode,
  }
}
