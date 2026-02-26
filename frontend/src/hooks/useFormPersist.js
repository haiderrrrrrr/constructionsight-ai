import { useState, useEffect, useRef, useCallback } from 'react'

/**
 * Persists form state (and optional wizard navigation) to sessionStorage so
 * page refreshes don't wipe in-progress forms.
 *
 * Usage (form only):
 *   const [formData, setFormData, clearDraft] = useFormPersist('cs:draft:project-create', initialState)
 *
 * Usage (form + wizard tab position):
 *   const [formData, setFormData, clearDraft, nav, setNav, hasDraft] =
 *       useFormPersist('cs:draft:project-create', initialState, { initialNav: { currentIndex: 0, maxReached: 0 } })
 *
 * - State is restored from sessionStorage on mount (if a draft exists)
 * - Writes are debounced 400ms so rapid keystrokes don't hammer storage
 * - Call clearDraft() on successful submit or discard — suppresses the next
 *   debounced write so the emptied form isn't immediately re-saved
 * - Pass `skip: true` in options to disable persistence (e.g. when editing existing records)
 * - hasDraft: true only if sessionStorage had data at the moment of mount
 */
export function useFormPersist(storageKey, initialState, options = {}) {
    const { skip = false, initialNav = null, omitKeys = [] } = options

    const debounceTimer = useRef(null)
    const skipRef = useRef(skip)
    skipRef.current = skip
    // When clearDraft() is called we suppress the next debounced write so the
    // freshly-reset form state isn't immediately persisted back to storage.
    const suppressNextWrite = useRef(false)

    // Read once at mount; stored in a ref so hasDraft never changes after mount
    const hasDraftRef = useRef(false)

    const [formData, setFormDataRaw] = useState(() => {
        if (skip) return initialState
        try {
            const saved = sessionStorage.getItem(storageKey)
            if (saved) {
                const parsed = JSON.parse(saved)
                hasDraftRef.current = true
                const restored = parsed.__form ?? parsed
                return { ...initialState, ...restored }
            }
        } catch { /* corrupt — ignore */ }
        return initialState
    })

    const [nav, setNavRaw] = useState(() => {
        if (skip || !initialNav) return initialNav
        try {
            const saved = sessionStorage.getItem(storageKey)
            if (saved) {
                const parsed = JSON.parse(saved)
                if (parsed?.__nav) return { ...initialNav, ...parsed.__nav }
            }
        } catch { /* ignore */ }
        return initialNav
    })

    // Keep latest nav in a ref so the debounced write always has the current value
    const navRef = useRef(nav)
    navRef.current = nav

    // Persist on every formData or nav change (debounced)
    useEffect(() => {
        if (skipRef.current) return
        clearTimeout(debounceTimer.current)
        debounceTimer.current = setTimeout(() => {
            if (suppressNextWrite.current) {
                suppressNextWrite.current = false
                return
            }
            try {
                const sanitize = (obj) => {
                    if (!obj || omitKeys.length === 0) return obj
                    const next = { ...obj }
                    omitKeys.forEach(k => { delete next[k] })
                    return next
                }
                const entry = initialNav !== null
                    ? { __form: sanitize(formData), __nav: navRef.current }
                    : sanitize(formData)
                sessionStorage.setItem(storageKey, JSON.stringify(entry))
            } catch { /* storage quota exceeded — silently fail */ }
        }, 400)
        return () => clearTimeout(debounceTimer.current)
    }, [formData, nav, storageKey]) // eslint-disable-line react-hooks/exhaustive-deps

    const setNav = useCallback((value) => {
        setNavRaw(value)
    }, [])

    const clearDraft = useCallback(() => {
        clearTimeout(debounceTimer.current)
        suppressNextWrite.current = true
        try {
            sessionStorage.removeItem(storageKey)
        } catch { /* ignore */ }
    }, [storageKey])

    return [formData, setFormDataRaw, clearDraft, nav, setNav, hasDraftRef.current]
}
