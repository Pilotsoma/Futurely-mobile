const mockInfo = jest.fn()
const mockWarn = jest.fn()
const mockError = jest.fn()

jest.mock('../logger', () => ({
  logger: {
    info: (...args: unknown[]) => mockInfo(...args),
    warn: (...args: unknown[]) => mockWarn(...args),
    error: (...args: unknown[]) => mockError(...args),
  },
}))

import { safeConsole } from '../safeConsole'

describe('safeConsole', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('retains only a static category and discards sensitive arguments', () => {
    safeConsole.log(
      '[HAC CLIENT] Final student info',
      { name: 'Sensitive Student', grades: ['A'], password: 'secret' },
      '<html>private portal content</html>',
    )

    expect(mockInfo).toHaveBeenCalledWith(
      'legacy_integration_log',
      { category: 'hac_client' },
    )
    expect(JSON.stringify(mockInfo.mock.calls)).not.toContain('Sensitive Student')
    expect(JSON.stringify(mockInfo.mock.calls)).not.toContain('private portal content')
    expect(JSON.stringify(mockInfo.mock.calls)).not.toContain('secret')
  })

  it('uses a generic category when a message could contain dynamic data', () => {
    safeConsole.error('Student email user@example.com failed')

    expect(mockError).toHaveBeenCalledWith(
      'legacy_integration_log',
      { category: 'legacy' },
    )
  })
})
