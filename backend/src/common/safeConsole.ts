import { logger } from './logger'

type LegacyLogLevel = 'info' | 'warn' | 'error'

function categoryFromArgs(args: unknown[]): string {
  const first = args[0]
  if (typeof first !== 'string') return 'legacy'

  const bracketedCategory = first.match(/^\[([A-Za-z][A-Za-z ]{0,40})\]/)?.[1]
  if (!bracketedCategory) return 'legacy'

  return bracketedCategory.trim().toLowerCase().replace(/\s+/g, '_')
}

function write(level: LegacyLogLevel, args: unknown[]): void {
  // Intentionally discard all original arguments. Legacy integration
  // diagnostics included page HTML, cookies, names, grades, and usernames.
  // Keeping only a static bracketed category preserves an operational signal
  // without risking FERPA data in logs.
  logger[level]('legacy_integration_log', { category: categoryFromArgs(args) })
}

export const safeConsole = {
  log: (...args: unknown[]): void => write('info', args),
  warn: (...args: unknown[]): void => write('warn', args),
  error: (...args: unknown[]): void => write('error', args),
}
