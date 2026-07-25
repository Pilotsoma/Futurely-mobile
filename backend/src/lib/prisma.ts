import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'
import { Pool, neonConfig } from '@neondatabase/serverless'
import ws from 'ws'
import { logger } from '../common/logger'

neonConfig.webSocketConstructor = ws

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

// Neon's serverless driver terminates idle WebSocket connections after a
// period of inactivity. The pool emits an 'error' event on the idle client
// when that happens — without a listener, Node's default behavior is to
// throw, which wedges the process (it keeps running but stops responding to
// requests, since the underlying pool state is left inconsistent). Attaching
// a listener lets the pool do what it's designed to do: discard the dead
// client and transparently open a new one on the next query. No reconnect
// logic needed here — pg-style pools already handle that internally.
pool.on('error', (err: Error) => {
  logger.error('Neon pool idle client error — pool will recover on next query', {
    message: err.message,
  })
})

const adapter = new PrismaNeon(pool)

export const prisma = new PrismaClient({ adapter })
