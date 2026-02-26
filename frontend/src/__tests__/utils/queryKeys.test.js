import { describe, it, expect } from 'vitest'
import { QK } from '@/utils/queryKeys'

describe('QK — Query Key Registry', () => {
  it('ppeSummary returns an array with project-specific elements', () => {
    const key = QK.ppeSummary(1, '2025-01-01', '2025-01-31')
    expect(Array.isArray(key)).toBe(true)
    expect(key).toContain('ppe')
    expect(key).toContain('summary')
    expect(key).toContain(1)
  })

  it('same args produce identical arrays for ppeSummary', () => {
    const key1 = QK.ppeSummary(1, '2025-01-01', '2025-01-31')
    const key2 = QK.ppeSummary(1, '2025-01-01', '2025-01-31')
    expect(JSON.stringify(key1)).toBe(JSON.stringify(key2))
  })

  it('different projectIds produce different keys', () => {
    const key1 = QK.ppeSummary(1, '2025-01-01', '2025-01-31')
    const key2 = QK.ppeSummary(2, '2025-01-01', '2025-01-31')
    expect(JSON.stringify(key1)).not.toBe(JSON.stringify(key2))
  })

  it('actSummary returns an array with activity prefix', () => {
    const key = QK.actSummary(5, '2025-01-01', '2025-01-31', null)
    expect(Array.isArray(key)).toBe(true)
    expect(key[0]).toBe('activity')
    expect(key[1]).toBe('summary')
  })

  it('wfSummary returns an array with workforce prefix', () => {
    const key = QK.wfSummary(3, '2025-01-01', '2025-01-31', null)
    expect(key[0]).toBe('workforce')
  })

  it('riskSummary returns an array with risk prefix', () => {
    const key = QK.riskSummary(7)
    expect(key[0]).toBe('risk')
    expect(key).toContain(7)
  })

  it('all key factories return arrays', () => {
    const keyFactories = [
      () => QK.ppeSummary(1, '2025-01-01', '2025-01-31'),
      () => QK.ppeTrend(1, '2025-01-01', '2025-01-31'),
      () => QK.ppeStatus(1),
      () => QK.actSummary(1, '2025-01-01', '2025-01-31', null),
      () => QK.actAlerts(1, 1, null, null, null, null),
      () => QK.wfSummary(1, '2025-01-01', '2025-01-31', null),
      () => QK.eqSummary(1, '2025-01-01', '2025-01-31', null),
      () => QK.riskSummary(1),
      () => QK.riskTrend(1, 2),
      () => QK.riskEvents(1, 1, null, null),
    ]
    for (const factory of keyFactories) {
      const result = factory()
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
    }
  })

  it('ppeIncidents includes page and status filter in key', () => {
    const key1 = QK.ppeIncidents(1, 1, '2025-01-01', '2025-01-31', 'open')
    const key2 = QK.ppeIncidents(1, 2, '2025-01-01', '2025-01-31', 'open')
    expect(JSON.stringify(key1)).not.toBe(JSON.stringify(key2))
  })
})
