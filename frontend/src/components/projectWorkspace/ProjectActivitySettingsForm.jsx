import { useState, useEffect, useCallback } from 'react'
import { FiSave } from 'react-icons/fi'
import PageLoader from '@/components/shared/PageLoader'
import { apiGet, apiPatch, apiDelete } from '@/utils/api'
import topTostError from '@/utils/topTostError'

const SENSITIVITY_OPTIONS = [
    { value: 'low',        label: 'Low — alert less frequently (1200s cooldown)' },
    { value: 'medium',     label: 'Medium — balanced (600s cooldown)' },
    { value: 'high',       label: 'High — alert often (300s cooldown)' },
    { value: 'ultra_high', label: 'Ultra High — every event (no cooldown)' },
]

const DEMO_PRESET = {
    idle_threshold_seconds:         30,
    alert_idle_minutes:             1,
    low_activity_threshold:         70,
    movement_thresh_px:             2.0,
    stationary_thresh_secs:         5,
    alert_sensitivity:              'ultra_high',
    optical_flow_weight:            0.0,
    zone_idle_confirm_cycles:       1,
    low_activity_sustained_minutes: 2,
}

const DEFAULTS = {
    idle_threshold_seconds:         300,
    alert_idle_minutes:             15,
    low_activity_threshold:         30,
    movement_thresh_px:             6.0,
    stationary_thresh_secs:         20,
    alert_sensitivity:              'medium',
    optical_flow_weight:            0.2,
    zone_idle_confirm_cycles:       3,
    low_activity_sustained_minutes: 30,
}

