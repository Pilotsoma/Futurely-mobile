const PRIVATE_IPV4_PATTERNS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
]

/**
 * Expo Go uses an exp:// LAN URL while development/production builds use the
 * app's futurely:// scheme. Only accept those known redirect shapes so the
 * OAuth endpoint cannot be used as an open redirect.
 */
export function validateMobileOAuthRedirectUri(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2_048) return null

  try {
    const url = new URL(value)

    if (url.protocol === 'futurely:') {
      return url.toString()
    }

    if (url.protocol !== 'exp:') return null

    const hostname = url.hostname.toLowerCase()
    const isPrivateHost =
      hostname === 'localhost' ||
      hostname === '::1' ||
      PRIVATE_IPV4_PATTERNS.some(pattern => pattern.test(hostname))

    return isPrivateHost ? url.toString() : null
  } catch {
    return null
  }
}

/**
 * OAuth tokens are placed in the URL fragment, which is not sent to HTTP
 * servers or commonly captured in request logs.
 */
export function buildMobileOAuthRedirect(
  redirectUri: string,
  params: Record<string, string>,
): string {
  const url = new URL(redirectUri)
  url.hash = new URLSearchParams(params).toString()
  return url.toString()
}
