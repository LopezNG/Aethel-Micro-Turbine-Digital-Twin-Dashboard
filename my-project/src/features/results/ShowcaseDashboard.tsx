import { BarChart3, Database, FlaskConical } from 'lucide-react'
import type { ComponentType } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { apiGet, type ExperimentMetadata } from '@/lib/api'
import { cn } from '@/lib/cn'
import { PerformanceMetrics } from './PerformanceMetrics'
import { ShadowPredictionPlot } from './ShadowPredictionPlot'
import { XAIPanel } from './XAIPanel'
import { ZeroShotSandbox } from './ZeroShotSandbox'
import type {
  BackendMetric,
  BackendPredictionPayload,
  CrossCorrelationPayload,
  FeatureImportanceResponse,
  MetricComparison,
  PredictionPoint,
  ResidualPoint,
  ResponseCharacteristicsPayload,
  SummaryPayload,
} from './types'

type ShowcaseView = 'historical' | 'sandbox'

type SegmentButtonProps<T extends string> = {
  active: boolean
  icon?: ComponentType<{ className?: string }>
  label: string
  value: T
  onSelect: (value: T) => void
}

function SegmentButton<T extends string>({
  active,
  icon: Icon,
  label,
  value,
  onSelect,
}: SegmentButtonProps<T>) {
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className={cn(
        'inline-flex h-9 items-center justify-center gap-2 rounded-md px-3 text-xs font-semibold transition',
        active
          ? 'bg-accent-cyan text-bg-deep shadow-[0_0_26px_rgba(0,245,255,0.22)]'
          : 'text-font-secondary hover:bg-white/5 hover:text-font-primary',
      )}
    >
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {label}
    </button>
  )
}

const emptyFeatureImportance: FeatureImportanceResponse = {
  available: false,
  model: 'lstm',
  reason: 'Feature importance has not been loaded.',
  items: [],
}

