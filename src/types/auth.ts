export type AccountStatus =
  | 'ACTIVE'
  | 'DOB_MISMATCH_LOCKED'
  | 'UNDER_13_BANNED'

export interface AuthUser {
  id: number
  email: string
  name: string | null
  role: string
  emailVerified: boolean
  accountStatus: AccountStatus
  bannedUntilDate: string | null
  hasSchoolConnection?: boolean
  hasSchoolRecord?: boolean
}

export interface TokenPair {
  token: string
  refreshToken: string
}

export interface LoginRequest {
  email: string
  password: string
}

export interface RegisterRequest {
  email: string
  password: string
  name?: string
  otp: string
  dateOfBirth: string
  agreedTos: true
  agreedPrivacy: true
  agreedAge: true
}

export interface SendOtpRequest {
  email: string
}

export interface MeResponse extends AuthUser {
  createdAt: string
  dobCorrectionAttempts: number
  hasSchoolConnection: boolean
  hasSchoolRecord: boolean
}

export interface AccountStatusResponse {
  accountStatus: AccountStatus
  bannedUntilDate: string | null
  dobCorrectionAttempts: number
  dobCorrectionAttemptsRemaining: number
  hasSchoolConnection: boolean
  hasSchoolRecord: boolean
}

export interface DeleteAccountRequest {
  password?: string
}
