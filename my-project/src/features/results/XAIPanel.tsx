import { BrainCircuit, Crosshair, ScanSearch } from 'lucide-react'
import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { cn } from '@/lib/cn'
import type {
  CrossCorrelationPayload,
  ExplainabilityPoint,
  ExplainabilityResponse,
  ResidualPoint,
  ResponseCharacteristicsPayload,
} from './types'

type XAIPanelProps = {
  explainability: ExplainabilityResponse
  residuals: ResidualPoint[]
  crossCorrelation: CrossCorrelationPayload | null
  responseCharacteristics: ResponseCharacteristicsPayload | null
  className?: string
}

type TooltipPayload<T> = {
  payload?: T
  value?: number | string
}

type TooltipProps<T> = {
  active?: boolean
  payload?: TooltipPayload<T>[]
}

function ExplanationTooltip({ active, payload }: TooltipProps<ExplainabilityPoint>) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null

  return (
    <div className="rounded-md border border-white/10 bg-bg-deep/95 px-3 py-2 shadow-[0_18px_48px_rgba(0,0,0,0.42)]">
      <p className="text-xs font-semibold text-font-primary">{point.label}</p>
      <p className="mt-1 font-mono text-xs text-accent-cyan">{point.importance.toFixed(2)} importance</p>
      {typeof point.raw_change_kw === 'number' && (
        <p className="mt-1 font-mono text-xs text-font-tertiary">{point.raw_change_kw.toFixed(4)} kW delta</p>
      )}
    </div>
  )
}

function ResidualTooltip({ active, payload }: TooltipProps<ResidualPoint>) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null

  return (
    <div className="rounded-md border border-white/10 bg-bg-deep/95 px-3 py-2 shadow-[0_18px_48px_rgba(0,0,0,0.42)]">
      <p className="font-mono text-xs text-font-secondary">Sample {point.sample}</p>
      <p className="mt-1 font-mono text-xs text-font-primary">Prediction {point.predictedPower.toFixed(2)} kW</p>
      <p className={cn('mt-1 font-mono text-xs', Math.abs(point.residual) < 0.08 ? 'text-accent-green' : 'text-accent-orange')}>
        Residual {point.residual > 0 ? '+' : ''}
        {point.residual.toFixed(3)} kW
      </p>
    </div>
  )
}

