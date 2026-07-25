import { prisma } from './prisma'
import { logger } from '../common/logger'
import { sendToUser } from './websocket'

export interface CreateNotificationInput {
  userId: number
  fromUserId: number
  type: string
  preview?: string
  postId?: number
}

/**
 * Creates a Notification row and pushes it to the recipient over WebSocket.
 * Never throws — failures are logged via the structured logger and swallowed
 * so callers do not need to wrap this in try/catch. Returns whether the
 * Notification row was actually persisted (the DB write is what matters for
 * "did this get delivered" — the WebSocket push is best-effort on top of an
 * already-persisted row, so a live-push failure alone doesn't count as a
 * failure here). Callers that need to distinguish success from failure
 * (e.g. anything that marks a row as "reminded" so it's never retried)
 * MUST check this return value — silently ignoring it turns any transient
 * failure into a permanent, unretryable one.
 */
export async function createAndSendNotification(input: CreateNotificationInput): Promise<boolean> {
  try {
    const notif = await prisma.notification.create({
      data: {
        userId: input.userId,
        fromUserId: input.fromUserId,
        type: input.type,
        preview: input.preview,
        postId: input.postId,
      },
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            tag: true,
            tagColor: true,
            nameColor: true,
            avatarUrl: true,
          },
        },
      },
    })
    try {
      sendToUser(input.userId, 'NOTIFICATION', notif)
    } catch (pushErr) {
      // The row is already persisted — a live-push failure just means the
      // user sees it next time they open the bell instead of instantly.
      logger.error('createAndSendNotification_push_failed', {
        userId: input.userId,
        type: input.type,
        error: pushErr instanceof Error ? pushErr.message : String(pushErr),
      })
    }
    return true
  } catch (err) {
    logger.error('createAndSendNotification_failed', {
      userId: input.userId,
      type: input.type,
      error: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}
