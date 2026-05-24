import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ConnectionStatus,
  DatasetId,
  ModelVersion,
  SimulationMetrics,
  SimulationMode,
  TelemetryPoint,
} from './types'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'
const MAX_POINTS = 220

type ControlMessage = {
  mode?: SimulationMode
  input_voltage?: number
  model_version?: ModelVersion
  paused?: boolean
  tick_ms?: number
  dataset?: DatasetId
}

type ErrorPayload = {
  type: 'error' | 'control_error'
  message: string
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function toWebSocketUrl(baseUrl: string) {
  const url = new URL(baseUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString().replace(/\/$/, '')
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
  const dataset = stringValue(payload.dataset) === 'ex_9' ? 'ex_9' : 'ex_22'
  const elPower = typeof payload.el_power === 'number' ? payload.el_power : null

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
    modelSource: stringValue(payload.model_source, 'stub'),
    mode,
    isTransition: Boolean(payload.is_transition),
    latencyMs: numberValue(payload.latency_ms),
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
  })

  useEffect(() => {
    desiredStateRef.current = {
      mode,
      modelVersion,
      manualVoltage,
      dataset,
      tickMs,
      paused,
    }
  }, [dataset, manualVoltage, mode, modelVersion, paused, tickMs])

  const sendControl = useCallback((message: ControlMessage) => {
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    socket.send(JSON.stringify(message))
  }, [])

  useEffect(() => {
    let cancelled = false
    const wsBase = toWebSocketUrl(API_BASE_URL)

    const connect = () => {
      if (cancelled) return
      const desired = desiredStateRef.current
      setStatus('connecting')

      const url = new URL(`${wsBase}/ws/simulate`)
      url.searchParams.set('dataset', desired.dataset)
      url.searchParams.set('tick_ms', String(desired.tickMs))
      url.searchParams.set('model_version', desired.modelVersion)

      const socket = new WebSocket(url)
      socketRef.current = socket

      socket.onopen = () => {
        reconnectAttemptRef.current = 0
        setStatus('open')
        setLastError(null)
        const current = desiredStateRef.current
        sendControl({
          dataset: current.dataset,
          mode: current.mode,
          model_version: current.modelVersion,
          input_voltage: current.manualVoltage,
          tick_ms: current.tickMs,
          paused: current.paused,
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
      sendControl({ model_version: nextModel })
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
      sendControl({ dataset: nextDataset })
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

  const metrics = useMemo(() => calculateMetrics(points), [points])
  const currentPoint = points.at(-1) ?? null

  return {
    points,
    currentPoint,
    metrics,
    status,
    lastError,
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
  }
}
