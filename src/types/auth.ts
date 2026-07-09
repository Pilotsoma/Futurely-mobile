export interface AuthUser {
  id: number
  email: string
  name: string | null
  role: string
  emailVerified: boolean
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
  dateOfBirth: string // "YYYY-MM-DD"
}

export interface SendOtpRequest {
  email: string
}

export interface MeResponse {
  id: number
  email: string
  name: string | null
  role: string
  emailVerified: boolean
  createdAt: string
}

export interface DeleteAccountRequest {
  password?: string
}
