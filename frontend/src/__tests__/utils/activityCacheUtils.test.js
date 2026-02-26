import { describe, it, expect, vi, beforeEach } from 'vitest'
import { patchAlertInCache } from '@/utils/activityCacheUtils'

function makeQueryClient(queriesData = []) {
  const store = new Map()
  queriesData.forEach(([key, value]) => store.set(JSON.stringify(key), { key, value }))
  return {
    getQueriesData: ({ queryKey }) => {
      const results = []
      store.forEach(({ key, value }) => {
        if (queryKey.every((k, i) => key[i] === k)) {
          results.push([key, value])
        }
      })
      return results
    },
    setQueryData: vi.fn((key, updater) => {
      const k = JSON.stringify(key)
      const existing = store.get(k)
      const newValue = typeof updater === 'function' ? updater(existing?.value) : updater
      store.set(k, { key, value: newValue })
    }),
    _store: store,
  }
}

describe('patchAlertInCache', () => {
  it('patches matching alert status in alerts cache', () => {
    const projectId = 1
    const alertsKey = ['activity', 'alerts', projectId]
    const cachedAlerts = {
      items: [
        { id: 10, status: 'open', message: 'Hard hat missing' },
        { id: 11, status: 'open', message: 'PPE violation' },
      ],
    }
    const qc = makeQueryClient([[alertsKey, cachedAlerts]])
    patchAlertInCache(qc, projectId, { alert_id: 10, status: 'resolved' })
    expect(qc.setQueryData).toHaveBeenCalled()
  })

  it('preserves non-matching alerts unchanged', () => {
    const projectId = 2
    const alertsKey = ['activity', 'alerts', projectId]
    const cachedAlerts = {
      items: [
        { id: 20, status: 'open' },
        { id: 21, status: 'open' },
      ],
    }
    const qc = makeQueryClient([[alertsKey, cachedAlerts]])
    patchAlertInCache(qc, projectId, { alert_id: 20, status: 'acknowledged' })
    const [, updaterArg] = qc.setQueryData.mock.calls[0]
    const result = typeof updaterArg === 'function' ? updaterArg(cachedAlerts) : updaterArg
    const unchanged = result.items.find(a => a.id === 21)
    expect(unchanged.status).toBe('open')
  })

  it('patches open_alerts in summary cache when provided', () => {
    const projectId = 3
    const alertsKey = ['activity', 'alerts', projectId]
    const summaryKey = ['activity', 'summary', projectId]
    const cachedAlerts = { items: [{ id: 30, status: 'open' }] }
    const cachedSummary = { open_alerts: 5, total: 10 }
    const qc = makeQueryClient([
      [alertsKey, cachedAlerts],
      [summaryKey, cachedSummary],
    ])
    patchAlertInCache(qc, projectId, { alert_id: 30, status: 'resolved', open_alerts: 4 })
    // setQueryData should have been called at least twice (alert + summary)
    expect(qc.setQueryData.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('does not patch summary when open_alerts is null', () => {
    const projectId = 4
    const alertsKey = ['activity', 'alerts', projectId]
    const summaryKey = ['activity', 'summary', projectId]
    const cachedAlerts = { items: [{ id: 40, status: 'open' }] }
    const cachedSummary = { open_alerts: 3 }
    const qc = makeQueryClient([
      [alertsKey, cachedAlerts],
      [summaryKey, cachedSummary],
    ])
    patchAlertInCache(qc, projectId, { alert_id: 40, status: 'resolved', open_alerts: null })
    // Only the alerts cache should be patched
    const calls = qc.setQueryData.mock.calls
    const summaryCalls = calls.filter(([key]) => JSON.stringify(key).includes('summary'))
    expect(summaryCalls.length).toBe(0)
  })

  it('handles empty items array gracefully', () => {
    const projectId = 5
    const alertsKey = ['activity', 'alerts', projectId]
    const qc = makeQueryClient([[alertsKey, { items: [] }]])
    expect(() => patchAlertInCache(qc, projectId, { alert_id: 99, status: 'resolved' })).not.toThrow()
  })

  it('handles missing cached data gracefully', () => {
    const projectId = 6
    const alertsKey = ['activity', 'alerts', projectId]
    // Cache with no items key
    const qc = makeQueryClient([[alertsKey, null]])
    expect(() => patchAlertInCache(qc, projectId, { alert_id: 1, status: 'resolved' })).not.toThrow()
  })

  it('does not mutate original cached object', () => {
    const projectId = 7
    const alertsKey = ['activity', 'alerts', projectId]
    const original = { items: [{ id: 70, status: 'open' }] }
    const cachedAlerts = { items: [...original.items] }
    const qc = makeQueryClient([[alertsKey, cachedAlerts]])
    patchAlertInCache(qc, projectId, { alert_id: 70, status: 'resolved' })
    // updater should create new object, not mutate in place
    expect(cachedAlerts.items[0].status).toBe('open')
  })
})
