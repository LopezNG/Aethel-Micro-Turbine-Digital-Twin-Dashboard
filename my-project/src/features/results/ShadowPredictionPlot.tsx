import { Activity, GitCompareArrows, Waves } from 'lucide-react'
import { useMemo } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { cn } from '@/lib/cn'
import type { PredictionPoint } from './mockData'

type ShadowPredictionPlotProps = {
  data: PredictionPoint[]
  datasetLabel: string
  subtitle: string
  className?: string
}

type TooltipPayload = {
  color?: string
  dataKey?: string | number
  name?: string | number
  payload?: PredictionPoint
  value?: number | string
}

type ChartTooltipProps = {
  active?: boolean
  payload?: TooltipPayload[]
}

type TransitionBand = {
  start: number
  end: number
}

const SERIES = [
  { label: 'Ground Truth Power', color: '#FFFFFF', line: 'solid' },
  { label: 'Baseline Linear Prediction', color: '#8B95A5', line: 'dashed' },
  { label: 'Advanced LSTM Prediction', color: '#00F5FF', line: 'solid' },
] as const

function formatPower(value: number | undefined) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--'
  return `${value.toFixed(2)} kW`
}

function buildTransitionBands(data: PredictionPoint[]) {
  const bands: TransitionBand[] = []
  let activeBand: TransitionBand | null = null

  data.forEach((point) => {
    if (point.phase === 'transition') {
      activeBand ??= { start: point.timestamp - 0.45, end: point.timestamp + 0.45 }
      activeBand.end = point.timestamp + 0.45
      return
    }

    if (activeBand) {
      bands.push(activeBand)
      activeBand = null
    }
  })

  if (activeBand) bands.push(activeBand)
  return bands
}

function PredictionTooltip({ active, payload }: ChartTooltipProps) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null

  const baselineError = point.baselinePrediction - point.groundTruthPower
  const lstmError = point.lstmPrediction - point.groundTruthPower
  const lagReduction = Math.abs(baselineError) - Math.abs(lstmError)
  const isTransition = point.phase === 'transition'

  return (
    <div className="min-w-72 rounded-lg border border-white/10 bg-bg-deep/95 p-3 shadow-[0_22px_70px_rgba(0,0,0,0.48)] backdrop-blur-xl">
      <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-2">
        <span className="font-mono text-xs text-font-secondary">{point.timeLabel}</span>
        <span
          className={cn(
            'rounded px-2 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.16em]',
            isTransition
              ? 'bg-accent-orange/15 text-accent-orange'
              : 'bg-white/5 text-font-secondary',
          )}
        >
          {point.phase}
        </span>
      </div>

      <div className="mt-3 grid gap-2 font-mono text-xs">
        <div className="flex items-center justify-between gap-4 text-accent-orange">
          <span>Input voltage</span>
          <span>{point.inputVoltage.toFixed(2)} V</span>
        </div>
        <div className="flex items-center justify-between gap-4 text-white">
          <span>Ground truth</span>
          <span>{formatPower(point.groundTruthPower)}</span>
        </div>
        <div className="flex items-center justify-between gap-4 text-font-secondary">
          <span>Baseline linear</span>
          <span>{formatPower(point.baselinePrediction)}</span>
        </div>
        <div className="flex items-center justify-between gap-4 text-accent-cyan">
          <span>Advanced LSTM</span>
          <span>{formatPower(point.lstmPrediction)}</span>
        </div>
      </div>

      {isTransition && (
        <div className="mt-3 rounded-md border border-accent-orange/20 bg-accent-orange/10 p-2 text-xs leading-relaxed text-font-primary">
          <span className="font-semibold text-accent-orange">Lag watch: </span>
          baseline trails by {Math.abs(baselineError).toFixed(2)} kW while LSTM is{' '}
          {Math.max(lagReduction, 0).toFixed(2)} kW closer to the observed response.
        </div>
      )}
    </div>
  )
}