export function XAIPanel({
  explainability,
  residuals,
  crossCorrelation,
  responseCharacteristics,
  className,
}: XAIPanelProps) {
  const residualStats = useMemo(() => {
    if (residuals.length === 0) return { mean: 0, maxAbs: 0 }
    const mean = residuals.reduce((sum, point) => sum + point.residual, 0) / residuals.length
    const maxAbs = Math.max(...residuals.map((point) => Math.abs(point.residual)))
    return { mean, maxAbs }
  }, [residuals])

  const responseEvents = responseCharacteristics?.events ?? responseCharacteristics?.steps ?? []

  return (
    <section
      className={cn(
        'grid min-w-0 grid-cols-1 gap-5 rounded-lg border border-white/10 bg-white/[0.035] p-5 shadow-[0_22px_80px_rgba(0,0,0,0.3)] backdrop-blur-xl min-[1180px]:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]',
        className,
      )}
    >
      <article className="min-w-0 rounded-lg border border-white/10 bg-black/20 p-4">
        <header className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-font-tertiary">
              <BrainCircuit className="h-4 w-4 text-accent-cyan" />
              Explainable AI
            </div>
            <h2 className="mt-2 text-lg font-semibold text-font-primary">Temporal Occlusion</h2>
          </div>
          <span className="rounded-md border border-accent-cyan/20 bg-accent-cyan/10 px-2.5 py-1 font-mono text-xs text-accent-cyan">
            {explainability.method?.replaceAll('_', ' ') ?? 'Unavailable'}
          </span>
        </header>

        {explainability.available ? (
          <div className="mt-4 h-72 min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={explainability.items}
                layout="vertical"
                margin={{ top: 8, right: 24, bottom: 8, left: 8 }}
              >
                <CartesianGrid stroke="rgba(255,255,255,0.07)" strokeDasharray="3 8" horizontal={false} />
                <XAxis
                  axisLine={false}
                  domain={[0, 1]}
                  tick={{ fill: '#8B95A5', fontSize: 11 }}
                  tickFormatter={(value) => Number(value).toFixed(1)}
                  tickLine={false}
                  type="number"
                />
                <YAxis
                  axisLine={false}
                  dataKey="label"
                  tick={{ fill: '#8B95A5', fontSize: 11 }}
                  tickLine={false}
                  type="category"
                  width={112}
                />
                <Tooltip content={<ExplanationTooltip />} cursor={{ fill: 'rgba(0,245,255,0.05)' }} />
                <Bar
                  dataKey="importance"
                  fill="#00F5FF"
                  radius={[0, 6, 6, 0]}
                  style={{ filter: 'drop-shadow(0 0 8px rgba(0,245,255,0.38))' }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="mt-4 grid h-72 place-items-center rounded-lg border border-dashed border-white/10 bg-bg-deep/50 p-6 text-center text-sm leading-6 text-font-secondary">
            {explainability.reason}
          </div>
        )}
      </article>

      <article className="min-w-0 rounded-lg border border-white/10 bg-black/20 p-4">
        <header className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-font-tertiary">
              <ScanSearch className="h-4 w-4 text-accent-orange" />
              Residual Audit
            </div>
            <h2 className="mt-2 text-lg font-semibold text-font-primary">Error Distribution</h2>
          </div>
          <div className="text-right font-mono text-xs">
            <p className="text-font-tertiary">Mean</p>
            <p className={cn('mt-1', Math.abs(residualStats.mean) < 0.03 ? 'text-accent-green' : 'text-accent-orange')}>
              {residualStats.mean > 0 ? '+' : ''}
              {residualStats.mean.toFixed(3)} kW
            </p>
          </div>
        </header>

        <div className="mt-4 h-72 min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 12, right: 12, bottom: 8, left: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.07)" strokeDasharray="3 8" />
              <XAxis
                dataKey="predictedPower"
                name="Predicted Power"
                tick={{ fill: '#8B95A5', fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                type="number"
                unit=" kW"
              />
              <YAxis
                dataKey="residual"
                domain={[-Math.max(residualStats.maxAbs, 0.18), Math.max(residualStats.maxAbs, 0.18)]}
                name="Residual"
                tick={{ fill: '#8B95A5', fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                type="number"
                unit=" kW"
                width={52}
              />
              <ReferenceLine y={0} stroke="#00E676" strokeDasharray="5 5" strokeOpacity={0.7} />
              <Tooltip content={<ResidualTooltip />} cursor={{ stroke: '#00F5FF', strokeOpacity: 0.32 }} />
              <Scatter data={residuals} fill="#00F5FF" fillOpacity={0.76} line={false} shape="circle" />
            </ScatterChart>
          </ResponsiveContainer>
        </div>

        <footer className="mt-3 flex items-center gap-2 rounded-md border border-accent-green/20 bg-accent-green/10 px-3 py-2 text-xs text-font-secondary">
          <Crosshair className="h-3.5 w-3.5 shrink-0 text-accent-green" />
          Residual is actual power minus predicted power.
        </footer>
      </article>

      <article className="min-w-0 rounded-lg border border-white/10 bg-black/20 p-4">
        <h2 className="text-lg font-semibold text-font-primary">Cross-Correlation Heatmap</h2>
        <div className="mt-4 overflow-x-auto">
          {crossCorrelation ? (
            <table className="w-full min-w-[560px] border-separate border-spacing-1 font-mono text-xs">
              <thead>
                <tr>
                  <th className="px-2 py-2 text-left text-font-tertiary">Signal Pair</th>
                  {crossCorrelation.lags.map((lag) => (
                    <th key={lag} className="px-2 py-2 text-right text-font-tertiary">
                      {lag}s
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {crossCorrelation.rows.map((row) => (
                  <tr key={row.label}>
                    <td className="rounded-md bg-white/[0.04] px-2 py-2 text-font-secondary">{row.label}</td>
                    {row.values.map((value, index) => (
                      <td
                        key={`${row.label}-${index}`}
                        className="rounded-md px-2 py-2 text-right text-font-primary"
                        style={{
                          backgroundColor:
                            value === null
                              ? 'rgba(255,255,255,0.04)'
                              : `rgba(${value >= 0 ? '0,245,255' : '255,92,0'},${Math.min(Math.abs(value), 1) * 0.55 + 0.08})`,
                        }}
                      >
                        {value === null ? '--' : value.toFixed(2)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="rounded-lg border border-dashed border-white/10 bg-bg-deep/50 p-4 text-sm text-font-secondary">
              Cross-correlation data is not available.
            </p>
          )}
        </div>
      </article>

      <article className="min-w-0 rounded-lg border border-white/10 bg-black/20 p-4">
        <h2 className="text-lg font-semibold text-font-primary">Response Characteristics</h2>
        {responseCharacteristics?.available ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {responseEvents.slice(0, 4).map((event) => (
              <div key={`${event.step_time}-${event.to_voltage ?? event.direction}`} className="rounded-lg border border-white/10 bg-bg-deep/50 p-3">
                <p className="font-mono text-xs text-font-tertiary">
                  {event.from_voltage?.toFixed(2) ?? '--'}V to {event.to_voltage?.toFixed(2) ?? '--'}V - {event.direction}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-xs">
                  <span className="text-font-secondary">Rise</span>
                  <span className="text-right text-font-primary">
                    {event.rise_time_seconds === null || event.rise_time_seconds === undefined
                      ? '--'
                      : `${event.rise_time_seconds.toFixed(2)}s`}
                  </span>
                  <span className="text-font-secondary">Settling</span>
                  <span className="text-right text-font-primary">
                    {event.settling_time_seconds === null || event.settling_time_seconds === undefined
                      ? '--'
                      : `${event.settling_time_seconds.toFixed(2)}s`}
                  </span>
                  <span className="text-font-secondary">Overshoot</span>
                  <span className="text-right text-font-primary">
                    {event.overshoot_percent === null || event.overshoot_percent === undefined
                      ? '--'
                      : `${event.overshoot_percent.toFixed(1)}%`}
                  </span>
                  <span className="text-font-secondary">Final</span>
                  <span className="text-right text-font-primary">
                    {event.final_value_kw === null || event.final_value_kw === undefined
                      ? '--'
                      : `${event.final_value_kw.toFixed(2)} kW`}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-4 rounded-lg border border-dashed border-white/10 bg-bg-deep/50 p-4 text-sm text-font-secondary">
            {responseCharacteristics?.reason ?? 'Response characteristics are not available.'}
          </p>
        )}
      </article>
    </section>
  )
}
