import { createContext, useContext, type ReactNode } from 'react'

export type TopbarSlots = {
  left: ReactNode
  right: ReactNode
}

export type TopbarContextValue = {
  setTopbar: (slots: Partial<TopbarSlots>) => void
}

export const TopbarContext = createContext<TopbarContextValue | null>(null)

export function useTopbar(): TopbarContextValue['setTopbar'] {
  const ctx = useContext(TopbarContext)
  if (!ctx) {
    throw new Error('useTopbar must be used inside <Layout>')
  }
  return ctx.setTopbar
}
