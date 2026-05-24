import { Clock3, Gauge, Loader2, Play, Plus, RotateCcw, Trash2, Zap } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { cn } from '@/lib/cn'
import {
  DEFAULT_SANDBOX_STEPS,
  buildSandboxPrediction,
  type SandboxPredictionPoint,
  type SandboxStep,
} from './mockData'

type ZeroShotSandboxProps = {
  className?: string
  initialSteps?: SandboxStep[]
  onSimulate?: (steps: SandboxStep[]) => Promise<SandboxPredictionPoint[]>
}

type SandboxTooltipPayload = {
  payload?: SandboxPredictionPoint
}

type SandboxTooltipProps = {
  active?: boolean
  payload?: SandboxTooltipPayload[]
}

function formatPower(value: number | undefined) {
  if (typeof value !== 'number') return '--'
  return `${value.toFixed(2)} kW`
}

function SandboxTooltip({ active, payload }: SandboxTooltipProps) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null

  return (
    <div className="min-w-64 rounded-lg border border-white/10 bg-bg-deep/95 p-3 shadow-[0_22px_70px_rgba(0,0,0,0.48)] backdrop-blur-xl">
      <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-2">
        <span className="font-mono text-xs text-font-secondary">{point.timeLabel}</span>
        <span className="rounded bg-accent-cyan/10 px-2 py-1 font-mono text-[0.6875rem] text-accent-cyan">
          Step {point.scenarioStep}
        </span>
      </div>
      <div className="mt-3 grid gap-2 font-mono text-xs">
        <div className="flex justify-between gap-4 text-accent-orange">
          <span>Voltage</span>
          <span>{point.inputVoltage.toFixed(2)} V</span>
        </div>
        <div className="flex justify-between gap-4 text-font-secondary">
          <span>Baseline</span>
          <span>{formatPower(point.baselinePrediction)}</span>
        </div>
        <div className="flex justify-between gap-4 text-accent-cyan">
          <span>LSTM</span>
          <span>{formatPower(point.lstmPrediction)}</span>
        </div>
      </div>
    </div>
  )
}

