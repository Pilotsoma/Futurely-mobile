import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'

const ALGO = 'aes-256-gcm'

function getKey(): Buffer {
  const hex = process.env.CREDENTIAL_ENCRYPTION_KEY
  if (hex && /^[0-9a-f]{64}$/i.test(hex)) {
    return Buffer.from(hex, 'hex')
  }

  if (process.env.NODE_ENV !== 'production' && process.env.JWT_SECRET) {
    return createHash('sha256')
      .update(`futurely-local-credential-key:${process.env.JWT_SECRET}`)
      .digest()
  }

  throw new Error('CREDENTIAL_ENCRYPTION_KEY must be a 64-hex-char value in backend/.env')
}

/**
 * Encrypt a plaintext password with AES-256-GCM.
 * Returns "ivHex:tagHex:ciphertextHex" for DB storage.
 */
export function encryptPassword(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGO, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`
}

/**
 * Decrypt a value produced by encryptPassword().
 */
export function decryptPassword(ciphertext: string): string {
  const key = getKey()
  const parts = ciphertext.split(':')
  if (parts.length !== 3) throw new Error('Invalid encrypted credential format — expected ivHex:tagHex:encHex')
  const [ivHex, tagHex, encHex] = parts
  const iv  = Buffer.from(ivHex,  'hex')
  const tag = Buffer.from(tagHex, 'hex')
  const enc = Buffer.from(encHex, 'hex')
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
}
