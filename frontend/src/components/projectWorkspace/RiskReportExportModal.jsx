/**
 * RiskReportExportModal
 *
 * On-demand PDF export modal for the Risk Analytics dashboard.
 * Presets: Today, Yesterday, This Week, Last Week, This Month, Last Month, Full Project, Custom Range.
 * Generates PDF synchronously, auto-downloads on success.
 */
import React, { useState, useRef } from 'react'
import { FiDownload, FiCalendar, FiX, FiFileText, FiShield } from 'react-icons/fi'
import { STREAM_BASE } from '@/utils/api'
import topTostError from '@/utils/topTostError'

// ── Date helpers ──────────────────────────────────────────────────────────────
const startOfDay = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x }
const endOfDay   = (d) => { const x = new Date(d); x.setHours(23,59,59,999); return x }

function toISOString(d) { return new Date(d).toISOString() }

function formatDateInput(d) {
    const x = new Date(d)
    const pad = n => String(n).padStart(2, '0')
    return `${x.getFullYear()}-${pad(x.getMonth()+1)}-${pad(x.getDate())}`
}

const PRESETS = [
    {
        key: 'today',
        label: 'Today',
        range: () => ({ from: startOfDay(new Date()), to: endOfDay(new Date()) }),
    },
    {
        key: 'yesterday',
        label: 'Yesterday',
        range: () => {
            const d = new Date(); d.setDate(d.getDate() - 1)
            return { from: startOfDay(d), to: endOfDay(d) }
        },
    },
    {
        key: 'this_week',
        label: 'This Week',
        range: () => {
            const d = new Date()
            const monday = new Date(d)
            monday.setDate(d.getDate() - ((d.getDay() + 6) % 7))
            return { from: startOfDay(monday), to: endOfDay(new Date()) }
        },
    },
    {
        key: 'last_week',
        label: 'Last Week',
        range: () => {
            const d = new Date()
            const dayOfWeek = (d.getDay() + 6) % 7
            const lastMonday = new Date(d)
            lastMonday.setDate(d.getDate() - dayOfWeek - 7)
            const lastSunday = new Date(lastMonday)
            lastSunday.setDate(lastMonday.getDate() + 6)
            return { from: startOfDay(lastMonday), to: endOfDay(lastSunday) }
        },
    },
    {
        key: 'this_month',
        label: 'This Month',
        range: () => {
            const d = new Date()
            return { from: startOfDay(new Date(d.getFullYear(), d.getMonth(), 1)), to: endOfDay(new Date()) }
        },
    },
    {
        key: 'last_month',
        label: 'Last Month',
        range: () => {
            const d = new Date()
            const firstOfThisMonth = new Date(d.getFullYear(), d.getMonth(), 1)
            const lastOfLastMonth = new Date(firstOfThisMonth - 1)
            const firstOfLastMonth = new Date(lastOfLastMonth.getFullYear(), lastOfLastMonth.getMonth(), 1)
            return { from: startOfDay(firstOfLastMonth), to: endOfDay(lastOfLastMonth) }
        },
    },
    {
        key: 'custom',
        label: 'Custom Range',
        range: null,
    },
]

const MAX_RANGE_DAYS = 366

