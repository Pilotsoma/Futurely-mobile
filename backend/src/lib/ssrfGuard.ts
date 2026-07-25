import { promises as dns } from 'dns'
import net from 'net'

// Blocks requests to loopback, link-local (incl. cloud metadata 169.254.169.254),
// private, carrier-grade NAT, and multicast/reserved ranges — both as literal IPs
// in the URL and as DNS-resolved addresses (defends against DNS rebinding).
function isPrivateOrReservedIp(ip: string): boolean {
  const type = net.isIP(ip)
  if (type === 4) {
    const [a, b] = ip.split('.').map(Number)
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
    if (a >= 224) return true // multicast + reserved
    return false
  }
  if (type === 6) {
    const lower = ip.toLowerCase()
    if (lower === '::1' || lower === '::') return true
    if (lower.startsWith('fe80:')) return true // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true // unique local
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPrivateOrReservedIp(mapped[1])
    return false
  }
  return true // not a recognizable IP — treat as unsafe
}

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal'])

/**
 * Throws if `rawUrl` isn't a plain http(s) URL that resolves only to public
 * addresses. Call this on every user-supplied URL before the server makes an
 * outbound request to it (SSRF prevention).
 */
export async function assertPublicHttpUrl(rawUrl: string): Promise<void> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error('Invalid URL')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http/https URLs are allowed')
  }

  const hostname = parsed.hostname.toLowerCase()
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new Error('This host is not allowed')
  }

  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) throw new Error('This host is not allowed')
    return
  }

  let addresses: string[]
  try {
    const results = await dns.lookup(hostname, { all: true, verbatim: true })
    addresses = results.map(r => r.address)
  } catch {
    throw new Error('Could not resolve host')
  }

  if (addresses.length === 0) throw new Error('Could not resolve host')
  for (const addr of addresses) {
    if (isPrivateOrReservedIp(addr)) {
      throw new Error('This host resolves to a disallowed address')
    }
  }
}
