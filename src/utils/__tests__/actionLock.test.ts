import { createActionLock } from '../actionLock'

describe('action lock', () => {
  it('prevents duplicate acquisition until the active action releases', () => {
    const lock = createActionLock()
    const release = lock.tryAcquire()

    expect(release).not.toBeNull()
    expect(lock.isLocked()).toBe(true)
    expect(lock.tryAcquire()).toBeNull()

    release?.()
    expect(lock.isLocked()).toBe(false)
    expect(lock.tryAcquire()).not.toBeNull()
  })

  it('allows release to be called repeatedly without corrupting the lock', () => {
    const lock = createActionLock()
    const release = lock.tryAcquire()
    release?.()
    release?.()
    expect(lock.tryAcquire()).not.toBeNull()
  })
})
