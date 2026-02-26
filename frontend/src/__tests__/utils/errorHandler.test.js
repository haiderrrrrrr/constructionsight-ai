import { describe, it, expect } from 'vitest'
import {
  parseApiError,
  extractFieldErrors,
  isConflictError,
  isAuthError,
  isNotFoundError,
  isValidationError,
  isNetworkError,
} from '@/utils/errorHandler'

describe('parseApiError', () => {
  it('returns fallback for null error', () => {
    expect(parseApiError(null)).toBe('An error occurred')
  })

  it('returns fallback string when provided', () => {
    expect(parseApiError(null, 'Custom fallback')).toBe('Custom fallback')
  })

  it('extracts detail string from FastAPI error JSON', () => {
    const err = new Error(JSON.stringify({ detail: 'Project not found' }))
    expect(parseApiError(err)).toBe('Project not found')
  })

  it('extracts first message from Pydantic validation error array', () => {
    const err = new Error(JSON.stringify([
      { loc: ['body', 'email'], msg: 'Invalid email format', type: 'value_error' },
    ]))
    expect(parseApiError(err)).toBe('Invalid email format')
  })

  it('strips "Value error, " prefix from Pydantic messages', () => {
    const err = new Error(JSON.stringify([
      { loc: ['body', 'password'], msg: 'Value error, Password too weak', type: 'value_error' },
    ]))
    expect(parseApiError(err)).toBe('Password too weak')
  })

  it('returns raw error message for non-JSON errors', () => {
    const err = new Error('Network connection failed')
    expect(parseApiError(err)).toBe('Network connection failed')
  })

  it('extracts first message from detail array', () => {
    const err = new Error(JSON.stringify({ detail: ['Field required', 'Value too short'] }))
    expect(parseApiError(err)).toBe('Field required')
  })
})

describe('extractFieldErrors', () => {
  it('returns empty object for non-Pydantic errors', () => {
    const err = new Error('Something went wrong')
    expect(extractFieldErrors(err)).toEqual({})
  })

  it('maps Pydantic error locations to field names', () => {
    const err = new Error(JSON.stringify([
      { loc: ['body', 'email'], msg: 'Invalid email format', type: 'value_error' },
      { loc: ['body', 'username'], msg: 'Username too short', type: 'value_error' },
    ]))
    const result = extractFieldErrors(err)
    expect(result.email).toBe('Invalid email format')
    expect(result.username).toBe('Username too short')
  })
})

describe('isConflictError', () => {
  it('returns false for null', () => {
    expect(isConflictError(null)).toBe(false)
  })

  it('detects "conflict" in message', () => {
    expect(isConflictError(new Error('409 conflict'))).toBe(true)
  })

  it('detects "already exists" in message', () => {
    expect(isConflictError(new Error('Email already exists'))).toBe(true)
  })
})

describe('isAuthError', () => {
  it('returns false for null', () => {
    expect(isAuthError(null)).toBe(false)
  })

  it('detects 401 in message', () => {
    expect(isAuthError(new Error('401 Unauthorized'))).toBe(true)
  })

  it('detects "session expired" in message', () => {
    expect(isAuthError(new Error('Session expired'))).toBe(true)
  })

  it('returns true for JSON with status 403', () => {
    const err = new Error(JSON.stringify({ status: 403, detail: 'Forbidden' }))
    expect(isAuthError(err)).toBe(true)
  })
})

describe('isNotFoundError', () => {
  it('returns false for null', () => {
    expect(isNotFoundError(null)).toBe(false)
  })

  it('detects 404 in message', () => {
    expect(isNotFoundError(new Error('404 Not Found'))).toBe(true)
  })

  it('detects "not found" in message', () => {
    expect(isNotFoundError(new Error('Project not found'))).toBe(true)
  })
})

describe('isNetworkError', () => {
  it('returns false for null', () => {
    expect(isNetworkError(null)).toBe(false)
  })

  it('detects "network" in message', () => {
    expect(isNetworkError(new Error('Network request failed'))).toBe(true)
  })

  it('detects "timeout" in message', () => {
    expect(isNetworkError(new Error('Connection timeout'))).toBe(true)
  })

  it('returns false for non-network errors', () => {
    expect(isNetworkError(new Error('Invalid email'))).toBe(false)
  })
})
