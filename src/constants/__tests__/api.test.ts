import { isLongRunningEndpoint, resolveApiBaseUrl } from '../api'

describe('resolveApiBaseUrl', () => {
  it('uses an explicit public URL and removes trailing slashes', () => {
    expect(resolveApiBaseUrl({
      explicitUrl: 'https://api.example.com/v1///',
      platform: 'ios',
      expoHostUri: '192.168.1.4:8081',
    })).toBe('https://api.example.com/v1')
  })

  it('uses localhost for web', () => {
    expect(resolveApiBaseUrl({ platform: 'web' })).toBe('http://localhost:3001')
  })

  it('uses the Metro LAN host for a physical Expo Go device', () => {
    expect(resolveApiBaseUrl({
      platform: 'android',
      expoHostUri: '192.168.50.24:8081',
    })).toBe('http://192.168.50.24:3001')
  })

  it('rejects non-http explicit URLs', () => {
    expect(() => resolveApiBaseUrl({
      explicitUrl: 'file:///tmp/backend',
      platform: 'ios',
    })).toThrow('EXPO_PUBLIC_API_URL must use http:// or https://')
  })
})

describe('isLongRunningEndpoint', () => {
  it.each([
    '/integrations/grades/sync-profile',
    '/ai/chat',
    '/colleges/42/insights',
  ])('recognizes %s', path => {
    expect(isLongRunningEndpoint(path)).toBe(true)
  })

  it('keeps normal CRUD requests on the short timeout', () => {
    expect(isLongRunningEndpoint('/assignments')).toBe(false)
  })
})
