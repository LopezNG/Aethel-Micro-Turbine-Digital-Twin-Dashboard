import { useEffect } from 'react'
import { useTopbar } from '@/components/layout/TopbarContext'
import { Breadcrumbs, LiveIndicator } from '@/components/ui'
import { ControlPanel } from '@/features/turbine/ControlPanel'
import { MetricsPanel } from '@/features/turbine/MetricsPanel'
import { TelemetryChart } from '@/features/turbine/TelemetryChart'
import { useTurbineSimulation } from '@/features/turbine/useTurbineSimulation'

export default function VirtualLab() {
  const setTopbar = useTopbar()
  const simulation = useTurbineSimulation()
  const streamLabel =
    simulation.status === 'open'
      ? simulation.paused
        ? 'Live Stream: Paused'
        : 'Live Stream: Active'
      : `Live Stream: ${simulation.status}`

  useEffect(() => {
    setTopbar({
      left: (
        <Breadcrumbs
          items={[
            { label: 'Virtual Lab' },
            { label: `${simulation.dataset} Test Set` },
          ]}
        />
      ),
      right: <LiveIndicator label={streamLabel} />,
    })
  }, [setTopbar, simulation.dataset, streamLabel])

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[radial-gradient(circle_at_18%_12%,rgba(0,245,255,0.08),transparent_28%),radial-gradient(circle_at_82%_0%,rgba(255,92,0,0.08),transparent_24%)] p-4 sm:p-6">
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 xl:grid-cols-[320px_minmax(0,1fr)_320px]">
        <ControlPanel
          mode={simulation.mode}
          modelVersion={simulation.modelVersion}
          manualVoltage={simulation.manualVoltage}
          dataset={simulation.dataset}
          experiments={simulation.experiments}
          models={simulation.models}
          experimentMode={simulation.experimentMode}
          includeUnknown={simulation.includeUnknown}
          filterMode={simulation.filterMode}
          tickMs={simulation.tickMs}
          paused={simulation.paused}
          status={simulation.status}
          currentPoint={simulation.currentPoint}
          onModeChange={simulation.setMode}
          onModelChange={simulation.setModelVersion}
          onVoltageChange={simulation.setManualVoltage}
          onDatasetChange={simulation.setDataset}
          onExperimentModeChange={simulation.setExperimentMode}
          onIncludeUnknownChange={simulation.setIncludeUnknown}
          onFilterModeChange={simulation.setFilterMode}
          onTickMsChange={simulation.setTickMs}
          onPausedChange={simulation.setPaused}
        />
        <TelemetryChart
          points={simulation.points}
          status={simulation.status}
          lastError={simulation.lastError}
        />
        <MetricsPanel metrics={simulation.metrics} currentPoint={simulation.currentPoint} />
      </div>
    </div>
  )
}
