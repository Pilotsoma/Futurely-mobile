import { formatDuration } from '../formatDuration'

describe('formatDuration', () => {
  it('returns minutes only when under an hour', () => {
    expect(formatDuration(30)).toBe('30 min')
    expect(formatDuration(45)).toBe('45 min')
    expect(formatDuration(1)).toBe('1 min')
    expect(formatDuration(59)).toBe('59 min')
  })

  it('returns whole hours with no remainder', () => {
    expect(formatDuration(60)).toBe('1h')
    expect(formatDuration(120)).toBe('2h')
    expect(formatDuration(180)).toBe('3h')
  })

  it('returns hours and minutes when not a whole hour', () => {
    expect(formatDuration(90)).toBe('1h 30m')
    expect(formatDuration(75)).toBe('1h 15m')
    expect(formatDuration(125)).toBe('2h 5m')
    expect(formatDuration(150)).toBe('2h 30m')
  })

  it('handles zero minutes', () => {
    expect(formatDuration(0)).toBe('0 min')
  })
})
