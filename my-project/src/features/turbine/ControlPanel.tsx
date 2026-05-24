import {
  Activity,
  Cpu,
  Database,
  Gauge,
  Pause,
  Play,
  SlidersHorizontal,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import type {
  ConnectionStatus,
  DatasetId,
  ModelVersion,
  SimulationMode,
  TelemetryPoint,
} from './types'

type ControlPanelProps = {
  mode: SimulationMode
  modelVersion: ModelVersion
  manualVoltage: number
  dataset: DatasetId
  tickMs: number
  paused: boolean
  status: ConnectionStatus
  currentPoint: TelemetryPoint | null
  onModeChange: (mode: SimulationMode) => void
  onModelChange: (model: ModelVersion) => void
  onVoltageChange: (voltage: number) => void
  onDatasetChange: (dataset: DatasetId) => void
  onTickMsChange: (tickMs: number) => void
  onPausedChange: (paused: boolean) => void
}

const statusTone: Record<ConnectionStatus, string> = {
  connecting: 'text-accent-yellow',
  open: 'text-accent-green',
  closed: 'text-font-secondary',
  error: 'text-accent-orange',
}

function SegmentButton<T extends string>({
  active,
  value,
  label,
  onSelect,
}: {
  active: boolean
  value: T
  label: string
  onSelect: (value: T) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className={cn(
        'h-9 rounded-md px-3 text-xs font-semibold transition',
        active
          ? 'bg-white text-bg-deep shadow-[0_0_22px_rgba(255,255,255,0.16)]'
          : 'text-font-secondary hover:bg-white/5 hover:text-font-primary',
      )}
    >
      {label}
    </button>
  )
}

export function ControlPanel({
  mode,
  modelVersion,
  manualVoltage,
  dataset,
  tickMs,
  paused,
  status,
  currentPoint,
  onModeChange,
  onModelChange,
  onVoltageChange,
  onDatasetChange,
  onTickMsChange,
  onPausedChange,
}: ControlPanelProps) {
  const knobDegrees = (manualVoltage / 10) * 270 - 135
  const liveVoltage = currentPoint?.inputVoltage ?? manualVoltage
  const predictedPower = currentPoint?.predictedPower ?? 0

  return (
    <article className="flex min-w-0 flex-col gap-5 rounded-lg border border-white/10 bg-white/[0.045] p-5 shadow-[0_22px_80px_rgba(0,0,0,0.32)] backdrop-blur-xl">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-font-tertiary">
            <SlidersHorizontal className="h-4 w-4 text-accent-cyan" />
            Control
          </div>
          <h2 className="mt-2 text-xl font-semibold leading-tight">Digital Twin Input</h2>
        </div>
        <button
          type="button"
          aria-label={paused ? 'Resume stream' : 'Pause stream'}
          onClick={() => onPausedChange(!paused)}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-font-secondary transition hover:border-accent-cyan/40 hover:text-accent-cyan"
        >
          {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
        </button>
      </header>

      <section className="grid grid-cols-2 gap-2 rounded-lg border border-white/10 bg-black/20 p-1">
        <SegmentButton
          active={mode === 'historical'}
          value="historical"
          label="Playback"
          onSelect={onModeChange}
        />
        <SegmentButton active={mode === 'manual'} value="manual" label="Manual" onSelect={onModeChange} />
      </section>

      <section className="grid grid-cols-2 gap-2 rounded-lg border border-white/10 bg-black/20 p-1">
        <SegmentButton
          active={modelVersion === 'baseline'}
          value="baseline"
          label="Baseline"
          onSelect={onModelChange}
        />
        <SegmentButton active={modelVersion === 'lstm'} value="lstm" label="LSTM" onSelect={onModelChange} />
      </section>

      <section className="flex flex-col items-center gap-4 rounded-lg border border-white/10 bg-[radial-gradient(circle_at_50%_18%,rgba(0,245,255,0.12),transparent_42%),rgba(0,0,0,0.22)] p-5">
        <div
          className="relative grid h-40 w-40 place-items-center rounded-full border border-white/10 bg-[linear-gradient(145deg,rgba(255,255,255,0.1),rgba(255,255,255,0.025))] shadow-[inset_0_0_34px_rgba(0,0,0,0.55)]"
          style={{
            backgroundImage: `conic-gradient(from 225deg, rgba(255,92,0,0.95) 0deg, rgba(0,245,255,0.9) ${Math.max(
              manualVoltage * 27,
              4,
            )}deg, rgba(255,255,255,0.08) ${Math.max(manualVoltage * 27, 4)}deg 270deg, transparent 270deg)`,
          }}
        >
          <div className="grid h-[7.5rem] w-[7.5rem] place-items-center rounded-full bg-bg-deep shadow-[0_12px_34px_rgba(0,0,0,0.45)]">
            <Gauge className="h-6 w-6 text-accent-cyan" />
            <div className="text-center">
              <p className="font-mono text-3xl font-bold leading-none text-font-primary">
                {manualVoltage.toFixed(2)}
              </p>
              <p className="mt-1 font-mono text-xs text-font-tertiary">VOLTS</p>
            </div>
          </div>
          <span
            className="absolute left-1/2 top-1/2 h-[4.55rem] w-1 origin-bottom rounded-full bg-white shadow-[0_0_18px_rgba(0,245,255,0.7)]"
            style={{ transform: `translate(-50%, -100%) rotate(${knobDegrees}deg)` }}
          />
        </div>

        <input
          aria-label="Manual input voltage"
          type="range"
          min={0}
          max={10}
          step={0.01}
          value={manualVoltage}
          onChange={(event) => onVoltageChange(Number(event.target.value))}
          className="aethel-knob-range w-full"
        />
      </section>

      <section className="grid grid-cols-2 gap-3">
        <label className="flex min-w-0 flex-col gap-2 rounded-lg border border-white/10 bg-black/20 p-3">
          <span className="flex items-center gap-2 text-xs font-medium text-font-secondary">
            <Database className="h-3.5 w-3.5 text-accent-orange" />
            Dataset
          </span>
          <select
            value={dataset}
            onChange={(event) => onDatasetChange(event.target.value as DatasetId)}
            className="h-9 rounded-md border border-white/10 bg-surface-solid px-2 text-sm text-font-primary outline-none transition focus:border-accent-cyan/50"
          >
            <option value="ex_22">ex_22</option>
            <option value="ex_9">ex_9</option>
          </select>
        </label>

        <label className="flex min-w-0 flex-col gap-2 rounded-lg border border-white/10 bg-black/20 p-3">
          <span className="flex items-center gap-2 text-xs font-medium text-font-secondary">
            <Activity className="h-3.5 w-3.5 text-accent-green" />
            Tick
          </span>
          <select
            value={tickMs}
            onChange={(event) => onTickMsChange(Number(event.target.value))}
            className="h-9 rounded-md border border-white/10 bg-surface-solid px-2 text-sm text-font-primary outline-none transition focus:border-accent-cyan/50"
          >
            <option value={100}>100 ms</option>
            <option value={250}>250 ms</option>
            <option value={500}>500 ms</option>
            <option value={1000}>1 sec</option>
          </select>
        </label>
      </section>

      <footer className="grid grid-cols-3 gap-2 border-t border-white/10 pt-4 font-mono text-xs">
        <div>
          <p className="text-font-tertiary">Socket</p>
          <p className={cn('mt-1 uppercase', statusTone[status])}>{status}</p>
        </div>
        <div>
          <p className="text-font-tertiary">Input</p>
          <p className="mt-1 text-accent-orange">{liveVoltage.toFixed(2)} V</p>
        </div>
        <div>
          <p className="flex items-center gap-1 text-font-tertiary">
            <Cpu className="h-3 w-3" />
            Power
          </p>
          <p className="mt-1 text-accent-cyan">{Math.round(predictedPower)} W</p>
        </div>
      </footer>
    </article>
  )
}
