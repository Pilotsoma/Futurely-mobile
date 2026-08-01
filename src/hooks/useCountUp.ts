import { useEffect, useState } from 'react'
import { useDisplayPreferences } from '../preferences/displayPreferences'

// Mirrors web's useCountUp/useCountUpFloat (app/(app)/dashboard/page.tsx) —
// an eased count-up so numbers "land" with a bit of life instead of just
// appearing. Re-runs whenever `target` changes (e.g. on every focus refetch).

export function useCountUp(target: number | null, duration = 700): number {
  const [val, setVal] = useState(0)
  const { reduceMotion } = useDisplayPreferences()

  useEffect(() => {
    if (reduceMotion) {
      setVal(target ?? 0)
      return
    }
    if (target === null || target === 0) {
      setVal(target ?? 0)
      return
    }
    const goal = target
    const start = Date.now()
    let raf: ReturnType<typeof requestAnimationFrame>
    function tick(): void {
      const p = Math.min((Date.now() - start) / duration, 1)
      const eased = 1 - Math.pow(1 - p, 3)
      setVal(Math.round(goal * eased))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration, reduceMotion])

  return val
}

export function useCountUpFloat(target: number | null, duration = 900): number {
  const [val, setVal] = useState(0)
  const { reduceMotion } = useDisplayPreferences()

  useEffect(() => {
    if (reduceMotion) {
      setVal(target ?? 0)
      return
    }
    if (target === null) {
      setVal(0)
      return
    }
    const goal = target
    const start = Date.now()
    let raf: ReturnType<typeof requestAnimationFrame>
    function tick(): void {
      const p = Math.min((Date.now() - start) / duration, 1)
      const eased = 1 - Math.pow(1 - p, 3)
      setVal(goal * eased)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration, reduceMotion])

  return val
}
