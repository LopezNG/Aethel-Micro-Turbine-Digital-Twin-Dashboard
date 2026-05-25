import { Activity, RadioTower, Zap } from 'lucide-react'
import { useMemo } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ConnectionStatus, TelemetryPoint } from './types'

type TelemetryChartProps = {
  points: TelemetryPoint[]
  status: ConnectionStatus
  lastError: string | null
}

type ChartPoint = {
  sequence: number
  timeLabel: string
  inputVoltage: number
  actualPower: number | null
  predictedPower: number
  confidenceRange: [number, number]
}

function formatPower(value: number | null | undefined) {
  if (value === null || value === undefined) return '--'
  if (value >= 1000) return `${(value / 1000).toFixed(2)} kW`
  return `${Math.round(value)} W`
}

function formatTooltipValue(value: unknown, name: unknown) {
  const label = String(name)
  if (Array.isArray(value)) {
    return [`${formatPower(Number(value[0]))} - ${formatPower(Number(value[1]))}`, label]
  }
  if (typeof value === 'number' && label.toLowerCase().includes('voltage')) {
    return [`${value.toFixed(2)} V`, label]
  }
  if (typeof value === 'number') return [formatPower(value), label]
  return [String(value), label]
}

export function TelemetryChart({ points, status, lastError }: TelemetryChartProps) {
  const data = useMemo<ChartPoint[]>(
    () =>
      points.map((point) => ({
        sequence: point.sequence,
        timeLabel: point.time.toFixed(1),
        inputVoltage: point.inputVoltage,
        actualPower: point.elPower,
        predictedPower: point.predictedPower,
        confidenceRange: [point.confidenceLow, point.confidenceHigh],
      })),
    [points],
  )

  const powerDomain = useMemo<[number, number]>(() => {
    const values = points.flatMap((point) => [
      point.elPower ?? point.predictedPower,
      point.predictedPower,
      point.confidenceHigh,
      point.confidenceLow,
    ])
    if (values.length === 0) return [0, 2200]
    const min = Math.max(Math.min(...values) - 140, 0)
    const max = Math.max(...values) + 180
    return [Math.floor(min / 100) * 100, Math.ceil(max / 100) * 100]
  }, [points])

  const latest = points.at(-1)

  return (
    <section className="relative flex min-h-[560px] min-w-0 flex-col rounded-lg border border-white/10 bg-white/[0.035] p-5 shadow-[0_26px_90px_rgba(0,0,0,0.34)] backdrop-blur-xl">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-font-tertiary">
            <RadioTower className="h-4 w-4 text-accent-cyan" />
            Live Telemetry
          </div>
          <h2 className="mt-2 text-2xl font-semibold leading-tight">Voltage to Power Response</h2>
        </div>
        <div className="grid grid-cols-3 gap-3 font-mono text-xs">
          <div className="min-w-24 rounded-md border border-white/10 bg-black/20 px-3 py-2">
            <p className="text-font-tertiary">Samples</p>
            <p className="mt-1 text-font-primary">{points.length}</p>
          </div>
          <div className="min-w-24 rounded-md border border-white/10 bg-black/20 px-3 py-2">
            <p className="text-font-tertiary">Voltage</p>
            <p className="mt-1 text-accent-orange">
              {latest ? `${latest.inputVoltage.toFixed(2)} V` : '--'}
            </p>
          </div>
          <div className="min-w-24 rounded-md border border-white/10 bg-black/20 px-3 py-2">
            <p className="text-font-tertiary">Prediction</p>
            <p className="mt-1 text-accent-cyan">{formatPower(latest?.predictedPower)}</p>
          </div>
        </div>
      </header>

      <div className="mt-5 min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 12, right: 8, bottom: 8, left: 0 }}>
            <defs>
              <linearGradient id="aethelConfidence" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#00F5FF" stopOpacity={0.24} />
                <stop offset="100%" stopColor="#00F5FF" stopOpacity={0.025} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(255,255,255,0.07)" strokeDasharray="3 8" vertical={false} />
            <XAxis
              dataKey="timeLabel"
              minTickGap={34}
              tickLine={false}
              axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
              tick={{ fill: '#8B95A5', fontSize: 11 }}
            />
            <YAxis
              yAxisId="voltage"
              domain={[0, 10]}
              width={44}
              tickLine={false}
              axisLine={false}
              tick={{ fill: '#FF5C00', fontSize: 11 }}
              tickFormatter={(value) => `${value}V`}
            />
            <YAxis
              yAxisId="power"
              orientation="right"
              domain={powerDomain}
              width={62}
              tickLine={false}
              axisLine={false}
              tick={{ fill: '#8B95A5', fontSize: 11 }}
              tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`}
            />
            <Tooltip
              formatter={formatTooltipValue}
              contentStyle={{
                background: 'rgba(11, 15, 20, 0.92)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 8,
                color: '#fff',
                boxShadow: '0 18px 60px rgba(0,0,0,0.4)',
              }}
              labelStyle={{ color: '#8B95A5', fontSize: 12 }}
            />
            <Legend
              verticalAlign="top"
              align="right"
              iconType="plainline"
              wrapperStyle={{ color: '#8B95A5', fontSize: 12, paddingBottom: 14 }}
            />
            <Area
              yAxisId="power"
              name="Prediction Band"
              type="monotone"
              dataKey="confidenceRange"
              stroke="none"
              fill="url(#aethelConfidence)"
              isAnimationActive={false}
            />
            <Line
              yAxisId="voltage"
              name="Input Voltage"
              type="stepAfter"
              dataKey="inputVoltage"
              stroke="#FF5C00"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0, fill: '#FF5C00' }}
              isAnimationActive={false}
            />
            <Line
              yAxisId="power"
              name="Ground Truth"
              type="monotone"
              dataKey="actualPower"
              stroke="rgba(255,255,255,0.58)"
              strokeWidth={1.8}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              yAxisId="power"
              name="Prediction"
              type="monotone"
              dataKey="predictedPower"
              stroke="#00F5FF"
              strokeWidth={2.6}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0, fill: '#00F5FF' }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {points.length === 0 && (
        <div className="pointer-events-none absolute inset-x-5 top-32 grid place-items-center rounded-lg border border-dashed border-white/10 bg-black/20 py-20 text-center">
          <Activity className="mb-3 h-7 w-7 text-font-tertiary" />
          <p className="font-mono text-sm text-font-secondary">
            {status === 'open' ? 'Waiting for turbine samples' : 'Connecting to turbine stream'}
          </p>
        </div>
      )}

      {lastError && (
        <div className="mt-4 flex items-center gap-2 rounded-md border border-accent-orange/20 bg-accent-orange/10 px-3 py-2 text-sm text-accent-orange">
          <Zap className="h-4 w-4 shrink-0" />
          <span className="min-w-0 truncate">{lastError}</span>
        </div>
      )}
    </section>
  )
}
