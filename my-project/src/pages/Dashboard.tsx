import { useEffect, useMemo, useState } from 'react'
import { useTopbar } from '@/components/layout/TopbarContext'
import {
  ExperimentCard,
  KPITile,
  LiveIndicator,
  type Experiment,
} from '@/components/ui'
import { apiGet, type ExperimentMetadata } from '@/lib/api'
import type { SummaryPayload } from '@/features/results/types'

export default function Dashboard() {
  const setTopbar = useTopbar()
  const [experiments, setExperiments] = useState<ExperimentMetadata[]>([])
  const [summary, setSummary] = useState<SummaryPayload | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)

  useEffect(() => {
    setTopbar({
      left: <h1 className="text-lg font-semibold">Overview</h1>,
      right: <LiveIndicator />,
    })
  }, [setTopbar])

  useEffect(() => {
    let cancelled = false
    async function loadOverview() {
      try {
        const [experimentPayload, summaryPayload] = await Promise.all([
          apiGet<{ experiments: ExperimentMetadata[] }>('/api/experiments', { include_unknown: true }),
          apiGet<SummaryPayload>('/api/results/summary'),
        ])
        if (cancelled) return
        setExperiments(experimentPayload.experiments)
        setSummary(summaryPayload)
      } catch (error) {
        if (!cancelled) setLastError(error instanceof Error ? error.message : 'Unable to load overview')
      }
    }
    loadOverview()
    return () => {
      cancelled = true
    }
  }, [])

  const cards = useMemo<Experiment[]>(() => experiments.map(toExperimentCard), [experiments])
  const lstm = summary?.overall.lstm
  const baseline = summary?.overall.baseline

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      {lastError && (
        <div className="rounded-lg border border-accent-orange/20 bg-accent-orange/10 px-4 py-3 text-sm text-accent-orange">
          {lastError}
        </div>
      )}

      <section className="grid grid-cols-1 gap-4 min-[901px]:grid-cols-2 min-[1101px]:grid-cols-3">
        <KPITile label="LSTM Test RMSE" value={lstm ? `${lstm.rmse.toFixed(3)} kW` : '--'} accent="cyan" />
        <KPITile label="Baseline Test RMSE" value={baseline ? `${baseline.rmse.toFixed(3)} kW` : '--'} accent="orange" />
        <KPITile label="LSTM Latency" value={lstm ? `${lstm.latency_ms.toFixed(2)}ms` : '--'} accent="green" />
      </section>

      <section className="flex flex-1 flex-col gap-3">
        <h2 className="text-[0.9375rem] font-semibold">Registered Experiments</h2>
        {cards.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/10 bg-surface-card p-5 text-sm text-font-secondary">
            No experiments are registered by the backend.
          </div>
        ) : (
          cards.map((exp) => (
            <ExperimentCard key={exp.id} experiment={exp} />
          ))
        )}
      </section>
    </div>
  )
}

function toExperimentCard(experiment: ExperimentMetadata): Experiment {
  const duration = experiment.duration_seconds ? `${Math.round(experiment.duration_seconds).toLocaleString()}s` : 'duration unknown'
  const trendSeed = Math.max(1, Math.round(experiment.sample_count / 1000))
  return {
    id: experiment.experiment_id,
    name: `${experiment.experiment_id} · ${experiment.split} · ${experiment.mode}`,
    meta: `${experiment.sample_count.toLocaleString()} samples · ${duration} · ${experiment.mode_source}`,
    status: 'complete',
    trend: [trendSeed, trendSeed + 3, Math.max(trendSeed - 2, 1), trendSeed + 5, trendSeed + 1],
    trendColor: experiment.split === 'test' ? 'orange' : experiment.mode === 'continuous' ? 'green' : 'cyan',
  }
}