export function ShowcaseDashboard() {
  const [view, setView] = useState<ShowcaseView>('historical')
  const [experiments, setExperiments] = useState<ExperimentMetadata[]>([])
  const [datasetId, setDatasetId] = useState('ex_22')
  const [summary, setSummary] = useState<SummaryPayload | null>(null)
  const [series, setSeries] = useState<PredictionPoint[]>([])
  const [residuals, setResiduals] = useState<ResidualPoint[]>([])
  const [featureImportance, setFeatureImportance] = useState<FeatureImportanceResponse>(emptyFeatureImportance)
  const [crossCorrelation, setCrossCorrelation] = useState<CrossCorrelationPayload | null>(null)
  const [responseCharacteristics, setResponseCharacteristics] = useState<ResponseCharacteristicsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastError, setLastError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function loadBase() {
      try {
        const [experimentPayload, summaryPayload] = await Promise.all([
          apiGet<{ experiments: ExperimentMetadata[] }>('/api/experiments', { split: 'test', include_unknown: true }),
          apiGet<SummaryPayload>('/api/results/summary'),
        ])
        if (cancelled) return
        setExperiments(experimentPayload.experiments)
        setSummary(summaryPayload)
        if (experimentPayload.experiments.length > 0 && !experimentPayload.experiments.some((item) => item.experiment_id === datasetId)) {
          setDatasetId(experimentPayload.experiments[0].experiment_id)
        }
      } catch (error) {
        if (!cancelled) setLastError(error instanceof Error ? error.message : 'Unable to load model results')
      }
    }
    loadBase()
    return () => {
      cancelled = true
    }
  }, [datasetId])

  useEffect(() => {
    let cancelled = false
    async function loadDataset() {
      setLoading(true)
      setLastError(null)
      try {
        const [baseline, lstm, residualPayload, importancePayload, heatmapPayload, responsePayload] = await Promise.all([
          apiGet<BackendPredictionPayload>('/api/results/predictions', { experiment_id: datasetId, model: 'baseline' }),
          apiGet<BackendPredictionPayload>('/api/results/predictions', { experiment_id: datasetId, model: 'lstm' }),
          apiGet<{ points: Array<{ sample: number; timestamp: number; predicted_power_kw: number; residual: number | null; phase: ResidualPoint['phase'] }> }>(
            '/api/results/residuals',
            { experiment_id: datasetId, model: 'lstm' },
          ),
          apiGet<FeatureImportanceResponse>('/api/results/feature-importance', { model: 'lstm' }),
          apiGet<CrossCorrelationPayload>('/api/results/cross-correlation', { experiment_id: datasetId, model: 'lstm' }),
          apiGet<ResponseCharacteristicsPayload>('/api/results/response-characteristics', { experiment_id: datasetId, model: 'lstm' }),
        ])
        if (cancelled) return
        setSeries(mergePredictionSeries(baseline, lstm))
        setResiduals(
          residualPayload.points
            .filter((point) => point.residual !== null)
            .map((point) => ({
              sample: point.sample,
              timestamp: point.timestamp,
              predictedPower: point.predicted_power_kw,
              residual: point.residual ?? 0,
              phase: point.phase,
            })),
        )
        setFeatureImportance(normalizeFeatureImportance(importancePayload))
        setCrossCorrelation(heatmapPayload)
        setResponseCharacteristics(responsePayload)
      } catch (error) {
        if (!cancelled) setLastError(error instanceof Error ? error.message : 'Unable to load backend results')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadDataset()
    return () => {
      cancelled = true
    }
  }, [datasetId])

  const selectedExperiment = experiments.find((experiment) => experiment.experiment_id === datasetId)
  const metrics = useMemo(() => buildMetrics(summary?.experiments[datasetId]), [datasetId, summary])
  const contextLabel = view === 'historical' ? `${datasetId} ${selectedExperiment?.split ?? 'test'} Set` : 'Custom Voltage Sandbox'

  return (
    <div className="flex flex-1 flex-col overflow-auto bg-[radial-gradient(circle_at_18%_10%,rgba(0,245,255,0.08),transparent_28%),radial-gradient(circle_at_86%_4%,rgba(255,92,0,0.08),transparent_24%)] p-4 sm:p-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-font-tertiary">
            <BarChart3 className="h-4 w-4 text-accent-cyan" />
            Results & ML Showcase
          </div>
          <h1 className="mt-2 text-2xl font-semibold leading-tight text-font-primary">
            {contextLabel}
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-font-secondary">
            Backend-generated validation using the real LSTM regression artifact and a trained baseline.
          </p>
        </div>

        <div className="flex flex-wrap justify-end gap-3">
          {view === 'historical' && (
            <div className="grid grid-flow-col auto-cols-fr gap-1 rounded-lg border border-white/10 bg-black/20 p-1">
              {experiments.map((experiment) => (
                <SegmentButton
                  key={experiment.experiment_id}
                  active={datasetId === experiment.experiment_id}
                  label={experiment.experiment_id}
                  value={experiment.experiment_id}
                  onSelect={setDatasetId}
                />
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-1 rounded-lg border border-white/10 bg-black/20 p-1">
            <SegmentButton
              active={view === 'historical'}
              icon={Database}
              label="Historical"
              value="historical"
              onSelect={setView}
            />
            <SegmentButton
              active={view === 'sandbox'}
              icon={FlaskConical}
              label="Sandbox"
              value="sandbox"
              onSelect={setView}
            />
          </div>
        </div>
      </header>

      {lastError && (
        <div className="mb-4 rounded-lg border border-accent-orange/20 bg-accent-orange/10 px-4 py-3 text-sm text-accent-orange">
          {lastError}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        {view === 'historical' ? (
          <>
            <ShadowPredictionPlot
              data={series}
              datasetLabel={selectedExperiment ? `${selectedExperiment.experiment_id} · ${selectedExperiment.mode}` : datasetId}
              subtitle={
                selectedExperiment
                  ? `${selectedExperiment.sample_count.toLocaleString()} samples · ${selectedExperiment.mode_source}`
                  : 'Loading backend experiment metadata'
              }
              className="xl:min-h-[calc(100vh-210px)]"
            />
            <PerformanceMetrics metrics={metrics} />
          </>
        ) : (
          <>
            <ZeroShotSandbox className="xl:min-h-[calc(100vh-210px)]" />
            <PerformanceMetrics metrics={metrics} />
          </>
        )}

        <div className="xl:col-span-2">
          {loading && view === 'historical' ? (
            <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.035] p-6 text-sm text-font-secondary">
              Loading backend predictions and residual reports...
            </div>
          ) : (
            <XAIPanel
              featureImportance={featureImportance}
              residuals={residuals}
              crossCorrelation={crossCorrelation}
              responseCharacteristics={responseCharacteristics}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function mergePredictionSeries(baseline: BackendPredictionPayload, lstm: BackendPredictionPayload): PredictionPoint[] {
  const baselineByTimestamp = new Map(baseline.points.map((point) => [point.timestamp, point]))
  const firstTimestamp = lstm.points[0]?.timestamp ?? baseline.points[0]?.timestamp ?? 0
  return lstm.points.map((point) => {
    const baselinePoint = baselineByTimestamp.get(point.timestamp)
    const relativeTime = point.timestamp - firstTimestamp
    return {
      timestamp: Number(relativeTime.toFixed(3)),
      timeLabel: `${relativeTime.toFixed(1)}s`,
      inputVoltage: point.input_voltage,
      groundTruthPower: point.ground_truth_power_kw,
      baselinePrediction: baselinePoint?.predicted_power_kw ?? null,
      lstmPrediction: point.predicted_power_kw,
      uncertaintyLower: point.uncertainty_lower_kw,
      uncertaintyUpper: point.uncertainty_upper_kw,
      phase: point.phase,
    }
  })
}

function buildMetrics(metrics?: { baseline?: BackendMetric; lstm?: BackendMetric }): MetricComparison[] {
  if (!metrics?.baseline || !metrics.lstm) return []
  const rows: Array<[string, string, string, keyof BackendMetric]> = [
    ['global-rmse', 'Global RMSE', 'All aligned test samples', 'rmse'],
    ['mae', 'MAE', 'Mean absolute error', 'mae'],
    ['peak-error', 'Peak Error', 'Worst absolute residual', 'peak_absolute_error'],
    ['stationary-rmse', 'Stationary RMSE', 'Flat voltage windows', 'stationary_rmse'],
    ['rising-rmse', 'Rising RMSE', 'Positive voltage transitions', 'rising_transition_rmse'],
    ['falling-rmse', 'Falling RMSE', 'Negative voltage transitions', 'falling_transition_rmse'],
  ]
  return rows.flatMap(([id, label, description, key]) => {
    const baselineValue = metrics.baseline?.[key]
    const lstmValue = metrics.lstm?.[key]
    if (typeof baselineValue !== 'number' || typeof lstmValue !== 'number') return []
    return [{
      id,
      label,
      description,
      unit: 'kW',
      baseline: baselineValue,
      lstm: lstmValue,
      lowerIsBetter: true,
    }]
  })
}

function normalizeFeatureImportance(payload: FeatureImportanceResponse): FeatureImportanceResponse {
  return {
    ...payload,
    items: payload.items.map((item) => ({
      ...item,
      rawValue: item.rawValue ?? (item as unknown as { raw_value?: number }).raw_value,
    })),
  }
}

