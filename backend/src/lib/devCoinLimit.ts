const DEV_COIN_ADD_LIMIT = 10_000
const devCoinAddedToday = new Map<number, { date: string; total: number }>()

/**
 * Checks and records a DEV coin add. Returns null if allowed, or an error
 * string if the daily limit would be exceeded.
 */
export function checkDevCoinLimit(userId: number, amount: number): string | null {
  const todayUTC = new Date().toISOString().slice(0, 10)
  const entry = devCoinAddedToday.get(userId)
  const todayTotal = entry?.date === todayUTC ? entry.total : 0
  if (todayTotal + amount > DEV_COIN_ADD_LIMIT) {
    const remaining = Math.max(0, DEV_COIN_ADD_LIMIT - todayTotal)
    return `Daily add limit is ${DEV_COIN_ADD_LIMIT.toLocaleString()} coins. You have ${remaining.toLocaleString()} remaining today.`
  }
  devCoinAddedToday.set(userId, { date: todayUTC, total: todayTotal + amount })
  return null
}
