import { describe, it, expect } from 'vitest'
import { getProjectStatusMeta } from '@/utils/projectStatusMeta'

describe('getProjectStatusMeta', () => {
  it('returns label, color, badge, progress for draft status', () => {
    const meta = getProjectStatusMeta('draft')
    expect(meta.label).toBe('Draft')
    expect(meta.color).toBeTruthy()
    expect(meta.badge).toBeTruthy()
    expect(typeof meta.progress).toBe('number')
  })

  it('returns meta for active status', () => {
    const meta = getProjectStatusMeta('active')
    expect(meta.label).toBe('Active')
    expect(meta.progress).toBe(100)
  })

  it('returns meta for archived status', () => {
    const meta = getProjectStatusMeta('archived')
    expect(meta.label).toBe('Archived')
    expect(meta.progress).toBe(100)
  })

  it('normalizes setup_in_progress to setup label', () => {
    const meta = getProjectStatusMeta('setup_in_progress')
    expect(meta.label).toBe('Setup')
  })

  it('normalizes uppercase status string', () => {
    const meta = getProjectStatusMeta('ACTIVE')
    expect(meta.label).toBe('Active')
  })

  it('returns fallback for unknown status', () => {
    const meta = getProjectStatusMeta('unknown_status')
    expect(meta.label).toBeTruthy()  // fallback capitalizes the string
    expect(meta.color).toBeTruthy()
  })

  it('returns fallback for null status', () => {
    const meta = getProjectStatusMeta(null)
    expect(meta).toBeTruthy()
    expect(meta.label).toBeTruthy()
  })

  it('returns fallback for empty string status', () => {
    const meta = getProjectStatusMeta('')
    expect(meta).toBeTruthy()
  })

  it('all known statuses return an object with required keys', () => {
    const statuses = ['draft', 'setup_in_progress', 'active', 'archived']
    const requiredKeys = ['label', 'color', 'badge', 'progress', 'progressColor']
    for (const status of statuses) {
      const meta = getProjectStatusMeta(status)
      for (const key of requiredKeys) {
        expect(meta).toHaveProperty(key), `Missing key '${key}' for status '${status}'`
      }
    }
  })
})
