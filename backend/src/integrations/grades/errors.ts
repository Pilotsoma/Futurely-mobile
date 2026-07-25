// Login/session pattern adapted from gradexis-api (Apache-2.0): github.com/ruskcoder/gradexis-api

export class APIError extends Error {
  status: number
  constructor(message: string, status = 500) {
    super(message)
    this.name = 'APIError'
    this.status = status
  }
}

export class AuthenticationError extends APIError {
  constructor(message: string) {
    super(message, 401)
    this.name = 'AuthenticationError'
  }
}

export class ValidationError extends APIError {
  constructor(message: string) {
    super(message, 400)
    this.name = 'ValidationError'
  }
}

export class ScrapeError extends APIError {
  constructor(message: string) {
    super(message, 502)
    this.name = 'ScrapeError'
  }
}
