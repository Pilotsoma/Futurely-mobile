import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { describe, expect, it, jest } from '@jest/globals'

import { GpaOverviewCard } from '../GpaOverviewCard'

jest.mock('@expo/vector-icons', () => ({
  Feather: () => null,
}))
jest.mock('react-native-svg', () => {
  const React = require('react')
  const Stub = ({ children }) => React.createElement('svg-stub', null, children)
  return {
    __esModule: true,
    default: Stub,
    Defs: Stub,
    LinearGradient: Stub,
    Stop: Stub,
    Rect: Stub,
  }
})

const summary = {
  gpa: 3.4,
  unweightedGpa: 3.4567,
  weightedGpa: 4.1234,
  courseCount: 2,
  systemType: 'HAC',
}

describe('GpaOverviewCard', () => {
  it('renders the same normalized GPA precision for every consumer', () => {
    let renderer
    act(() => {
      renderer = TestRenderer.create(
        <GpaOverviewCard summary={summary} courses={[]} testID="gpa" />,
      )
    })
    expect(renderer.root.findByProps({ testID: 'gpa-unweighted' }).props.children).toBe('3.457')
    expect(renderer.root.findByProps({ testID: 'gpa-weighted' }).props.children).toBe('4.123')
  })

  it.each([
    ['loading', { loading: true }, 'gpa-loading'],
    ['error', { error: 'GPA unavailable' }, 'gpa-error'],
    ['empty', { summary: null }, 'gpa-empty'],
  ])('renders its %s state', (_name, props, stateTestId) => {
    let renderer
    act(() => {
      renderer = TestRenderer.create(
        <GpaOverviewCard summary={summary} courses={[]} testID="gpa" {...props} />,
      )
    })
    expect(renderer.root.findByProps({ testID: stateTestId })).toBeDefined()
  })

  it('keeps the sync action independent from the card action', () => {
    const onPress = jest.fn()
    const onSync = jest.fn()
    let renderer
    act(() => {
      renderer = TestRenderer.create(
        <GpaOverviewCard
          summary={summary}
          courses={[]}
          onPress={onPress}
          onSync={onSync}
          testID="gpa"
        />,
      )
    })

    act(() => {
      renderer.root.findByProps({ testID: 'gpa-sync' }).props.onPress()
    })
    expect(onSync).toHaveBeenCalledTimes(1)
    expect(onPress).not.toHaveBeenCalled()
  })
})
