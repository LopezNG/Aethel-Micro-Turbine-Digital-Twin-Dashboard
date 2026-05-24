import { Gauge, Sigma, TrendingDown } from 'lucide-react'
import { useMemo } from 'react'
import { cn } from '@/lib/cn'
import type { MetricComparison } from './mockData'

type PerformanceMetricsProps = {
  metrics: MetricComparison[]
  className?: string
}

function formatMetric(value: number, unit: string) {
  return `${value.toFixed(3)} ${unit}`
}

function improvementFor(metric: MetricComparison) {
  if (metric.baseline === 0) return 0
  const numerator = metric.lowerIsBetter ? metric.baseline - metric.lstm : metric.lstm - metric.baseline
  return (numerator / Math.abs(metric.baseline)) * 100
}

function MetricTile({ metric }: { metric: MetricComparison }) {
  const improvement = improvementFor(metric)
  const improved = improvement >= 0
  const maxValue = Math.max(metric.baseline, metric.lstm, 0.001)
  const baselineWidth = `${Math.max((metric.baseline / maxValue) * 100, 3)}%`
  const lstmWidth = `${Math.max((metric.lstm / maxValue) * 100, 3)}%`

  return (
    <article className="rounded-lg border border-white/10 bg-black/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-font-primary">{metric.label}</h3>
          <p className="mt-1 text-xs text-font-secondary">{metric.description}</p>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-md px-2 py-1 font-mono text-xs font-semibold',
            improved ? 'bg-accent-green/10 text-accent-green' : 'bg-accent-orange/10 text-accent-orange',
          )}
        >
          {improvement > 0 ? '+' : ''}
          {improvement.toFixed(1)}%
        </span>
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <div className="mb-1 flex items-center justify-between gap-3 font-mono text-[0.6875rem]">
            <span className="text-font-secondary">Baseline Model</span>
            <span className="text-font-primary">{formatMetric(metric.baseline, metric.unit)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-font-tertiary" style={{ width: baselineWidth }} />
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between gap-3 font-mono text-[0.6875rem]">
            <span className="text-accent-cyan">LSTM Model</span>
            <span className="text-accent-cyan">{formatMetric(metric.lstm, metric.unit)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-accent-cyan shadow-[0_0_14px_rgba(0,245,255,0.58)]"
              style={{ width: lstmWidth }}
            />
          </div>
        </div>
      </div>
    </article>
  )
}

export function PerformanceMetrics({ metrics, className }: PerformanceMetricsProps) {
  const summary = useMemo(() => {
    const globalRmse = metrics.find((metric) => metric.id === 'global-rmse') ?? metrics[0]
    const transitionRmse = metrics.find((metric) => metric.id === 'transition-rmse') ?? metrics[0]
    const averageImprovement =
      metrics.length === 0
        ? 0
        : metrics.reduce((sum, metric) => sum + improvementFor(metric), 0) / metrics.length

    return { globalRmse, transitionRmse, averageImprovement }
  }, [metrics])

  return (
    <aside
      className={cn(
        'flex min-w-0 flex-col gap-4 rounded-lg border border-white/10 bg-white/[0.045] p-5 shadow-[0_22px_80px_rgba(0,0,0,0.32)] backdrop-blur-xl',
        className,
      )}
    >
      <header>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-font-tertiary">
          <Sigma className="h-4 w-4 text-accent-green" />
          A/B Testing Panel
        </div>
        <h2 className="mt-2 text-xl font-semibold text-font-primary">Model Performance</h2>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <article className="rounded-lg border border-white/10 bg-black/20 p-4">
          <div className="flex items-center justify-between gap-2 text-xs text-font-secondary">
            <span>Baseline Model</span>
            <Gauge className="h-4 w-4 text-font-tertiary" />
          </div>
          <p className="mt-3 font-mono text-2xl font-bold text-font-primary">
            {summary.globalRmse ? formatMetric(summary.globalRmse.baseline, summary.globalRmse.unit) : '--'}
          </p>
          <p className="mt-1 text-xs text-font-tertiary">Global RMSE</p>
        </article>

        <article className="rounded-lg border border-accent-cyan/30 bg-accent-cyan/10 p-4 shadow-[0_0_28px_rgba(0,245,255,0.08)]">
          <div className="flex items-center justify-between gap-2 text-xs text-accent-cyan">
            <span>LSTM Model</span>
            <TrendingDown className="h-4 w-4" />
          </div>
          <p className="mt-3 font-mono text-2xl font-bold text-accent-cyan">
            {summary.globalRmse ? formatMetric(summary.globalRmse.lstm, summary.globalRmse.unit) : '--'}
          </p>
          <p className="mt-1 text-xs text-font-secondary">Global RMSE</p>
        </article>
      </div>

      <div className="rounded-lg border border-accent-green/20 bg-accent-green/10 p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-font-primary">Average improvement</span>
          <span
            className={cn(
              'font-mono text-lg font-bold',
              summary.averageImprovement >= 0 ? 'text-accent-green' : 'text-accent-orange',
            )}
          >
            {summary.averageImprovement > 0 ? '+' : ''}
            {summary.averageImprovement.toFixed(1)}%
          </span>
        </div>
        {summary.transitionRmse && (
          <p className="mt-2 text-xs text-font-secondary">
            Transition RMSE drops from {formatMetric(summary.transitionRmse.baseline, summary.transitionRmse.unit)} to{' '}
            {formatMetric(summary.transitionRmse.lstm, summary.transitionRmse.unit)}.
          </p>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3">
        {metrics.map((metric) => (
          <MetricTile key={metric.id} metric={metric} />
        ))}
      </div>
    </aside>
  )
}
