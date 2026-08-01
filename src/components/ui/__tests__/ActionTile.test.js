import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { describe, expect, it, jest } from '@jest/globals'

import { ActionTile } from '../ActionTile'

jest.mock('@expo/vector-icons', () => ({
  Feather: () => null,
}))

describe('ActionTile', () => {
  function findAction(renderer) {
    return renderer.root
      .findAllByProps({ testID: 'tile' })
      .find((node) => node.props.accessibilityRole === 'button')
  }

  it('renders one accessible full-tile action and forwards one press', () => {
    const onPress = jest.fn()
    let renderer
    act(() => {
      renderer = TestRenderer.create(
        <ActionTile
          title="Classwork"
          subtitle="Assignments and averages"
          icon="book-open"
          color="#22C55E"
          iconBackground="rgba(34,197,94,0.1)"
          onPress={onPress}
          testID="tile"
        />,
      )
    })

    const action = findAction(renderer)
    expect(action).toBeDefined()
    expect(action.props.accessibilityRole).toBe('button')
    expect(action.props.accessibilityLabel).toBe('Classwork')
    act(() => action.props.onPress())
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('communicates and enforces its disabled state', () => {
    const onPress = jest.fn()
    let renderer
    act(() => {
      renderer = TestRenderer.create(
        <ActionTile
          title="Unavailable"
          icon="alert-circle"
          color="#EF4444"
          iconBackground="rgba(239,68,68,0.1)"
          onPress={onPress}
          disabled
          testID="tile"
        />,
      )
    })

    const action = findAction(renderer)
    expect(action).toBeDefined()
    expect(action.props.disabled).toBe(true)
    expect(action.props.accessibilityState).toEqual({ disabled: true })
  })

  it('accepts focus and hover events for visible interaction styling', () => {
    let renderer
    act(() => {
      renderer = TestRenderer.create(
        <ActionTile
          title="Focus target"
          icon="star"
          color="#A78BFA"
          iconBackground="rgba(167,139,250,0.1)"
          onPress={() => undefined}
          testID="tile"
        />,
      )
    })

    const action = findAction(renderer)
    expect(action).toBeDefined()
    act(() => {
      action.props.onFocus()
      action.props.onHoverIn()
    })
    expect(renderer.toJSON()).not.toBeNull()
  })
})
