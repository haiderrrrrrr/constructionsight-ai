import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'

// Mock all external dependencies
vi.mock('@/utils/api', () => ({
  STREAM_BASE: 'http://localhost:8001',
  refreshTokens: vi.fn().mockResolvedValue('mock-token'),
  isTokenValid: vi.fn().mockReturnValue(true),
}))

vi.mock('@/utils/queryKeys', () => ({
  QK: {
    wfCameras: vi.fn((pid) => ['workforce', 'cameras', pid]),
    wfStatus: vi.fn((pid) => ['workforce', 'status', pid]),
  },
}))

vi.mock('@/utils/broadcast', () => ({
  broadcastRefresh: vi.fn(),
}))

vi.mock('@/utils/workforceCacheUtils', () => ({
  patchAlertInCache: vi.fn(),
}))

import useWorkforceStream from '@/hooks/useWorkforceStream'

// Minimal EventSource mock
class MockEventSource {
  constructor(url, opts) {
    this.url = url
    this.withCredentials = opts?.withCredentials
    this.onopen = null
    this.onmessage = null
    this.onerror = null
    MockEventSource.instances.push(this)
  }
  close() {
    this.closed = true
    MockEventSource.closedCount++
  }
}
MockEventSource.instances = []
MockEventSource.closedCount = 0

describe('useWorkforceStream', () => {
  let mockQueryClient

  beforeEach(() => {
    MockEventSource.instances = []
    MockEventSource.closedCount = 0
    globalThis.EventSource = MockEventSource
    // Provide a fake access_token in sessionStorage
    sessionStorage.setItem('access_token', 'mock-access-token')
    mockQueryClient = {
      setQueryData: vi.fn(),
      getQueryData: vi.fn().mockReturnValue(null),
      invalidateQueries: vi.fn(),
      setQueriesData: vi.fn(),
      removeQueries: vi.fn(),
    }
  })

  afterEach(() => {
    sessionStorage.clear()
    vi.clearAllMocks()
  })

  it('opens an EventSource connection on mount', async () => {
    renderHook(() => useWorkforceStream(42, mockQueryClient))
    // Allow async connect() to run
    await vi.waitFor(() => expect(MockEventSource.instances.length).toBeGreaterThan(0))
    const es = MockEventSource.instances[0]
    expect(es.url).toContain('/projects/42/workforce/stream')
    expect(es.url).toContain('token=mock-access-token')
  })

  it('closes the EventSource on unmount', async () => {
    const { unmount } = renderHook(() => useWorkforceStream(42, mockQueryClient))
    await vi.waitFor(() => expect(MockEventSource.instances.length).toBeGreaterThan(0))
    unmount()
    expect(MockEventSource.instances[0].closed).toBe(true)
  })

  it('does not open connection when projectId is falsy', async () => {
    renderHook(() => useWorkforceStream(null, mockQueryClient))
    // Short delay — no connection should be opened
    await new Promise(r => setTimeout(r, 50))
    expect(MockEventSource.instances.length).toBe(0)
  })

  it('calls onConnect callback when connection opens', async () => {
    const onConnect = vi.fn()
    renderHook(() => useWorkforceStream(10, mockQueryClient, { onConnect }))
    await vi.waitFor(() => expect(MockEventSource.instances.length).toBeGreaterThan(0))
    const es = MockEventSource.instances[0]
    es.onopen?.()
    expect(onConnect).toHaveBeenCalled()
  })

  it('calls onDisconnect callback on unmount', async () => {
    const onDisconnect = vi.fn()
    const { unmount } = renderHook(() =>
      useWorkforceStream(11, mockQueryClient, { onDisconnect })
    )
    await vi.waitFor(() => expect(MockEventSource.instances.length).toBeGreaterThan(0))
    unmount()
    expect(onDisconnect).toHaveBeenCalled()
  })

  it('invalidates queries on workforce_alert event', async () => {
    const { result } = renderHook(() => useWorkforceStream(5, mockQueryClient))
    await vi.waitFor(() => expect(MockEventSource.instances.length).toBeGreaterThan(0))
    const es = MockEventSource.instances[0]
    es.onmessage?.({ data: JSON.stringify({ type: 'workforce_alert', camera_id: 1 }) })
    expect(mockQueryClient.invalidateQueries).toHaveBeenCalled()
  })

  it('calls onStatsUpdate callback for workforce_stats_update event', async () => {
    const onStatsUpdate = vi.fn()
    renderHook(() => useWorkforceStream(7, mockQueryClient, { onStatsUpdate }))
    await vi.waitFor(() => expect(MockEventSource.instances.length).toBeGreaterThan(0))
    const es = MockEventSource.instances[0]
    es.onmessage?.({
      data: JSON.stringify({
        type: 'workforce_stats_update',
        camera_id: 2,
        current_worker_count: 5,
        active_count: 3,
        idle_count: 2,
        utilization_score: 0.6,
        zone_status: 'normal',
        congestion_flag: false,
        avg_dwell_seconds: 120,
      }),
    })
    expect(onStatsUpdate).toHaveBeenCalled()
  })
})
