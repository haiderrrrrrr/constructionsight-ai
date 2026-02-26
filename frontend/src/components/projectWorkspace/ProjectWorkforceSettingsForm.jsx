import React, { useState, useEffect } from 'react'
import { FiSave } from 'react-icons/fi'
import PageLoader from '@/components/shared/PageLoader'
import { apiGet, apiPatch, apiDelete } from '@/utils/api'
import topTostError from '@/utils/topTostError'

const DEFAULTS = {
    required_workers:             2,
    max_workers:                  15,
    idle_alert_threshold:         60,
    alert_sensitivity:            'medium',
    understaffed_confirm_samples: 30,
    overload_confirm_seconds:     180,
}

const DEMO_DEFAULTS = {
    required_workers:             2,
    max_workers:                  4,
    idle_alert_threshold:         60,
    alert_sensitivity:            'ultra_high',
    understaffed_confirm_samples: 3,
    overload_confirm_seconds:     10,
}

export default function ProjectWorkforceSettingsForm({ projectId }) {
    const [form,    setForm]    = useState(DEFAULTS)
    const [loading, setLoading] = useState(true)
    const [saving,  setSaving]  = useState(false)
    const [resetting, setResetting] = useState(false)
    const [demoing,   setDemoing]   = useState(false)
    const [isDirty, setIsDirty] = useState(false)

    const load = async () => {
        setLoading(true)
        try {
            const rows = await apiGet(`/projects/${projectId}/workforce/settings`)
            const row  = rows.find(r => r.camera_id === null)
            if (row) {
                setForm({
                    required_workers:             row.required_workers             ?? DEFAULTS.required_workers,
                    max_workers:                  row.max_workers                  ?? DEFAULTS.max_workers,
                    idle_alert_threshold:         row.idle_alert_threshold         ?? DEFAULTS.idle_alert_threshold,
                    alert_sensitivity:            row.alert_sensitivity            ?? DEFAULTS.alert_sensitivity,
                    understaffed_confirm_samples: row.understaffed_confirm_samples ?? DEFAULTS.understaffed_confirm_samples,
                    overload_confirm_seconds:     row.overload_confirm_seconds     ?? DEFAULTS.overload_confirm_seconds,
                })
            } else {
                setForm(DEFAULTS)
            }
            setIsDirty(false)
        } catch {
            topTostError('Failed to load workforce settings')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { if (projectId) load() }, [projectId])

    const set = (k, v) => { setForm(prev => ({ ...prev, [k]: v })); setIsDirty(true) }

    const save = async () => {
        setSaving(true)
        try {
            await apiPatch(`/projects/${projectId}/workforce/settings`, form)
            topTostError('Workforce settings saved', 'success')
            setIsDirty(false)
            window.dispatchEvent(new CustomEvent('wf:settings-updated'))
        } catch {
            topTostError('Failed to save workforce settings')
        } finally {
            setSaving(false)
        }
    }

    const loadDemoSettings = async () => {
        setDemoing(true)
        try {
            await apiPatch(`/projects/${projectId}/workforce/settings`, DEMO_DEFAULTS)
            setForm(DEMO_DEFAULTS)
            setIsDirty(false)
            topTostError('Demo settings applied', 'success')
            window.dispatchEvent(new CustomEvent('wf:settings-updated'))
        } catch {
            topTostError('Failed to apply demo settings')
        } finally {
            setDemoing(false)
        }
    }

    const resetToDefaults = async () => {
        setResetting(true)
        try {
            await apiDelete(`/projects/${projectId}/workforce/settings`)
            setForm(DEFAULTS)
            setIsDirty(false)
            topTostError('Settings reset to defaults', 'success')
        } catch {
            topTostError('Failed to reset settings')
        } finally {
            setResetting(false)
        }
    }

    if (loading) return <PageLoader minHeight={200} />

    return (
        <div>
            <div className="mb-4">
                <h5 className="mb-2 fw-semibold">Workforce Analytics Settings</h5>
                <p className="text-muted fs-13 mb-0">
                    Configure staffing thresholds and alert sensitivity for this project.
                </p>
            </div>

            <div className="mb-5">
                <h6 className="mb-4 fw-semibold">Staffing Thresholds</h6>
                <div className="row g-3">
                    <div className="col-md-6">
                        <label className="form-label">Minimum Staff Required</label>
                        <input
                            type="text"
                            inputMode="numeric"
                            className="form-control"
                            value={form.required_workers}
                            onChange={e => set('required_workers', parseInt(e.target.value) || 0)}
                        />
                        <small className="form-text text-muted">Workers below this triggers Zone Understaffed alert</small>
                    </div>
                    <div className="col-md-6">
                        <label className="form-label">Zone Capacity (Max Workers)</label>
                        <input
                            type="text"
                            inputMode="numeric"
                            className="form-control"
                            value={form.max_workers}
                            onChange={e => set('max_workers', parseInt(e.target.value) || 0)}
                        />
                        <small className="form-text text-muted">Workers above this triggers Zone Overloaded alert</small>
                    </div>
                </div>
            </div>

            <div className="mb-5">
                <h6 className="mb-4 fw-semibold">Alert Tuning</h6>
                <div className="row g-3">
                    <div className="col-md-6">
                        <label className="form-label">Idle Alert Threshold (%)</label>
                        <input
                            type="text"
                            inputMode="numeric"
                            className="form-control"
                            value={form.idle_alert_threshold}
                            onChange={e => set('idle_alert_threshold', parseInt(e.target.value) || 0)}
                        />
                        <small className="form-text text-muted">Alert fires when this % of workers are idle for 5+ minutes</small>
                    </div>
                    <div className="col-md-6">
                        <label className="form-label">Alert Sensitivity</label>
                        <select
                            className="form-select"
                            value={form.alert_sensitivity}
                            onChange={e => set('alert_sensitivity', e.target.value)}
                        >
                            <option value="low">Low — alert every 20 min</option>
                            <option value="medium">Medium — alert every 10 min</option>
                            <option value="high">High — alert every 1 min</option>
                            <option value="ultra_high">Ultra High — alert every 10 sec</option>
                        </select>
                        <small className="form-text text-muted">Controls how frequently the same alert can re-fire</small>
                    </div>
                </div>
            </div>

            <div className="mb-5">
                <h6 className="mb-4 fw-semibold">Alert Confirm Timing</h6>
                <div className="row g-3">
                    <div className="col-md-6">
                        <label className="form-label">Understaffed Confirm Samples</label>
                        <input
                            type="text"
                            inputMode="numeric"
                            className="form-control"
                            value={form.understaffed_confirm_samples}
                            onChange={e => set('understaffed_confirm_samples', parseInt(e.target.value) || 0)}
                        />
                        <small className="form-text text-muted">Metric cycles below minimum before alert fires (~30s each). Set to 1–3 for testing.</small>
                    </div>
                    <div className="col-md-6">
                        <label className="form-label">Overload Confirm Seconds</label>
                        <input
                            type="text"
                            inputMode="numeric"
                            className="form-control"
                            value={form.overload_confirm_seconds}
                            onChange={e => set('overload_confirm_seconds', parseInt(e.target.value) || 0)}
                        />
                        <small className="form-text text-muted">Seconds congestion must persist before alert fires. Set to 5–10 for testing.</small>
                    </div>
                </div>
            </div>

            <div className="d-flex align-items-center justify-content-between border-top pt-3">
                <div className="d-flex gap-2">
                    <button
                        type="button"
                        className="btn btn-success cs-btn-nohover"
                        onClick={loadDemoSettings}
                        disabled={saving || resetting || demoing}
                    >
                        Demo Mode
                    </button>
                    <button
                        type="button"
                        className="btn btn-danger cs-btn-nohover"
                        onClick={resetToDefaults}
                        disabled={saving || resetting || demoing}
                    >
                        Reset
                    </button>
                </div>
                <div className="d-flex gap-2">
                    <button
                        type="button"
                        className="btn btn-outline-secondary"
                        onClick={load}
                        disabled={saving || resetting || demoing}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="btn btn-primary"
                        onClick={save}
                        disabled={!isDirty || saving || resetting || demoing}
                    >
                        <FiSave size={16} className="me-2" />
                        Save Changes
                    </button>
                </div>
            </div>
        </div>
    )
}
