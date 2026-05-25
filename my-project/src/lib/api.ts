export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

export type ExperimentMode = 'rectangular' | 'continuous' | 'unknown'
export type ExperimentSplit = 'train' | 'test'
export type ModelVersion = 'baseline' | 'lstm'
export type FilterMode = 'none' | 'voltage' | 'power' | 'both'

export type ExperimentMetadata = {
  experiment_id: string
  path: string
  split: ExperimentSplit
  mode: ExperimentMode
  mode_source: string
  description: string
  notes: string | null
  sample_count: number
  available_columns: string[]
  voltage_column: string
  power_column: string | null
  time_column: string | null
  duration_seconds: number | null
  median_dt_seconds: number | null
}

export type ModelInfo = {
  id: ModelVersion
  label: string
  family: string
  source: string
  available: boolean
  reason?: string | null
  lookback_steps?: number | null
}

export async function apiGet<T>(path: string, params?: Record<string, string | number | boolean | undefined | null>) {
  const url = new URL(`${API_BASE_URL}${path}`)
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  })
  const response = await fetch(url)
  if (!response.ok) throw new Error(await errorMessage(response))
  return (await response.json()) as T
}

export async function apiPost<T>(path: string, body: unknown) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(await errorMessage(response))
  return (await response.json()) as T
}

export async function uploadCsv<T>(path: string, file: File) {
  const formData = new FormData()
  formData.append('file', file)
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    body: formData,
  })
  if (!response.ok) throw new Error(await errorMessage(response))
  return (await response.json()) as T
}

export function toWebSocketUrl(baseUrl: string) {
  const url = new URL(baseUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString().replace(/\/$/, '')
}

async function errorMessage(response: Response) {
  try {
    const payload = (await response.json()) as { detail?: unknown }
    if (typeof payload.detail === 'string') return payload.detail
    return JSON.stringify(payload.detail ?? payload)
  } catch {
    return `${response.status} ${response.statusText}`
  }
}