export default function ProjectActivitySettingsForm({ projectId }) {
    const [form,     setForm]     = useState(DEFAULTS)
    const [loading,  setLoading]  = useState(true)
    const [saving,   setSaving]   = useState(false)
    const [resetting, setResetting] = useState(false)
    const [isDirty, setIsDirty] = useState(false)

    const load = useCallback(() => {
        setLoading(true)
        apiGet(`/projects/${projectId}/activity/settings`)
            .then(rows => {
                const projectLevel = rows.find(r => r.camera_id == null)
                if (projectLevel) {
                    setForm({
                        idle_threshold_seconds:         projectLevel.idle_threshold_seconds         ?? DEFAULTS.idle_threshold_seconds,
                        alert_idle_minutes:             projectLevel.alert_idle_minutes             ?? DEFAULTS.alert_idle_minutes,
                        low_activity_threshold:         projectLevel.low_activity_threshold         ?? DEFAULTS.low_activity_threshold,
                        movement_thresh_px:             projectLevel.movement_thresh_px             ?? DEFAULTS.movement_thresh_px,
                        stationary_thresh_secs:         projectLevel.stationary_thresh_secs         ?? DEFAULTS.stationary_thresh_secs,
                        alert_sensitivity:              projectLevel.alert_sensitivity              ?? DEFAULTS.alert_sensitivity,
                        optical_flow_weight:            projectLevel.optical_flow_weight            ?? DEFAULTS.optical_flow_weight,
                        zone_idle_confirm_cycles:       projectLevel.zone_idle_confirm_cycles       ?? DEFAULTS.zone_idle_confirm_cycles,
                        low_activity_sustained_minutes: projectLevel.low_activity_sustained_minutes ?? DEFAULTS.low_activity_sustained_minutes,
                    })
                    setIsDirty(false)
                } else {
                    setForm(DEFAULTS)
                    setIsDirty(false)
                }
            })
            .catch(() => topTostError('Failed to load activity settings'))
            .finally(() => setLoading(false))
    }, [projectId])

    useEffect(() => { load() }, [load])

    const handleChange = (key, val) => {
        setForm(prev => ({ ...prev, [key]: val }))
        setIsDirty(true)
    }

    const handleDemo = async () => {
        setForm(DEMO_PRESET)
        setSaving(true)
        try {
            await apiPatch(`/projects/${projectId}/activity/settings`, DEMO_PRESET)
            topTostError('Demo Mode active — alerts fire in ~30–60 seconds', 'success')
            setIsDirty(false)
        } catch {
            topTostError('Failed to apply demo preset')
        } finally {
            setSaving(false)
        }
    }

    const handleReset = async () => {
        setResetting(true)
        try {
            await apiDelete(`/projects/${projectId}/activity/settings`)
            topTostError('Settings reset to defaults', 'success')
            load()
            setIsDirty(false)
        } catch {
            topTostError('Failed to reset settings')
        } finally {
            setResetting(false)
        }
    }

    const handleSave = async () => {
        setSaving(true)
        try {
            await apiPatch(`/projects/${projectId}/activity/settings`, form)
            topTostError('Settings saved', 'success')
            setIsDirty(false)
        } catch {
            topTostError('Failed to save settings')
        } finally {
            setSaving(false)
        }
    }

    if (loading) return <PageLoader minHeight={150} />

    return (
        <div>
            <div className="mb-4">
                <h5 className="mb-2 fw-semibold">Activity Monitoring Settings</h5>
                <p className="text-muted fs-13 mb-0">
                    Configure idle/low-activity tuning and alert sensitivity for this project.
                </p>
            </div>

            <div className="mb-5">
                <h6 className="mb-4 fw-semibold">Idle & Low Activity</h6>
                <div className="row g-3">
                    <div className="col-md-6">
                        <label className="form-label">Idle Threshold (Seconds)</label>
                        <input
                            type="text"
                            inputMode="numeric"
                            className="form-control"
                            value={form.idle_threshold_seconds}
                            onChange={e => handleChange('idle_threshold_seconds', parseInt(e.target.value) || DEFAULTS.idle_threshold_seconds)}
                        />
                        <small className="form-text text-muted">Seconds before zone is marked IDLE. Default: 300</small>
                    </div>

                    <div className="col-md-6">
                        <label className="form-label">Alert Idle Minutes</label>
                        <input
                            type="text"
                            inputMode="numeric"
                            className="form-control"
                            value={form.alert_idle_minutes}
                            onChange={e => handleChange('alert_idle_minutes', parseInt(e.target.value) || DEFAULTS.alert_idle_minutes)}
                        />
                        <small className="form-text text-muted">Fire alert after this many idle minutes. Default: 15</small>
                    </div>

                    <div className="col-md-6">
                        <label className="form-label">Low Activity Threshold (%)</label>
                        <input
                            type="text"
                            inputMode="numeric"
                            className="form-control"
                            value={form.low_activity_threshold}
                            onChange={e => handleChange('low_activity_threshold', parseInt(e.target.value) || DEFAULTS.low_activity_threshold)}
                        />
                        <small className="form-text text-muted">Below this % moving workers = LOW_ACTIVITY. Default: 30</small>
                    </div>

                    <div className="col-md-6">
                        <label className="form-label">Low Activity Sustained Minutes</label>
                        <input
                            type="text"
                            inputMode="numeric"
                            className="form-control"
                            value={form.low_activity_sustained_minutes}
                            onChange={e => handleChange('low_activity_sustained_minutes', parseInt(e.target.value) || DEFAULTS.low_activity_sustained_minutes)}
                        />
                        <small className="form-text text-muted">Minutes of low activity before alert fires. Default: 30</small>
                    </div>
                </div>
            </div>

            <div className="mb-5">
                <h6 className="mb-4 fw-semibold">Motion Tuning</h6>
                <div className="row g-3">
                    <div className="col-md-6">
                        <label className="form-label">Movement Threshold (px)</label>
                        <input
                            type="text"
                            inputMode="decimal"
                            className="form-control"
                            value={form.movement_thresh_px}
                            onChange={e => handleChange('movement_thresh_px', parseFloat(e.target.value) || DEFAULTS.movement_thresh_px)}
                        />
                        <small className="form-text text-muted">Pixel displacement per frame to count as MOVING. Default: 6.0</small>
                    </div>

                    <div className="col-md-6">
                        <label className="form-label">Stationary Threshold (Seconds)</label>
                        <input
                            type="text"
                            inputMode="numeric"
                            className="form-control"
                            value={form.stationary_thresh_secs}
                            onChange={e => handleChange('stationary_thresh_secs', parseInt(e.target.value) || DEFAULTS.stationary_thresh_secs)}
                        />
                        <small className="form-text text-muted">Seconds below movement threshold to count as STATIONARY. Default: 20</small>
                    </div>

                    <div className="col-md-6">
                        <label className="form-label">Optical Flow Weight (0–1)</label>
                        <input
                            type="text"
                            inputMode="decimal"
                            className="form-control"
                            value={form.optical_flow_weight}
                            onChange={e => handleChange('optical_flow_weight', parseFloat(e.target.value) || 0)}
                        />
                        <small className="form-text text-muted">Set to 0 to disable (faster). Default: 0.2</small>
                    </div>
                </div>
            </div>

            <div className="mb-5">
                <h6 className="mb-4 fw-semibold">Alerts</h6>
                <div className="row g-3">
                    <div className="col-md-6">
                        <label className="form-label">Alert Sensitivity</label>
                        <select
                            className="form-select"
                            value={form.alert_sensitivity}
                            onChange={e => handleChange('alert_sensitivity', e.target.value)}
                        >
                            {SENSITIVITY_OPTIONS.map(o => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                        </select>
                        <small className="form-text text-muted">Controls minimum time between repeated alerts</small>
                    </div>

                    <div className="col-md-6">
                        <label className="form-label">Zone Idle Confirm Cycles</label>
                        <input
                            type="text"
                            inputMode="numeric"
                            className="form-control"
                            value={form.zone_idle_confirm_cycles}
                            onChange={e => handleChange('zone_idle_confirm_cycles', parseInt(e.target.value) || DEFAULTS.zone_idle_confirm_cycles)}
                        />
                        <small className="form-text text-muted">Cycles zone must stay IDLE before alert fires. Default: 3</small>
                    </div>
                </div>
            </div>

            <div className="d-flex align-items-center justify-content-between border-top pt-3">
                <div className="d-flex gap-2">
                    <button
                        type="button"
                        className="btn btn-success cs-btn-nohover"
                        onClick={handleDemo}
                        disabled={saving || resetting}
                    >
                        Demo Mode
                    </button>
                    <button
                        type="button"
                        className="btn btn-danger cs-btn-nohover"
                        onClick={handleReset}
                        disabled={saving || resetting}
                    >
                        Reset
                    </button>
                </div>
                <div className="d-flex gap-2">
                    <button
                        type="button"
                        className="btn btn-outline-secondary"
                        onClick={load}
                        disabled={saving || resetting}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="btn btn-primary"
                        onClick={handleSave}
                        disabled={!isDirty || saving || resetting}
                    >
                        <FiSave size={16} className="me-2" />
                        Save Changes
                    </button>
                </div>
            </div>
        </div>
    )
}
