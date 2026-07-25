/**
 * Write-tool rate limiting using the AgentWriteRateLimit Postgres table.
 *
 * Hourly windows, per user per tool. No Redis dependency — the Postgres
 * row is both the durable record and the counter.
 *
 * Architecture note: ARCHITECTURE.md mentions Redis/Upstash for GPA
 * computation caching, but no Redis connection is wired up in this codebase.
 * Until that connection is established, all rate limit counters live here
 * in Postgres. The AgentWriteRateLimit table is designed to also serve as
 * the durable record when Redis is added later.
 *
 * Bug 8 fix: the former check-then-increment two-step (checkWriteRateLimit +
 * incrementWriteRateLimit) had a TOCTOU race where concurrent dispatches
 * could both read a count below the limit before either incremented it,
 * letting both proceed and pushing the total over the limit.
 *
 * The fix: a single atomic upsert that only increments when the current
 * count is below the limit. If the count is already at or above the limit,
 * the UPDATE is skipped (0 rows affected) and the caller is denied.
 */

import { prisma } from '../../lib/prisma'

function getHourWindowStart(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0, 0)
}

/**
 * Atomically attempts to consume one write-rate-limit slot for the given
 * user + tool in the current hourly window.
 *
 * Returns true  → slot consumed, call is allowed (counter incremented).
 * Returns false → limit already reached, call is denied (counter unchanged).
 *
 * Implementation: a single INSERT … ON CONFLICT DO UPDATE WHERE callCount < limit.
 * When the WHERE clause is false (limit hit), the UPDATE is skipped and Postgres
 * reports 0 rows affected. When the INSERT fires (first call this window) or the
 * UPDATE fires (count was below limit), 1 row is reported and the slot is consumed.
 */
export async function consumeWriteRateLimitSlot(
  userId: number,
  toolName: string,
  limitPerHour: number,
): Promise<boolean> {
  const windowStart = getHourWindowStart()

  // Template-literal $executeRaw uses bind parameters for all interpolated
  // values, preventing SQL injection and ensuring type safety.
  const affected = await prisma.$executeRaw`
    INSERT INTO "AgentWriteRateLimit" ("userId", "toolName", "windowStart", "callCount", "lastCallAt")
    VALUES (${userId}, ${toolName}, ${windowStart}, 1, NOW())
    ON CONFLICT ("userId", "toolName", "windowStart")
    DO UPDATE
      SET "callCount"  = "AgentWriteRateLimit"."callCount" + 1,
          "lastCallAt" = NOW()
      WHERE "AgentWriteRateLimit"."callCount" < ${limitPerHour}
  `

  // $executeRaw returns the number of rows affected by the statement.
  // 0 → the DO UPDATE WHERE clause was false (limit reached) → denied.
  // 1 → either the INSERT fired (new window) or the UPDATE incremented → allowed.
  return affected > 0
}
