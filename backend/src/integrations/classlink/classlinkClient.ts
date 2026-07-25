import axios, { type AxiosInstance } from 'axios';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';
import * as cheerio from 'cheerio';
import { DistrictConfig } from './districtConfig';

export interface ClasslinkSession {
  http: AxiosInstance;
  cookieJar: CookieJar;
  districtId: string;
  userId: number;
  loggedInAt: Date;
}

const sessions = new Map<number, ClasslinkSession>();

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

export async function loginClasslink(
  userId: number,
  username: string,
  password: string,
  district: DistrictConfig
): Promise<ClasslinkSession> {
  const jar = new CookieJar();
  const http = wrapper(axios.create({
    jar,
    withCredentials: true,
    headers: BROWSER_HEADERS,
    maxRedirects: 10,
    timeout: 20000,
  }));

  // Step 1: GET the launchpad page — this sets cookies and may redirect to the
  // district's IdP (ClassLink, Google, ADFS, etc.)
  const launchpadUrl = `https://launchpad.classlink.com/${district.classlink.tenant}`;
  const loginPageResp = await http.get(launchpadUrl);
  const finalLandingUrl: string = (loginPageResp.request?.res?.responseUrl as string) || launchpadUrl;
  const $ = cheerio.load(loginPageResp.data as string);

  // Detect Google SSO redirect
  const isGoogleSSO =
    finalLandingUrl.includes('accounts.google.com') ||
    $('a[href*="accounts.google.com"]').length > 0 ||
    $('form[action*="accounts.google.com"]').length > 0;

  if (isGoogleSSO) {
    throw new Error(
      `CLASSLINK_GOOGLE_SSO: District "${district.id}" uses Google SSO. ` +
      `ClassLink credential login is not available.`
    );
  }

  // Determine the form action — resolve relative URLs against where we landed
  const formAction = ($('form').attr('action') as string | undefined) || '';
  const loginPostUrl = formAction.startsWith('http')
    ? formAction
    : formAction
      ? new URL(formAction, finalLandingUrl).toString()
      : `https://launchpad.classlink.com/idp/login`;

  // Step 2: Extract ALL hidden form fields (state, nonce, client_id, redirect_uri, etc.)
  // ClassLink uses OAuth/OIDC — these tokens are required for the session to be established.
  const formData = new URLSearchParams();
  $('form input').each((_, el) => {
    const name = $(el).attr('name');
    const value = ($(el).val() as string) ?? '';
    if (name) formData.set(name, value);
  });

  // Detect the actual field names for username and password — ClassLink uses 'username',
  // but some districts use 'email', 'j_username', or the first text/email input on the page.
  const usernameFieldName =
    $('form input[name="username"]').length ? 'username' :
    $('form input[name="email"]').length ? 'email' :
    $('form input[name="j_username"]').length ? 'j_username' :
    $('form input[name="user"]').length ? 'user' :
    ($('form input[type="email"]').attr('name') as string | undefined) ||
    ($('form input[type="text"]').first().attr('name') as string | undefined) ||
    'username';

  const passwordFieldName =
    $('form input[name="password"]').length ? 'password' :
    $('form input[name="j_password"]').length ? 'j_password' :
    $('form input[name="pass"]').length ? 'pass' :
    ($('form input[type="password"]').attr('name') as string | undefined) ||
    'password';

  console.log(`[ClassLink:${district.id}] loginUrl=${finalLandingUrl} postUrl=${loginPostUrl} userField=${usernameFieldName} passField=${passwordFieldName}`);

  formData.set(usernameFieldName, username);
  formData.set(passwordFieldName, password);

  // Step 3: POST credentials — follow redirects back to the launchpad
  const postResp = await http.post(loginPostUrl, formData.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': finalLandingUrl,
      'Origin': new URL(finalLandingUrl).origin,
    },
    maxRedirects: 15,
  });
  const postFinalUrl: string = (postResp.request?.res?.responseUrl as string) || '';
  console.log(`[ClassLink:${district.id}] postFinalUrl=${postFinalUrl}`);

  // Step 4: Verify login success.
  // Primary check: inspect the session cookies on the ClassLink domain.
  // A successful ClassLink login sets a session cookie (e.g. clsession, .AspNet.Cookies, or similar).
  const classlinkCookies = jar.getCookiesSync('https://launchpad.classlink.com');
  const hasSessionCookie = classlinkCookies.some(c =>
    c.key.toLowerCase().includes('session') ||
    c.key.toLowerCase().includes('clsession') ||
    c.key.toLowerCase().includes('auth') ||
    c.key.toLowerCase().includes('.aspnet')
  );
  console.log(`[ClassLink:${district.id}] cookies after login: ${classlinkCookies.map(c => c.key).join(', ')}`);

  // Secondary check: if the POST redirect ended back on a login/error page
  const landedOnLoginPage =
    postFinalUrl.includes('idp/login') ||
    postFinalUrl.includes('/login') ||
    postFinalUrl.includes('accounts.google.com');

  if (landedOnLoginPage && !hasSessionCookie) {
    throw new Error('CLASSLINK_INVALID_CREDENTIALS: Login failed. Check username and password.');
  }

  if (landedOnLoginPage && hasSessionCookie) {
    // Redirected to login page but have a cookie — verify by fetching launchpad
    const verifyResp = await http.get(launchpadUrl);
    const verifyUrl: string = (verifyResp.request?.res?.responseUrl as string) || '';
    console.log(`[ClassLink:${district.id}] verifyUrl=${verifyUrl}`);
    if (verifyUrl.includes('idp/login') || verifyUrl.includes('accounts.google.com')) {
      throw new Error('CLASSLINK_INVALID_CREDENTIALS: Login failed. Check username and password.');
    }
  }

  const session: ClasslinkSession = {
    http,
    cookieJar: jar,
    districtId: district.id,
    userId,
    loggedInAt: new Date(),
  };

  sessions.set(userId, session);
  console.log(`[ClassLink:${district.id}] Session stored for userId=${userId}`);
  return session;
}

export function getClasslinkSession(userId: number): ClasslinkSession | undefined {
  return sessions.get(userId);
}

export function clearClasslinkSession(userId: number): void {
  sessions.delete(userId);
}

export async function getOrRefreshSession(
  userId: number,
  username: string,
  password: string,
  district: DistrictConfig
): Promise<ClasslinkSession> {
  const existing = sessions.get(userId);
  if (existing) {
    const ageMs = Date.now() - existing.loggedInAt.getTime();
    if (ageMs < 45 * 60 * 1000) return existing;
  }
  return loginClasslink(userId, username, password, district);
}
import { safeConsole as console } from '../../common/safeConsole'
