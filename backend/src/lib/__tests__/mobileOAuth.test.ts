import {
  buildMobileOAuthRedirect,
  validateMobileOAuthRedirectUri,
} from '../mobileOAuth'

describe('validateMobileOAuthRedirectUri', () => {
  it.each([
    'futurely://oauth',
    'exp://localhost:8081/--/oauth',
    'exp://127.0.0.1:8081/--/oauth',
    'exp://10.0.0.5:8081/--/oauth',
    'exp://172.20.10.4:8081/--/oauth',
    'exp://192.168.1.20:8081/--/oauth',
  ])('accepts an app-owned redirect: %s', redirectUri => {
    expect(validateMobileOAuthRedirectUri(redirectUri)).toBeTruthy()
  })

  it.each([
    'https://attacker.example/oauth',
    'exp://8.8.8.8:8081/--/oauth',
    'javascript:alert(1)',
    '',
    undefined,
  ])('rejects an external or malformed redirect: %s', redirectUri => {
    expect(validateMobileOAuthRedirectUri(redirectUri)).toBeNull()
  })
})

describe('buildMobileOAuthRedirect', () => {
  it('puts credentials in the fragment and preserves the Expo path', () => {
    const redirect = buildMobileOAuthRedirect(
      'exp://192.168.1.20:8081/--/oauth',
      { accessToken: 'access', refreshToken: 'refresh' },
    )

    expect(redirect).toBe(
      'exp://192.168.1.20:8081/--/oauth#accessToken=access&refreshToken=refresh',
    )
  })
})
