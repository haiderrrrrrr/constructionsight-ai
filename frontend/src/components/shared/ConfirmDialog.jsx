import React, { useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { FiAlertTriangle, FiArchive, FiRefreshCw, FiTrash2, FiX } from 'react-icons/fi'

const VARIANTS = {
    delete:    { icon: FiTrash2,    btnClass: 'btn-danger',  confirmLabel: 'Delete',  tone: 'danger' },
    danger:    { icon: FiTrash2,    btnClass: 'btn-danger',  confirmLabel: 'Confirm', tone: 'danger' },
    archive:   { icon: FiArchive,   btnClass: 'btn-warning', confirmLabel: 'Archive', tone: 'warning' },
    unarchive: { icon: FiRefreshCw, btnClass: 'btn-success', confirmLabel: 'Restore', tone: 'success' },
    warning:   { icon: FiAlertTriangle, btnClass: 'btn-warning', confirmLabel: 'Confirm', tone: 'warning' },
}

const ConfirmDialog = ({
    open,
    variant = 'warning',
    title,
    message,
    confirmLabel,
    cancelLabel = 'Cancel',
    loading = false,
    onConfirm,
    onClose,
}) => {
    const panelRef = useRef(null)
    const v = useMemo(() => VARIANTS[variant] || VARIANTS.warning, [variant])

    useEffect(() => {
        if (!open) return
        const prev = document.activeElement
        const t = setTimeout(() => panelRef.current?.focus(), 0)
        return () => { clearTimeout(t); if (prev && prev.focus) prev.focus() }
    }, [open])

    useEffect(() => {
        if (!open) return
        const onKeyDown = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault()
                if (!loading) onClose?.()
            }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [open, loading, onClose])

    if (!open) return null

    const Icon = v.icon
    const canClose = !loading
    const tone = v.tone || 'warning'
    const toneStyle = {
        danger:  { bg: 'rgba(239,68,68,0.14)', fg: '#ef4444' },
        warning: { bg: 'rgba(245,158,11,0.16)', fg: '#f59e0b' },
        success: { bg: 'rgba(34,197,94,0.16)', fg: '#22c55e' },
        info:    { bg: 'rgba(6,182,212,0.16)', fg: '#06b6d4' },
    }[tone]

    return createPortal(
        <>
            <style>{`
                .cs-confirm-backdrop { background: rgba(0,0,0,0.45); backdrop-filter: blur(2px); }
                .cs-confirm-panel { background: var(--bs-card-bg, var(--bs-body-bg)); border: 1px solid var(--bs-border-color); }
                html.app-skin-dark .cs-confirm-panel { background: #0b1220; border-color: rgba(255,255,255,0.10); }
                html.app-skin-dark .cs-confirm-title { color: rgba(255,255,255,0.92) !important; }
                html.app-skin-dark .cs-confirm-message { color: rgba(255,255,255,0.62) !important; }
                html.app-skin-dark .cs-confirm-close { color: rgba(255,255,255,0.65) !important; }
            `}</style>
            <div
                className="cs-confirm-backdrop"
                role="dialog"
                aria-modal="true"
                aria-label={title || 'Confirmation'}
                style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 9999,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 16,
                }}
                onMouseDown={() => { if (canClose) onClose?.() }}
            >
                <div
                    ref={panelRef}
                    className="cs-confirm-panel"
                    tabIndex={-1}
                    onMouseDown={(e) => e.stopPropagation()}
                    style={{
                        borderRadius: 14,
                        padding: 24,
                        maxWidth: 460,
                        width: '100%',
                        boxShadow: '0 16px 60px rgba(0,0,0,0.25)',
                        outline: 'none',
                    }}
                >
                    <div className="d-flex justify-content-end">
                        <button
                            type="button"
                            className="border-0 bg-transparent p-0 cs-confirm-close"
                            onClick={() => canClose && onClose?.()}
                            disabled={!canClose}
                            style={{ lineHeight: 1 }}
                        >
                            <FiX size={18} />
                        </button>
                    </div>

                    <div className="text-center" style={{ padding: '6px 6px 2px' }}>
                        <div
                            className="d-inline-flex align-items-center justify-content-center rounded-circle mb-3"
                            style={{ width: 56, height: 56, background: toneStyle.bg, color: toneStyle.fg }}
                        >
                            <Icon size={22} />
                        </div>
                        <h5 className="fw-bold mb-1 cs-confirm-title" style={{ color: 'var(--bs-heading-color)' }}>{title}</h5>
                        <p className="text-muted fs-13 fw-semibold mb-0 cs-confirm-message" style={{ lineHeight: 1.55 }}>{message}</p>
                    </div>

                    <div className="d-flex gap-2 mt-4">
                        <button
                            type="button"
                            className="btn btn-light-brand flex-fill"
                            onClick={() => canClose && onClose?.()}
                            disabled={!canClose}
                        >
                            {cancelLabel}
                        </button>
                        <button
                            type="button"
                            className={`btn ${v.btnClass} flex-fill`}
                            onClick={onConfirm}
                            disabled={loading}
                        >
                            {loading ? <span className="spinner-border spinner-border-sm me-2" role="status" /> : null}
                            {confirmLabel || v.confirmLabel}
                        </button>
                    </div>
                </div>
            </div>
        </>,
        document.body
    )
}

export default ConfirmDialog
