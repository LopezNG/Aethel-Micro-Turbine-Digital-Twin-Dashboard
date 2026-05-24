import { useEffect } from 'react'
import { useTopbar } from '@/components/layout/TopbarContext'
import {
  ExperimentCard,
  KPITile,
  LiveIndicator,
  type Experiment,
} from '@/components/ui'

const EXPERIMENTS: Experiment[] = [
  {
    id: 'exp-9',
    name: 'Experiment 9 — Baseline LSTMs',
    meta: 'Mar 12, 2026  ·  Synthetic Dataset  ·  RMSE 0.091',
    status: 'complete',
    trend: [10, 16, 12, 20, 14],
    trendColor: 'cyan',
  },
  {
    id: 'exp-15',
    name: 'Experiment 15 — Transformer Encoder',
    meta: 'Apr 03, 2026  ·  Real Telemetry  ·  RMSE 0.072',
    status: 'complete',
    trend: [8, 14, 22, 18, 24],
    trendColor: 'green',
  },
  {
    id: 'exp-22',
    name: 'Experiment 22 — Hybrid CNN-LSTM',
    meta: 'Apr 18, 2026  ·  Mixed Dataset  ·  RMSE 0.065',
    status: 'running',
    trend: [12, 18, 10, 22, 16],
    trendColor: 'orange',
  },
]

export default function Dashboard() {
  const setTopbar = useTopbar()

  useEffect(() => {
    setTopbar({
      left: <h1 className="text-lg font-semibold">Overview</h1>,
      right: <LiveIndicator />,
    })
  }, [setTopbar])

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <section className="grid grid-cols-1 gap-4 min-[901px]:grid-cols-2 min-[1101px]:grid-cols-3">
        <KPITile label="Mean Power Output" value="4.23 kW" accent="cyan" />
        <KPITile label="Model Latency" value="12ms" accent="green" />
        <KPITile label="Current RMSE" value="0.087" accent="orange" />
      </section>

      <section className="flex flex-1 flex-col gap-3">
        <h2 className="text-[0.9375rem] font-semibold">Recent Experiments</h2>
        {EXPERIMENTS.map((exp) => (
          <ExperimentCard key={exp.id} experiment={exp} />
        ))}
      </section>
    </div>
  )
}
