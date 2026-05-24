import { Download } from 'lucide-react'
import { useEffect } from 'react'
import { useTopbar } from '@/components/layout/TopbarContext'
import { Breadcrumbs } from '@/components/ui'

export default function Results() {
  const setTopbar = useTopbar()

  useEffect(() => {
    setTopbar({
      left: (
        <Breadcrumbs
          items={[{ label: 'Results & ML Showcase' }, { label: 'Experiment 22' }]}
        />
      ),
      right: (
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent-cyan px-3.5 text-xs font-semibold text-bg-deep"
        >
          <Download className="h-3.5 w-3.5" />
          Export PDF
        </button>
      ),
    })
  }, [setTopbar])

  return (
    <div className="flex flex-1 items-center justify-center p-6 text-font-secondary">
      <p className="font-mono text-sm">Results & ML Showcase (TODO)</p>
    </div>
  )
}
