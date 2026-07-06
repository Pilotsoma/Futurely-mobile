// Marketplace API — narrow slice used outside the (unreachable-on-web) marketplace UI.
//
// The full marketplace (inventory/boxes/trading/listings/leaderboard) has no link
// anywhere in the web app's nav or pages — confirmed by grep, it's dead UI — so it is
// intentionally NOT ported to mobile. The daily-coins claim is the one exception: the
// web Dashboard calls it on load and shows a coin + GPA-bonus popup, so that much is
// real, reachable UI. See backend/src/routes/marketplace.ts for the full (unused) surface.

import { apiPost } from './client'

export interface DailyCoinsResponse {
  coins: number
  claimed: boolean
  alreadyClaimed: boolean
  coinBonus: number
}

// POST /marketplace/daily-coins — auto-claim the flat daily coin bonus (scaled by GPA).
export function claimDailyCoins(token: string): Promise<DailyCoinsResponse> {
  return apiPost<DailyCoinsResponse>('/marketplace/daily-coins', {}, token)
}
