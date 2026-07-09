import { api } from './client'

export interface DailyCoinsResult {
  coins: number
  claimed: boolean
  alreadyClaimed: boolean
  coinBonus: number
}

// Only endpoint mobile needs from marketplace.ts — the rest (boxes/shop/trade/
// leaderboard) is out of scope; see melodic-wobbling-pillow.md.
export async function claimDailyCoins(): Promise<DailyCoinsResult> {
  return api.post('/marketplace/daily-coins')
}