export default function RiskReportExportModal({ projectId, projectName = '', onClose }) {
    const [selectedPreset, setSelectedPreset] = useState('this_month')
    const [customFrom, setCustomFrom] = useState(formatDateInput(startOfDay(new Date())))
    const [customTo, setCustomTo]     = useState(formatDateInput(endOfDay(new Date())))
    const [loading, setLoading]       = useState(false)
    const [error, setError]           = useState('')
    const abortRef = useRef(null)

    function getDateRange() {
        if (selectedPreset !== 'custom') {
            const preset = PRESETS.find(p => p.key === selectedPreset)
            return preset?.range()
        }
        return {
            from: startOfDay(new Date(customFrom)),
            to:   endOfDay(new Date(customTo)),
        }
    }

    function validate() {
        const range = getDateRange()
        if (!range) return 'Please select a date range.'
        if (!range.from || !range.to) return 'Invalid date range.'
        if (isNaN(range.from.getTime()) || isNaN(range.to.getTime())) return 'Invalid dates. Please check your selection.'
        if (range.to <= range.from) return 'End date must be after start date.'
        const spanDays = (range.to - range.from) / (1000 * 60 * 60 * 24)
        if (spanDays > MAX_RANGE_DAYS) return `Date range cannot exceed ${MAX_RANGE_DAYS} days.`
        return null
    }

    async function handleGenerate() {
        const validationError = validate()
        if (validationError) { setError(validationError); return }
        setError('')
        setLoading(true)

        const range = getDateRange()
        const token = window.sessionStorage.getItem('access_token')

        try {
            const controller = new AbortController()
            abortRef.current = controller

            const res = await fetch(
                `http://localhost:8000/projects/${projectId}/reports/export`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
                    },
                    credentials: 'include',
                    body: JSON.stringify({
                        start_date:  toISOString(range.from),
                        end_date:    toISOString(range.to),
                        report_type: 'risk',
                    }),
                    signal: controller.signal,
                }
            )

            if (!res.ok) {
                let detail = 'Report generation failed.'
                try { const data = await res.json(); detail = data?.detail || detail } catch (_) {}
                throw new Error(detail)
            }

            const blob = await res.blob()
            const url  = window.URL.createObjectURL(blob)
            const link = document.createElement('a')

            const presetLabel = selectedPreset !== 'custom'
                ? PRESETS.find(p => p.key === selectedPreset)?.label?.replace(/\s+/g, '_')
                : `${customFrom}_to_${customTo}`
            const projectSlug = (projectName || `project_${projectId}`).replace(/\s+/g, '_').slice(0, 30)
            link.href = url
            link.download = `Risk_Analysis_Report_${projectSlug}_${presetLabel}.pdf`
            document.body.appendChild(link)
            link.click()
            document.body.removeChild(link)
            window.URL.revokeObjectURL(url)

            window.dispatchEvent(new Event('cs:report-status-changed'))
            topTostError('Risk Analysis Report downloaded successfully.', 'success')
            onClose?.()

        } catch (err) {
            if (err.name === 'AbortError') return
            const msg = err.message || 'Report generation failed. Please try again.'
            setError(msg)
            topTostError(msg)
        } finally {
            setLoading(false)
        }
    }

    function handleClose() {
        if (loading) abortRef.current?.abort()
        onClose?.()
    }

    return (
        <>
            <div className="modal-backdrop fade show" style={{ zIndex: 1040 }} onClick={!loading ? handleClose : undefined} />
            <div className="modal fade show d-block" tabIndex="-1" style={{ zIndex: 1050 }} role="dialog" aria-modal="true" aria-labelledby="risk-report-modal-title">
                <div className="modal-dialog modal-dialog-centered" style={{ maxWidth: 520 }}>
                    <div className="modal-content border border-secondary" style={{ background: '#0d1424' }}>

                        {/* Header */}
                        <div className="modal-header border-secondary px-4 py-3">
                            <div className="d-flex align-items-center gap-2">
                                <FiShield size={18} className="text-danger" />
                                <h5 className="modal-title mb-0 fw-bold text-white" id="risk-report-modal-title">
                                    Export Risk Analysis Report
                                </h5>
                            </div>
                            <button type="button" className="btn-close btn-close-white" onClick={handleClose} disabled={loading} aria-label="Close" />
                        </div>

                        {/* Body */}
                        <div className="modal-body px-4 py-4">

                            {/* Report type */}
                            <div className="mb-4">
                                <label className="form-label text-secondary fw-semibold" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Report Type</label>
                                <div className="d-flex align-items-center gap-2 p-2 rounded" style={{ background: '#080e1c', border: '1px solid #1c2847' }}>
                                    <FiShield size={15} className="text-danger" />
                                    <span className="text-white fw-semibold" style={{ fontSize: 13 }}>Risk Analysis Report</span>
                                    <span className="badge bg-danger bg-opacity-25 text-danger ms-auto" style={{ fontSize: 10 }}>PDF</span>
                                </div>
                                <div className="mt-2 px-1" style={{ fontSize: 11, color: '#6b7280' }}>
                                    Includes overall risk scores, zone-by-zone breakdown, open incidents (PPE, Workforce, Activity), top risk factors, weather impact, and recommendations.
                                </div>
                            </div>

                            {/* Date range presets */}
                            <div className="mb-3">
                                <label className="form-label text-secondary fw-semibold" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Date Range</label>
                                <div className="d-flex flex-wrap gap-2">
                                    {PRESETS.map(p => (
                                        <button
                                            key={p.key}
                                            type="button"
                                            className={`btn btn-sm px-3 py-1 ${selectedPreset === p.key ? 'btn-primary' : 'btn-outline-secondary'}`}
                                            style={{ fontSize: 12, borderRadius: 6 }}
                                            onClick={() => { setSelectedPreset(p.key); setError('') }}
                                            disabled={loading}
                                        >
                                            {p.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Custom range pickers */}
                            {selectedPreset === 'custom' && (
                                <div className="row g-3 mb-3">
                                    <div className="col-6">
                                        <label className="form-label text-secondary" style={{ fontSize: 11 }}>From</label>
                                        <input type="date" className="form-control form-control-sm"
                                            style={{ background: '#080e1c', borderColor: '#1c2847', color: '#e8edf8' }}
                                            value={customFrom} max={customTo}
                                            onChange={e => { setCustomFrom(e.target.value); setError('') }}
                                            disabled={loading} />
                                    </div>
                                    <div className="col-6">
                                        <label className="form-label text-secondary" style={{ fontSize: 11 }}>To</label>
                                        <input type="date" className="form-control form-control-sm"
                                            style={{ background: '#080e1c', borderColor: '#1c2847', color: '#e8edf8' }}
                                            value={customTo} min={customFrom} max={formatDateInput(new Date())}
                                            onChange={e => { setCustomTo(e.target.value); setError('') }}
                                            disabled={loading} />
                                    </div>
                                </div>
                            )}

                            {/* Range preview */}
                            {selectedPreset !== 'custom' && (() => {
                                const r = PRESETS.find(p => p.key === selectedPreset)?.range?.()
                                if (!r) return null
                                const fmt = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                                return (
                                    <div className="d-flex align-items-center gap-2 mb-3 px-3 py-2 rounded"
                                         style={{ background: '#080e1c', border: '1px solid #1c2847', fontSize: 12 }}>
                                        <FiCalendar size={13} className="text-primary" />
                                        <span className="text-secondary">{fmt(r.from)}</span>
                                        <span className="text-secondary mx-1">→</span>
                                        <span className="text-secondary">{fmt(r.to)}</span>
                                    </div>
                                )
                            })()}

                            {/* Error */}
                            {error && (
                                <div className="alert alert-danger py-2 px-3 mb-3" style={{ fontSize: 12, borderRadius: 8 }}>{error}</div>
                            )}

                            {/* Loading */}
                            {loading && (
                                <div className="d-flex align-items-center gap-2 mb-3 px-3 py-2 rounded"
                                     style={{ background: 'rgba(220,53,69,0.08)', border: '1px solid rgba(220,53,69,0.2)', fontSize: 12 }}>
                                    <div className="spinner-border spinner-border-sm text-danger" style={{ width: 14, height: 14 }} />
                                    <span className="text-danger">Generating your report, please wait…</span>
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="modal-footer border-secondary px-4 py-3 gap-2">
                            <button type="button" className="btn btn-outline-secondary" onClick={handleClose} disabled={loading} style={{ fontSize: 13 }}>Cancel</button>
                            <button type="button" className="btn btn-danger d-flex align-items-center gap-2" onClick={handleGenerate} disabled={loading} style={{ fontSize: 13 }}>
                                {loading
                                    ? <><div className="spinner-border spinner-border-sm" style={{ width: 14, height: 14 }} /> Generating…</>
                                    : <><FiDownload size={14} /> Generate &amp; Download</>
                                }
                            </button>
                        </div>

                    </div>
                </div>
            </div>
        </>
    )
}
