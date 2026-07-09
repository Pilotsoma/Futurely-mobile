import { useCallback, useState } from 'react'
import { useFocusEffect } from '@react-navigation/native'
import { ApiRequestError } from '../api/client'

interface PortalFetchState<T> {
  data: T | null
  loading: boolean
  /** True when the backend returned error.code === 'UNSUPPORTED' (HAC-only endpoint, PowerSchool-connected user). */
  unsupported: boolean
  error: string | null
  reload: () => void
}

// Shared loading/error/unsupported state machine for the 6 HAC-only grades
// endpoints (and reused as-is by the 2 that support both systems) — replaces
// the near-identical copy-pasted state machine each of the 8 sub-screens had
// in the deleted version.
export function usePortalFetch<T>(fetcher: () => Promise<T>, deps: unknown[] = []): PortalFetchState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [unsupported, setUnsupported] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useFocusEffect(
    useCallback(() => {
      let cancelled = false
      setLoading(true)
      setError(null)
      setUnsupported(false)

      fetcher()
        .then((result) => {
          if (!cancelled) setData(result)
        })
        .catch((err: unknown) => {
          if (cancelled) return
          if (err instanceof ApiRequestError && err.code === 'UNSUPPORTED') {
            setUnsupported(true)
          } else {
            setError(err instanceof ApiRequestError ? err.message : 'Something went wrong.')
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })

      return () => {
        cancelled = true
      }
      // fetcher is intentionally excluded — callers pass a new closure each render,
      // only reloadKey and their own explicit deps (e.g. period/date) should refetch.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reloadKey, ...deps]),
  )

  return { data, loading, unsupported, error, reload: () => setReloadKey((k) => k + 1) }
}
