import { Activity, Clock3, Gauge, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { SimulationMetrics, TelemetryPoint } from './types'

type MetricsPanelProps = {
  metrics: SimulationMetrics
  currentPoint: TelemetryPoint | null
}

function formatWatts(value: number | null) {
  if (value === null) return '--'
  return `${Math.round(value)} W`
}

function formatLag(value: number | null) {
  if (value === null) return '--'
  return `${value.toFixed(2)} s`
}

function lagTone(value: number | null) {
  if (value === null) return 'bg-font-tertiary'
  if (value < 1) return 'bg-accent-green'
  if (value < 2.5) return 'bg-accent-yellow'
  return 'bg-accent-orange'
}

function MetricRow({
  label,
  value,
  detail,
  icon: Icon,
  tone = 'cyan',
}: {
  label: string
  value: string
  detail: string
  icon: typeof Activity
  tone?: 'cyan' | 'green' | 'orange'
}) {
  const iconTone = {
    cyan: 'text-accent-cyan',
    green: 'text-accent-green',
    orange: 'text-accent-orange',
  }[tone]

  return (
    <div className="grid grid-cols-[auto_1fr] gap-3 border-b border-white/10 py-4 last:border-b-0">
      <span className="grid h-9 w-9 place-items-center rounded-md border border-white/10 bg-white/[0.04]">
        <Icon className={cn('h-4 w-4', iconTone)} />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium text-font-secondary">{label}</p>
        <p className="mt-1 font-mono text-xl font-semibold leading-none text-font-primary">{value}</p>
        <p className="mt-1 truncate text-xs text-font-tertiary">{detail}</p>
      </div>
    </div>
  )
}

export function MetricsPanel({ metrics, currentPoint }: MetricsPanelProps) {
  const lagRatio = Math.min((metrics.temporalLagSeconds ?? 0) / 4, 1)
  const confidencePercent = currentPoint
    ? Math.min(((currentPoint.confidenceHigh - currentPoint.confidenceLow) / currentPoint.predictedPower) * 100, 99)
    : null

  return (
    <aside className="flex min-w-0 flex-col gap-5 rounded-lg border border-white/10 bg-white/[0.045] p-5 shadow-[0_22px_80px_rgba(0,0,0,0.32)] backdrop-blur-xl">
      <header>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-font-tertiary">
          <ShieldCheck className="h-4 w-4 text-accent-green" />
          Performance
        </div>
        <h2 className="mt-2 text-xl font-semibold leading-tight">Metrics and XAI</h2>
      </header>

      <div className="rounded-lg border border-white/10 bg-black/20 px-4">
        <MetricRow
          icon={Activity}
          label="Transition MAE"
          value={formatWatts(metrics.transitionMae)}
          detail={`${metrics.transitionCount} detected voltage edges`}
          tone="orange"
        />
        <MetricRow
          icon={Gauge}
          label="Stationary MAE"
          value={formatWatts(metrics.stationaryMae)}
          detail={`${metrics.sampleCount} rolling samples in memory`}
          tone="cyan"
        />
        <MetricRow
          icon={Clock3}
          label="Temporal Lag"
          value={formatLag(metrics.temporalLagSeconds)}
          detail="Predicted crossing delay vs. observed power"
          tone="green"
        />
      </div>

      <section className="rounded-lg border border-white/10 bg-black/20 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-font-secondary">Lag Heat Bar</p>
            <p className="mt-1 font-mono text-sm text-font-tertiary">0s target / 4s alert</p>
          </div>
          <p className="font-mono text-sm text-font-primary">{formatLag(metrics.temporalLagSeconds)}</p>
        </div>
        <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/10">
          <div
            className={cn('h-full rounded-full transition-all duration-500', lagTone(metrics.temporalLagSeconds))}
            style={{ width: `${Math.max(lagRatio * 100, metrics.temporalLagSeconds === null ? 8 : 4)}%` }}
          />
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 font-mono text-xs">
        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <p className="text-font-tertiary">CI Width</p>
          <p className="mt-2 text-lg font-semibold text-accent-cyan">
            {formatWatts(metrics.confidenceWidth)}
          </p>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <p className="text-font-tertiary">Relative CI</p>
          <p className="mt-2 text-lg font-semibold text-font-primary">
            {confidencePercent === null ? '--' : `${confidencePercent.toFixed(1)}%`}
          </p>
        </div>
      </section>

      <section className="mt-auto rounded-lg border border-accent-cyan/15 bg-accent-cyan/5 p-4">
        <p className="text-xs font-medium text-font-secondary">Active Explainer Signal</p>
        <p className="mt-2 text-sm leading-6 text-font-primary">
          {currentPoint?.isTransition
            ? 'Voltage edge detected. Transition weighting is active for the rolling error metric.'
            : 'Stationary regime. Error is evaluated against settled turbine output.'}
        </p>
      </section>
    </aside>
  )
}
