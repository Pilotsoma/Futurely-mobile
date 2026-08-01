import { getPathFromState, getStateFromPath } from '@react-navigation/native'

import { linking } from '../linking'

describe('application linking', () => {
  it('maps every top-level destination to a stable web path', () => {
    const config = linking.config
    expect(getStateFromPath('/dashboard', config)?.routes[0]?.name).toBe('Dashboard')
    expect(getStateFromPath('/ai', config)?.routes[0]?.name).toBe('AIChat')
    expect(getStateFromPath('/settings', config)?.routes[0]?.name).toBe('Settings')
  })

  it('maps nested grade routes and can serialize them again', () => {
    const config = linking.config
    const state = getStateFromPath('/grades/classwork', config)
    expect(state?.routes[0]?.name).toBe('Grades')
    expect(state?.routes[0]?.state?.routes[0]?.name).toBe('Classwork')
    expect(state ? getPathFromState(state, config) : null).toBe('/grades/classwork')
  })

  it('parses and serializes an assignment destination', () => {
    const config = linking.config
    const state = getStateFromPath('/planner/42', config)
    expect(state?.routes[0]?.name).toBe('Planner')
    expect(state?.routes[0]?.params).toEqual({ assignmentId: 42 })
    expect(state ? getPathFromState(state, config) : null).toBe('/planner/42')
  })
})
