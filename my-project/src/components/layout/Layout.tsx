import {
  useCallback,
  useMemo,
  useState,
} from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { TopbarContext, type TopbarContextValue, type TopbarSlots } from './TopbarContext'
import { LiveIndicator } from '@/components/ui/LiveIndicator'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { usePersistentState } from '@/hooks/usePersistentState'
import { cn } from '@/lib/cn'

const SIDEBAR_KEY = 'aethel-sidebar-collapsed'

type LayoutProps = {
  /** Default `collapsed` state when no localStorage value is present. */
  defaultCollapsed?: boolean
}

export function Layout({ defaultCollapsed = false }: LayoutProps) {
  const isMobile = useMediaQuery('(max-width: 1023px)')
  const [isCollapsed, setIsCollapsed] = usePersistentState<boolean>(
    SIDEBAR_KEY,
    defaultCollapsed,
  )
  const [mobileOpen, setMobileOpen] = useState(false)
  const [slots, setSlots] = useState<TopbarSlots>({
    left: null,
    right: <LiveIndicator />,
  })
  const effectiveMobileOpen = isMobile && mobileOpen

  const setTopbar = useCallback((next: Partial<TopbarSlots>) => {
    setSlots((prev) => ({ ...prev, ...next }))
  }, [])

  const handleToggleSidebar = useCallback(() => {
    if (isMobile) {
      setMobileOpen((open) => !open)
    } else {
      setIsCollapsed((c) => !c)
    }
  }, [isMobile, setIsCollapsed])

  const contextValue = useMemo<TopbarContextValue>(() => ({ setTopbar }), [setTopbar])

  return (
    <TopbarContext.Provider value={contextValue}>
      <div className="relative flex min-h-screen">
        <Sidebar
          isCollapsed={isCollapsed}
          setIsCollapsed={setIsCollapsed}
          mobileOpen={effectiveMobileOpen}
          onMobileClose={() => setMobileOpen(false)}
        />

        <div
          aria-hidden="true"
          onClick={() => setMobileOpen(false)}
          className={cn(
            'fixed inset-0 z-[55] bg-black/50 transition-opacity duration-200 lg:hidden',
            effectiveMobileOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
          )}
        />

        <main className="flex min-w-0 flex-1 flex-col">
          <Topbar
            onToggleSidebar={handleToggleSidebar}
            left={slots.left}
            right={slots.right}
          />
          <Outlet />
        </main>
      </div>
    </TopbarContext.Provider>
  )
}
