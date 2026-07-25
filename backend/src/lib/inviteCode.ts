import crypto from 'crypto'
import { INVITE_ALPHABET, INVITE_CODE_LENGTH, MAX_INVITE_CODE_RETRIES } from '../constants/educator'
import { prisma } from './prisma'

function randomCode(): string {
  const bytes = crypto.randomBytes(INVITE_CODE_LENGTH)
  return Array.from(bytes)
    .map(b => INVITE_ALPHABET[b % INVITE_ALPHABET.length])
    .join('')
}

export async function generateUniqueInviteCode(): Promise<string> {
  for (let attempt = 0; attempt < MAX_INVITE_CODE_RETRIES; attempt++) {
    const code = randomCode()
    const existing = await prisma.classroom.findUnique({ where: { inviteCode: code } })
    if (!existing) return code
  }
  throw new Error('INVITE_CODE_GENERATION_FAILED')
}
