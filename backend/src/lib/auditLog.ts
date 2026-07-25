import { prisma } from './prisma'
import { logger } from '../common/logger'

interface AuditEntry {
  userId: number
  resourceType: string
  resourceId?: string
  action: string
  ipAddress: string
}

export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  await prisma.complianceAuditLog.create({ data: entry }).catch((err: unknown) => {
    logger.error('audit_log_write_failed', { error: err instanceof Error ? err.message : String(err), action: entry.action, resourceType: entry.resourceType })
  })
}
