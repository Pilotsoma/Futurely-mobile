export interface ActionLock {
  isLocked: () => boolean
  tryAcquire: () => (() => void) | null
}

export function createActionLock(): ActionLock {
  let locked = false

  return {
    isLocked: () => locked,
    tryAcquire: () => {
      if (locked) return null
      locked = true

      let released = false
      return () => {
        if (released) return
        released = true
        locked = false
      }
    },
  }
}
