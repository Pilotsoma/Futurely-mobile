/**
 * ClassLink session cookie helper.
 *
 * BACKGROUND
 * ──────────
 * Many school districts use ClassLink as a Single Sign-On (SSO) layer in front
 * of their Home Access Center (HAC) portal. When a student visits HAC through
 * ClassLink, the browser holds a `clsession` cookie on the `.classlink.com`
 * domain that proves the student is authenticated.
 *
 * The Chrome extension at https://github.com/ruskcoder/gradexis-login
 * automates extracting this cookie:
 *   1. User clicks "Connect via ClassLink" in the NextStep app.
 *   2. The extension opens launchpad.classlink.com and waits for the student
 *      to complete SSO login.
 *   3. Once the student lands on myapps.classlink.com, the extension reads
 *      the `clsession` cookie and appends it to the redirect URL back to
 *      NextStep as ?clsession=<VALUE>.
 *   4. NextStep passes that value to loginHAC() as clsessionCookie.
 *
 * Without the extension, the student can extract the cookie manually from
 * browser DevTools → Application → Cookies → .classlink.com → clsession.
 *
 * WHAT THIS FILE DOES
 * ───────────────────
 * Validates the clsession value and builds parameters for the HAC login flow.
 * The actual cookie injection happens inside hacClient.loginHAC().
 */

export interface ClassLinkSession {
  clsessionCookie: string
  districtUrl: string
}

/**
 * Validate and package a ClassLink session cookie for use in loginHAC().
 *
 * @param clsessionCookie  The raw `clsession` cookie value from the browser extension
 * @param districtUrl      The HAC base URL for the student's district
 *                         e.g. "https://hac.mydistrict.edu/"
 * @returns A typed object ready to spread into loginHAC() parameters
 */
export function buildSessionWithCLCookie(
  clsessionCookie: string,
  districtUrl: string
): ClassLinkSession {
  if (!clsessionCookie || typeof clsessionCookie !== 'string' || clsessionCookie.trim().length < 10) {
    throw new Error(
      'Invalid clsession cookie — make sure you copied the full value from the browser extension'
    )
  }

  let normalizedUrl: string
  try {
    const u = new URL(districtUrl)
    if (!['https:', 'http:'].includes(u.protocol)) throw new Error()
    normalizedUrl = u.href
  } catch {
    throw new Error(`districtUrl "${districtUrl}" is not a valid URL`)
  }

  return {
    clsessionCookie: clsessionCookie.trim(),
    districtUrl: normalizedUrl,
  }
}

/**
 * Returns instructions for obtaining the clsession cookie manually
 * (for users who cannot install the Chrome extension).
 */
export function getManualExtractionInstructions(): string {
  return [
    '1. Open Chrome and navigate to your school portal via ClassLink.',
    '2. Press F12 to open DevTools.',
    '3. Go to Application → Cookies → https://myapps.classlink.com',
    '4. Copy the value of the cookie named "clsession".',
    '5. Paste that value into the Futurely ClassLink cookie field.',
  ].join('\n')
}