export function ZeroShotSandbox({
  className,
  initialSteps = DEFAULT_SANDBOX_STEPS,
  onSimulate,
}: ZeroShotSandboxProps) {
  const [steps, setSteps] = useState<SandboxStep[]>(initialSteps)
  const [output, setOutput] = useState<SandboxPredictionPoint[]>(() => buildSandboxPrediction(initialSteps))
  const [running, setRunning] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)

  const scenarioStats = useMemo(() => {
    const totalSeconds = steps.reduce((sum, step) => sum + Math.max(step.seconds, 0), 0)
    const weightedVoltage =
      totalSeconds === 0
        ? 0
        : steps.reduce((sum, step) => sum + step.voltage * Math.max(step.seconds, 0), 0) / totalSeconds
    const peakPower = output.length === 0 ? 0 : Math.max(...output.map((point) => point.lstmPrediction))

    return { totalSeconds, weightedVoltage, peakPower }
  }, [output, steps])

  const updateStep = (id: string, field: 'voltage' | 'seconds', value: number) => {
    setSteps((current) =>
      current.map((step) =>
        step.id === id
          ? {
              ...step,
              [field]: field === 'voltage' ? Math.min(Math.max(value, 0), 10) : Math.max(value, 1),
            }
          : step,
      ),
    )
  }

  const addStep = () => {
    setSteps((current) => [
      ...current,
      {
        id: `step-${Date.now()}`,
        voltage: current.at(-1)?.voltage ?? 5,
        seconds: 5,
      },
    ])
  }

  const removeStep = (id: string) => {
    setSteps((current) => (current.length === 1 ? current : current.filter((step) => step.id !== id)))
  }

  const resetSteps = () => {
    setSteps(DEFAULT_SANDBOX_STEPS)
    setOutput(buildSandboxPrediction(DEFAULT_SANDBOX_STEPS))
    setLastError(null)
  }

  const simulate = async () => {
    setRunning(true)
    setLastError(null)

    try {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 350)
      })
      const nextOutput = onSimulate ? await onSimulate(steps) : buildSandboxPrediction(steps)
      setOutput(nextOutput)
    } catch (error) {
      setLastError(error instanceof Error ? error.message : 'Unable to simulate scenario')
    } finally {
      setRunning(false)
    }
  }

  return (
    <section
      className={cn(
        'flex min-h-[640px] min-w-0 flex-col rounded-lg border border-white/10 bg-white/[0.035] p-5 shadow-[0_26px_90px_rgba(0,0,0,0.34)] backdrop-blur-xl',
        className,
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-font-tertiary">
            <Zap className="h-4 w-4 text-accent-green" />
            Zero-Shot Sandbox
          </div>
          <h2 className="mt-2 text-2xl font-semibold leading-tight text-font-primary">Custom Voltage Scenario</h2>
        </div>
        <div className="grid grid-cols-3 gap-2 font-mono text-xs">
          <div className="min-w-20 rounded-md border border-white/10 bg-black/20 px-3 py-2">
            <p className="text-font-tertiary">Duration</p>
            <p className="mt-1 text-font-primary">{scenarioStats.totalSeconds}s</p>
          </div>
          <div className="min-w-20 rounded-md border border-white/10 bg-black/20 px-3 py-2">
            <p className="text-font-tertiary">Mean V</p>
            <p className="mt-1 text-accent-orange">{scenarioStats.weightedVoltage.toFixed(2)}</p>
          </div>
          <div className="min-w-20 rounded-md border border-white/10 bg-black/20 px-3 py-2">
            <p className="text-font-tertiary">Peak</p>
            <p className="mt-1 text-accent-cyan">{formatPower(scenarioStats.peakPower)}</p>
          </div>
        </div>
      </header>

      <div className="mt-5 grid min-h-0 flex-1 grid-cols-1 gap-5 min-[1180px]:grid-cols-[360px_minmax(0,1fr)]">
        <article className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-white/10 bg-black/20 p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-font-primary">Input Array</h3>
            <button
              type="button"
              onClick={addStep}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-accent-cyan/25 bg-accent-cyan/10 px-3 text-xs font-semibold text-accent-cyan transition hover:border-accent-cyan/60"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Step
            </button>
          </div>

          <div className="mt-4 flex flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden pr-1">
            {steps.map((step, index) => (
              <div key={step.id} className="min-w-0 rounded-lg border border-white/10 bg-bg-deep/60 p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className="font-mono text-xs text-font-tertiary">#{index + 1}</span>
                  <button
                    type="button"
                    aria-label={`Remove step ${index + 1}`}
                    onClick={() => removeStep(step.id)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-font-tertiary transition hover:bg-accent-orange/10 hover:text-accent-orange disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={steps.length === 1}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-3 min-[440px]:grid-cols-2">
                  <label className="grid min-w-0 gap-2">
                    <span className="flex items-center gap-1.5 text-xs text-font-secondary">
                      <Gauge className="h-3.5 w-3.5 text-accent-orange" />
                      Voltage
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={10}
                      step={0.1}
                      value={step.voltage}
                      onChange={(event) => updateStep(step.id, 'voltage', Number(event.target.value))}
                      className="h-10 min-w-0 rounded-md border border-white/10 bg-surface-solid px-3 font-mono text-sm text-font-primary outline-none transition focus:border-accent-cyan/50"
                    />
                  </label>
                  <label className="grid min-w-0 gap-2">
                    <span className="flex items-center gap-1.5 text-xs text-font-secondary">
                      <Clock3 className="h-3.5 w-3.5 text-accent-green" />
                      Seconds
                    </span>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={step.seconds}
                      onChange={(event) => updateStep(step.id, 'seconds', Number(event.target.value))}
                      className="h-10 min-w-0 rounded-md border border-white/10 bg-surface-solid px-3 font-mono text-sm text-font-primary outline-none transition focus:border-accent-cyan/50"
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-[1fr_auto] gap-2 border-t border-white/10 pt-4">
            <button
              type="button"
              onClick={simulate}
              disabled={running}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-accent-cyan px-4 text-sm font-semibold text-bg-deep transition hover:bg-white disabled:cursor-wait disabled:opacity-70"
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Simulate Custom Scenario
            </button>
            <button
              type="button"
              aria-label="Reset scenario"
              onClick={resetSteps}
              className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-font-secondary transition hover:border-accent-orange/40 hover:text-accent-orange"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          </div>

          {lastError && (
            <p className="mt-3 rounded-md border border-accent-orange/20 bg-accent-orange/10 px-3 py-2 text-xs text-accent-orange">
              {lastError}
            </p>
          )}
        </article>

        <article className="flex min-h-[420px] min-w-0 flex-col rounded-lg border border-white/10 bg-[#0D1117] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-font-primary">Predicted Response</h3>
            <div className="flex gap-3 text-xs text-font-secondary">
              <span className="inline-flex items-center gap-2">
                <span className="h-0.5 w-5 rounded-full bg-accent-orange" />
                Voltage
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="h-0.5 w-5 rounded-full bg-font-tertiary" />
                Baseline
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="h-0.5 w-5 rounded-full bg-accent-cyan shadow-[0_0_12px_rgba(0,245,255,0.8)]" />
                LSTM
              </span>
            </div>
          </div>

          <div className="mt-4 min-h-0 flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={output} margin={{ top: 16, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.07)" strokeDasharray="3 8" vertical={false} />
                <XAxis
                  dataKey="timestamp"
                  minTickGap={28}
                  tick={{ fill: '#8B95A5', fontSize: 11 }}
                  tickFormatter={(value) => `${value}s`}
                  tickLine={false}
                  axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                  type="number"
                />
                <YAxis
                  yAxisId="voltage"
                  domain={[0, 10]}
                  tick={{ fill: '#FF5C00', fontSize: 11 }}
                  tickFormatter={(value) => `${value}V`}
                  tickLine={false}
                  axisLine={false}
                  width={42}
                />
                <YAxis
                  yAxisId="power"
                  orientation="right"
                  tick={{ fill: '#8B95A5', fontSize: 11 }}
                  tickFormatter={(value) => `${Number(value).toFixed(1)}`}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                />
                <Tooltip content={<SandboxTooltip />} cursor={{ stroke: '#00F5FF', strokeOpacity: 0.32 }} />
                <Line
                  dataKey="inputVoltage"
                  dot={false}
                  isAnimationActive={false}
                  stroke="#FF5C00"
                  strokeWidth={2.2}
                  type="stepAfter"
                  yAxisId="voltage"
                />
                <Line
                  dataKey="baselinePrediction"
                  dot={false}
                  isAnimationActive={false}
                  stroke="#8B95A5"
                  strokeDasharray="7 7"
                  strokeOpacity={0.8}
                  strokeWidth={2}
                  type="monotone"
                  yAxisId="power"
                />
                <Line
                  dataKey="lstmPrediction"
                  dot={false}
                  isAnimationActive={false}
                  stroke="#00F5FF"
                  strokeWidth={3}
                  style={{ filter: 'drop-shadow(0 0 10px rgba(0,245,255,0.7))' }}
                  type="monotone"
                  yAxisId="power"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </article>
      </div>
    </section>
  )
}