export function ShadowPredictionPlot({
  data,
  datasetLabel,
  subtitle,
  className,
}: ShadowPredictionPlotProps) {
  const powerDomain = useMemo<[number, number]>(() => {
    const values = data.flatMap((point) => [
      point.groundTruthPower,
      point.baselinePrediction,
      point.lstmPrediction,
    ])
    if (values.length === 0) return [0, 8]
    const min = Math.max(0, Math.min(...values) - 0.45)
    const max = Math.max(...values) + 0.45
    return [Number(min.toFixed(1)), Number(max.toFixed(1))]
  }, [data])

  const transitionBands = useMemo(() => buildTransitionBands(data), [data])
  const latest = data.at(-1)

  return (
    <section
      className={cn(
        'flex min-h-[640px] min-w-0 flex-col rounded-lg border border-white/10 bg-white/[0.035] p-5 shadow-[0_26px_90px_rgba(0,0,0,0.34)] backdrop-blur-xl',
        className,
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-font-tertiary">
            <Waves className="h-4 w-4 text-accent-cyan" />
            Shadow Prediction Plot
          </div>
          <h2 className="mt-2 text-xl font-semibold leading-tight text-font-primary sm:text-2xl">
            {datasetLabel}
          </h2>
          <p className="mt-1 text-sm text-font-secondary">{subtitle}</p>
        </div>

        <div className="grid grid-cols-3 gap-2 font-mono text-xs">
          <div className="min-w-20 rounded-md border border-white/10 bg-black/20 px-3 py-2">
            <p className="text-font-tertiary">Samples</p>
            <p className="mt-1 text-font-primary">{data.length}</p>
          </div>
          <div className="min-w-20 rounded-md border border-white/10 bg-black/20 px-3 py-2">
            <p className="text-font-tertiary">Voltage</p>
            <p className="mt-1 text-accent-orange">
              {latest ? `${latest.inputVoltage.toFixed(1)} V` : '--'}
            </p>
          </div>
          <div className="min-w-20 rounded-md border border-white/10 bg-black/20 px-3 py-2">
            <p className="text-font-tertiary">LSTM</p>
            <p className="mt-1 text-accent-cyan">{formatPower(latest?.lstmPrediction)}</p>
          </div>
        </div>
      </header>

      <div className="mt-5 flex min-h-0 flex-1 flex-col gap-3 rounded-lg border border-white/10 bg-[#0D1117] p-3">
        <div className="flex items-center justify-between gap-3 px-1">
          <div className="flex items-center gap-2 text-xs font-medium text-font-secondary">
            <Activity className="h-3.5 w-3.5 text-accent-orange" />
            Input Voltage
          </div>
          <span className="font-mono text-[0.6875rem] text-font-tertiary">stepped response driver</span>
        </div>

        <div className="h-32 min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} syncId="aethel-shadow-plot" margin={{ top: 4, right: 24, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.07)" strokeDasharray="3 8" vertical={false} />
              <XAxis
                dataKey="timestamp"
                domain={['dataMin', 'dataMax']}
                hide
                type="number"
              />
              <YAxis
                domain={[0, 10]}
                width={38}
                tickLine={false}
                axisLine={false}
                tick={{ fill: '#FF5C00', fontSize: 11 }}
                tickFormatter={(value) => `${value}V`}
              />
              {transitionBands.map((band) => (
                <ReferenceArea
                  key={`${band.start}-${band.end}-voltage`}
                  x1={band.start}
                  x2={band.end}
                  fill="#FF5C00"
                  fillOpacity={0.08}
                  strokeOpacity={0}
                />
              ))}
              <Tooltip content={<PredictionTooltip />} cursor={{ stroke: '#FF5C00', strokeOpacity: 0.42 }} />
              <Line
                dataKey="inputVoltage"
                dot={false}
                isAnimationActive={false}
                name="Input Voltage"
                stroke="#FF5C00"
                strokeWidth={2.4}
                type="stepAfter"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-1 pt-3">
          <div className="flex items-center gap-2 text-xs font-medium text-font-secondary">
            <GitCompareArrows className="h-3.5 w-3.5 text-accent-cyan" />
            Power Output Comparison
          </div>
          <div className="flex flex-wrap gap-3">
            {SERIES.map((series) => (
              <span key={series.label} className="inline-flex items-center gap-2 text-xs text-font-secondary">
                <span
                  className={cn('h-0.5 w-5 rounded-full', series.line === 'dashed' && 'border-t border-dashed')}
                  style={{ backgroundColor: series.line === 'dashed' ? 'transparent' : series.color, borderColor: series.color }}
                />
                {series.label}
              </span>
            ))}
          </div>
        </div>

        <div className="min-h-[330px] min-w-0 flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} syncId="aethel-shadow-plot" margin={{ top: 14, right: 24, bottom: 8, left: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.07)" strokeDasharray="3 8" vertical={false} />
              <XAxis
                dataKey="timestamp"
                domain={['dataMin', 'dataMax']}
                minTickGap={28}
                tickLine={false}
                axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                tick={{ fill: '#8B95A5', fontSize: 11 }}
                tickFormatter={(value) => `${value}s`}
                type="number"
              />
              <YAxis
                domain={powerDomain}
                width={48}
                tickLine={false}
                axisLine={false}
                tick={{ fill: '#8B95A5', fontSize: 11 }}
                tickFormatter={(value) => `${Number(value).toFixed(1)}`}
              />
              {transitionBands.map((band) => (
                <ReferenceArea
                  key={`${band.start}-${band.end}-power`}
                  x1={band.start}
                  x2={band.end}
                  fill="#FF5C00"
                  fillOpacity={0.07}
                  strokeOpacity={0}
                />
              ))}
              <Tooltip content={<PredictionTooltip />} cursor={{ stroke: '#00F5FF', strokeOpacity: 0.38 }} />
              <Line
                dataKey="groundTruthPower"
                dot={false}
                isAnimationActive={false}
                name="Ground Truth Power"
                stroke="#FFFFFF"
                strokeOpacity={0.86}
                strokeWidth={2}
                type="monotone"
              />
              <Line
                dataKey="baselinePrediction"
                dot={false}
                isAnimationActive={false}
                name="Baseline Linear Prediction"
                stroke="#8B95A5"
                strokeDasharray="7 7"
                strokeOpacity={0.78}
                strokeWidth={2}
                type="monotone"
              />
              <Line
                dataKey="lstmPrediction"
                dot={false}
                isAnimationActive={false}
                name="Advanced LSTM Prediction"
                stroke="#00F5FF"
                strokeWidth={3}
                style={{ filter: 'drop-shadow(0 0 10px rgba(0,245,255,0.72))' }}
                type="monotone"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  )
}
