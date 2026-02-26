import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFormPersist } from '@/hooks/useFormPersist'

describe('useFormPersist', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns initial state when no draft in sessionStorage', () => {
    const initial = { name: '', email: '' }
    const { result } = renderHook(() =>
      useFormPersist('cs:draft:test-form', initial)
    )
    const [formData] = result.current
    expect(formData).toEqual(initial)
  })

  it('restores state from sessionStorage on mount', () => {
    const saved = { name: 'Alice', email: 'alice@example.com' }
    sessionStorage.setItem('cs:draft:restore-test', JSON.stringify(saved))
    const initial = { name: '', email: '' }
    const { result } = renderHook(() =>
      useFormPersist('cs:draft:restore-test', initial)
    )
    const [formData] = result.current
    expect(formData.name).toBe('Alice')
    expect(formData.email).toBe('alice@example.com')
  })

  it('hasDraft is true when sessionStorage had data on mount', () => {
    sessionStorage.setItem('cs:draft:has-draft', JSON.stringify({ x: 1 }))
    const { result } = renderHook(() =>
      useFormPersist('cs:draft:has-draft', { x: 0 })
    )
    const hasDraft = result.current[5]
    expect(hasDraft).toBe(true)
  })

  it('hasDraft is false when sessionStorage is empty', () => {
    const { result } = renderHook(() =>
      useFormPersist('cs:draft:empty', { x: 0 })
    )
    const hasDraft = result.current[5]
    expect(hasDraft).toBe(false)
  })

  it('clearDraft removes key from sessionStorage', () => {
    sessionStorage.setItem('cs:draft:clear-test', JSON.stringify({ a: 1 }))
    const { result } = renderHook(() =>
      useFormPersist('cs:draft:clear-test', { a: 0 })
    )
    const [, , clearDraft] = result.current
    act(() => clearDraft())
    expect(sessionStorage.getItem('cs:draft:clear-test')).toBeNull()
  })

  it('persists updated form state to sessionStorage after debounce', async () => {
    const { result } = renderHook(() =>
      useFormPersist('cs:draft:write-test', { name: '' })
    )
    const [, setFormData] = result.current
    act(() => setFormData({ name: 'Bob' }))
    act(() => vi.advanceTimersByTime(500))
    const stored = JSON.parse(sessionStorage.getItem('cs:draft:write-test') || '{}')
    expect(stored.name).toBe('Bob')
  })

  it('does not persist when skip=true', () => {
    const { result } = renderHook(() =>
      useFormPersist('cs:draft:skip-test', { name: 'X' }, { skip: true })
    )
    const [, setFormData] = result.current
    act(() => setFormData({ name: 'Y' }))
    act(() => vi.advanceTimersByTime(500))
    expect(sessionStorage.getItem('cs:draft:skip-test')).toBeNull()
  })

  it('initializes nav state when initialNav provided', () => {
    const { result } = renderHook(() =>
      useFormPersist('cs:draft:nav-test', { x: 0 }, { initialNav: { currentIndex: 0, maxReached: 0 } })
    )
    const nav = result.current[3]
    expect(nav).toEqual({ currentIndex: 0, maxReached: 0 })
  })

  it('restores nav from sessionStorage when initialNav provided', () => {
    sessionStorage.setItem(
      'cs:draft:nav-restore',
      JSON.stringify({ __form: { x: 1 }, __nav: { currentIndex: 2, maxReached: 3 } })
    )
    const { result } = renderHook(() =>
      useFormPersist('cs:draft:nav-restore', { x: 0 }, { initialNav: { currentIndex: 0, maxReached: 0 } })
    )
    const nav = result.current[3]
    expect(nav.currentIndex).toBe(2)
    expect(nav.maxReached).toBe(3)
  })

  it('omitKeys excludes specified keys from persisted state', () => {
    const { result } = renderHook(() =>
      useFormPersist('cs:draft:omit-test', { name: '', password: '' }, { omitKeys: ['password'] })
    )
    const [, setFormData] = result.current
    act(() => setFormData({ name: 'Alice', password: 'secret123' }))
    act(() => vi.advanceTimersByTime(500))
    const stored = JSON.parse(sessionStorage.getItem('cs:draft:omit-test') || '{}')
    expect(stored.password).toBeUndefined()
    expect(stored.name).toBe('Alice')
  })
})
