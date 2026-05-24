import { BarChart3, Database, FlaskConical } from 'lucide-react'
import type { ComponentType } from 'react'
import { useMemo, useState } from 'react'
import { cn } from '@/lib/cn'
import { PerformanceMetrics } from './PerformanceMetrics'
import { ShadowPredictionPlot } from './ShadowPredictionPlot'
import { XAIPanel } from './XAIPanel'
import { ZeroShotSandbox } from './ZeroShotSandbox'
import { HISTORICAL_SHOWCASES, type HistoricalDatasetId } from './mockData'

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

export function ShowcaseDashboard() {
  const [view, setView] = useState<ShowcaseView>('historical')
  const [datasetId, setDatasetId] = useState<HistoricalDatasetId>('ex_22')
  const showcase = HISTORICAL_SHOWCASES[datasetId]

  const contextLabel = useMemo(
    () => (view === 'historical' ? showcase.label : 'Zero-Shot Sandbox'),
    [showcase.label, view],
  )

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
            Micro gas turbine voltage-to-power model validation.
          </p>
        </div>

        <div className="flex flex-wrap justify-end gap-3">
          {view === 'historical' && (
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-white/10 bg-black/20 p-1">
              <SegmentButton
                active={datasetId === 'ex_4'}
                label="Ex_4"
                value="ex_4"
                onSelect={setDatasetId}
              />
              <SegmentButton
                active={datasetId === 'ex_22'}
                label="Ex_22"
                value="ex_22"
                onSelect={setDatasetId}
              />
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
              label="Zero-Shot"
              value="sandbox"
              onSelect={setView}
            />
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        {view === 'historical' ? (
          <>
            <ShadowPredictionPlot
              data={showcase.data}
              datasetLabel={showcase.label}
              subtitle={showcase.subtitle}
              className="xl:min-h-[calc(100vh-210px)]"
            />
            <PerformanceMetrics metrics={showcase.metrics} />
          </>
        ) : (
          <>
            <ZeroShotSandbox className="xl:min-h-[calc(100vh-210px)]" />
            <PerformanceMetrics metrics={showcase.metrics} />
          </>
        )}

        <div className="xl:col-span-2">
          <XAIPanel
            featureImportance={showcase.featureImportance}
            residuals={showcase.residuals}
          />
        </div>
      </div>

    </div>
  )
}
