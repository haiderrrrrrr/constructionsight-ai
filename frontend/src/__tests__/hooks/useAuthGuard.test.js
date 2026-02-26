import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// Mock all dependencies before importing the hook
vi.mock('@/utils/api', () => ({
  isTokenValid: vi.fn(),
  refreshTokens: vi.fn(),
  getPlatformRole: vi.fn(),
}))

vi.mock('@/utils/theme', () => ({
  syncThemeFromServer: vi.fn().mockResolvedValue(undefined),
}))

import useAuthGuard from '@/hooks/useAuthGuard'
import { isTokenValid, refreshTokens, getPlatformRole } from '@/utils/api'

describe('useAuthGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns status=ok immediately when token is already valid', async () => {
    isTokenValid.mockReturnValue(true)
    const { result } = renderHook(() => useAuthGuard())
    // Synchronous path — valid token skips async refresh
    expect(result.current.status).toBe('ok')
    expect(result.current.redirectTo).toBeNull()
  })

  it('returns status=loading while refresh is in flight', () => {
    isTokenValid.mockReturnValue(false)
    refreshTokens.mockReturnValue(new Promise(() => {})) // never resolves
    const { result } = renderHook(() => useAuthGuard())
    expect(result.current.status).toBe('loading')
  })

  it('returns status=ok after successful token refresh', async () => {
    isTokenValid.mockReturnValue(false)
    refreshTokens.mockResolvedValue('new-access-token')
    const { result } = renderHook(() => useAuthGuard())
    await waitFor(() => expect(result.current.status).toBe('ok'))
    expect(result.current.redirectTo).toBeNull()
  })

  it('returns status=fail when token refresh fails', async () => {
    isTokenValid.mockReturnValue(false)
    refreshTokens.mockResolvedValue(null)
    const { result } = renderHook(() => useAuthGuard())
    await waitFor(() => expect(result.current.status).toBe('fail'))
    expect(result.current.redirectTo).toBe('/login')
  })

  it('redirects to /projects/my when requiredRole does not match', async () => {
    isTokenValid.mockReturnValue(true)
    getPlatformRole.mockReturnValue('user')
    const { result } = renderHook(() => useAuthGuard('admin'))
    expect(result.current.status).toBe('fail')
    expect(result.current.redirectTo).toBe('/projects/my')
  })

  it('returns ok when requiredRole matches platform role', async () => {
    isTokenValid.mockReturnValue(true)
    getPlatformRole.mockReturnValue('admin')
    const { result } = renderHook(() => useAuthGuard('admin'))
    expect(result.current.status).toBe('ok')
  })

  it('transitions to fail when auth:logout event fires', async () => {
    isTokenValid.mockReturnValue(true)
    const { result } = renderHook(() => useAuthGuard())
    expect(result.current.status).toBe('ok')
    act(() => {
      window.dispatchEvent(new Event('auth:logout'))
    })
    await waitFor(() => expect(result.current.status).toBe('fail'))
  })
})
