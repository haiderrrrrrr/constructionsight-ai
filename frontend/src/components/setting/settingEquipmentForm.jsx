import React, { useState, useEffect } from 'react'
import PageHeaderSetting from '@/components/shared/pageHeader/PageHeaderSetting'
import Footer from '@/components/shared/Footer'
import PageLoader from '@/components/shared/PageLoader'
import PerfectScrollbar from 'react-perfect-scrollbar'
import { apiGet, apiPatch } from '@/utils/api'
import topTostError from '@/utils/topTostError'

const SettingEquipmentForm = () => {
    const [settings, setSettings] = useState({
        equipment_stage1_conf: 0.35,
        equipment_movement_thresh: 3.0,
        equipment_idle_confirm_secs: 30,
        equipment_lost_frames: 25,
        equipment_snapshot_interval_secs: 60,
        equipment_alert_cooldown_secs: 600,
        equipment_groundingdino_prompt: 'crane, excavator, concrete truck, dump truck, bulldozer, forklift, compactor',
    })
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [isDirty, setIsDirty] = useState(false)

    useEffect(() => {
        loadSettings()
    }, [])

    const loadSettings = async () => {
        try {
            setLoading(true)
            const data = await apiGet('/admin/ml-config')
            setSettings({
                equipment_stage1_conf:             data.equipment_stage1_conf            ?? 0.35,
                equipment_movement_thresh:         data.equipment_movement_thresh        ?? 3.0,
                equipment_idle_confirm_secs:       data.equipment_idle_confirm_secs      ?? 30,
                equipment_lost_frames:             data.equipment_lost_frames            ?? 25,
                equipment_snapshot_interval_secs:  data.equipment_snapshot_interval_secs ?? 60,
                equipment_alert_cooldown_secs:     data.equipment_alert_cooldown_secs    ?? 600,
                equipment_groundingdino_prompt:    data.equipment_groundingdino_prompt   ?? 'crane, excavator, concrete truck, dump truck, bulldozer, forklift, compactor',
            })
            setIsDirty(false)
        } catch (err) {
            topTostError('Failed to load Equipment settings')
            console.error(err)
        } finally {
            setLoading(false)
        }
    }

    const handleChange = (field, value) => {
        setSettings(prev => ({ ...prev, [field]: value }))
        setIsDirty(true)
    }

    const handleSave = async () => {
        setSaving(true)
        try {
            await apiPatch('/admin/ml-config', {
                equipment_stage1_conf:             parseFloat(settings.equipment_stage1_conf),
                equipment_movement_thresh:         parseFloat(settings.equipment_movement_thresh),
                equipment_idle_confirm_secs:       parseInt(settings.equipment_idle_confirm_secs),
                equipment_lost_frames:             parseInt(settings.equipment_lost_frames),
                equipment_snapshot_interval_secs:  parseInt(settings.equipment_snapshot_interval_secs),
                equipment_alert_cooldown_secs:     parseInt(settings.equipment_alert_cooldown_secs),
                equipment_groundingdino_prompt:    settings.equipment_groundingdino_prompt,
            })
            topTostError('Equipment settings saved successfully!', 'success')
            setIsDirty(false)
            loadSettings()
        } catch (err) {
            topTostError(err.response?.data?.detail || 'Failed to save settings')
        } finally {
            setSaving(false)
        }
    }

    const handleReset = () => {
        loadSettings()
        setIsDirty(false)
    }

    const handleDemoMode = () => {
        setSettings(prev => ({
            ...prev,
            equipment_idle_confirm_secs:   10,
            equipment_alert_cooldown_secs: 60,
            equipment_movement_thresh:     1.5,
        }))
        setIsDirty(true)
    }

    const handleProductionMode = () => {
        setSettings(prev => ({
            ...prev,
            equipment_idle_confirm_secs:   30,
            equipment_alert_cooldown_secs: 600,
            equipment_movement_thresh:     3.0,
        }))
        setIsDirty(true)
    }

    return (
        <div className="content-area">
            <PerfectScrollbar>
                <PageHeaderSetting />
                <div className="content-area-body">
                    <div className="card mb-0">
                        <div className="card-body">
                            <div className="mb-4">
                                <h5 className="mb-2">Equipment Detection Settings</h5>
                                <p className="text-muted">
                                    Configure Grounding DINO equipment detection sensitivity and alert behavior. Changes take effect on the next detection cycle.
                                </p>
                            </div>

                            {loading ? (
                                <PageLoader />
                            ) : (
                                <>
                                    {/* Grounding DINO Prompt */}
                                    <div className="mb-4">
                                        <label className="form-label fw-semibold">Grounding DINO Detection Prompt</label>
                                        <textarea
                                            className="form-control"
                                            rows={3}
                                            value={settings.equipment_groundingdino_prompt}
                                            onChange={(e) => handleChange('equipment_groundingdino_prompt', e.target.value)}
                                        />
                                        <small className="text-muted d-block mt-2">
                                            Comma-separated list of equipment types for natural language detection. The model detects any object matching these terms.
                                        </small>
                                        <div className="form-text">
                                            Example: <code>crane, excavator, concrete truck, dump truck, bulldozer, forklift, compactor</code>
                                        </div>
                                    </div>

                                    {/* Stage 1 Confidence */}
                                    <div className="mb-4">
                                        <label className="form-label fw-semibold">Detection Confidence Threshold</label>
                                        <input
                                            type="number"
                                            className="form-control"
                                            min="0.1"
                                            max="1.0"
                                            step="0.05"
                                            value={settings.equipment_stage1_conf}
                                            onChange={(e) => handleChange('equipment_stage1_conf', parseFloat(e.target.value) || '')}
                                        />
                                        <small className="text-muted d-block mt-2">
                                            Grounding DINO confidence threshold (0.0–1.0). Lower = more detections, higher = stricter matching.
                                        </small>
                                        <div className="form-text">
                                            <strong>Recommended:</strong> 0.30–0.45 for construction site conditions
                                        </div>
                                    </div>

                                    <hr className="my-4" />
                                    <h6 className="mb-3">State Machine Thresholds</h6>

                                    {/* Movement Threshold */}
                                    <div className="mb-4">
                                        <label className="form-label fw-semibold">Movement Threshold (px)</label>
                                        <input
                                            type="number"
                                            className="form-control"
                                            min="0.5"
                                            max="20.0"
                                            step="0.5"
                                            value={settings.equipment_movement_thresh}
                                            onChange={(e) => handleChange('equipment_movement_thresh', parseFloat(e.target.value) || '')}
                                        />
                                        <small className="text-muted d-block mt-2">
                                            Average displacement (pixels) required to classify equipment as ACTIVE. Per-class overrides apply for slow equipment (e.g., crane = 1.5px).
                                        </small>
                                        <div className="form-text">
                                            <strong>Default:</strong> 3.0px — reduces false ACTIVE detections from camera vibration
                                        </div>
                                    </div>

                                    {/* Idle Confirm Seconds */}
                                    <div className="mb-4">
                                        <label className="form-label fw-semibold">Idle Confirmation Delay (Seconds)</label>
                                        <input
                                            type="number"
                                            className="form-control"
                                            min="5"
                                            max="300"
                                            step="5"
                                            value={settings.equipment_idle_confirm_secs}
                                            onChange={(e) => handleChange('equipment_idle_confirm_secs', parseInt(e.target.value) || '')}
                                        />
                                        <small className="text-muted d-block mt-2">
                                            Seconds of below-threshold movement before equipment transitions to IDLE state.
                                        </small>
                                        <div className="form-text">
                                            <strong>Demo:</strong> 10s — fast transitions &nbsp;|&nbsp; <strong>Production:</strong> 30s — avoids brief pauses triggering IDLE
                                        </div>
                                    </div>

                                    {/* Lost Frames */}
                                    <div className="mb-4">
                                        <label className="form-label fw-semibold">Lost Track Frames</label>
                                        <input
                                            type="number"
                                            className="form-control"
                                            min="5"
                                            max="120"
                                            step="5"
                                            value={settings.equipment_lost_frames}
                                            onChange={(e) => handleChange('equipment_lost_frames', parseInt(e.target.value) || '')}
                                        />
                                        <small className="text-muted d-block mt-2">
                                            Frames without a detection before a track is marked EXITED.
                                        </small>
                                        <div className="form-text">
                                            <strong>Recommended:</strong> 25 frames @ 30fps ≈ 0.8s grace period
                                        </div>
                                    </div>

                                    <hr className="my-4" />
                                    <h6 className="mb-3">Alert Settings</h6>

                                    {/* Alert Cooldown */}
                                    <div className="mb-4">
                                        <label className="form-label fw-semibold">Alert Cooldown (Seconds)</label>
                                        <input
                                            type="number"
                                            className="form-control"
                                            min="10"
                                            max="3600"
                                            step="30"
                                            value={settings.equipment_alert_cooldown_secs}
                                            onChange={(e) => handleChange('equipment_alert_cooldown_secs', parseInt(e.target.value) || '')}
                                        />
                                        <small className="text-muted d-block mt-2">
                                            Minimum seconds between repeat alerts of the same type for the same equipment track.
                                        </small>
                                        <div className="form-text">
                                            <strong>Demo:</strong> 60s &nbsp;|&nbsp; <strong>Production:</strong> 600s (10 min)
                                        </div>
                                    </div>

                                    {/* Snapshot Interval */}
                                    <div className="mb-4">
                                        <label className="form-label fw-semibold">Snapshot Interval (Seconds)</label>
                                        <input
                                            type="number"
                                            className="form-control"
                                            min="10"
                                            max="600"
                                            step="10"
                                            value={settings.equipment_snapshot_interval_secs}
                                            onChange={(e) => handleChange('equipment_snapshot_interval_secs', parseInt(e.target.value) || '')}
                                        />
                                        <small className="text-muted d-block mt-2">
                                            How often equipment state snapshots are written to the database for historical trend data.
                                        </small>
                                        <div className="form-text">
                                            <strong>Recommended:</strong> 60s — 1-minute resolution in trend charts
                                        </div>
                                    </div>

                                    <hr className="my-4" />

                                    <div className="alert alert-info">
                                        <strong>💡 Pro Tip:</strong> Use the preset buttons below to quickly switch between demo and production modes. Zone-level thresholds (idle duration, overuse hours) are configured per-camera in the project settings.
                                    </div>

                                    <div className="d-flex gap-2 flex-wrap">
                                        <button
                                            className="btn btn-warning"
                                            onClick={handleDemoMode}
                                            disabled={saving}
                                        >
                                            ⚡ Demo Mode (Fast)
                                        </button>
                                        <button
                                            className="btn btn-secondary"
                                            onClick={handleProductionMode}
                                            disabled={saving}
                                        >
                                            🏢 Production Mode (Balanced)
                                        </button>
                                        <div className="ms-auto">
                                            <button
                                                className="btn btn-outline-secondary me-2"
                                                onClick={handleReset}
                                                disabled={saving || !isDirty}
                                            >
                                                Discard Changes
                                            </button>
                                            <button
                                                className="btn btn-primary"
                                                onClick={handleSave}
                                                disabled={saving || !isDirty || loading}
                                            >
                                                {saving ? (
                                                    <>
                                                        <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                                                        Saving...
                                                    </>
                                                ) : (
                                                    'Save Settings'
                                                )}
                                            </button>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
                <Footer />
            </PerfectScrollbar>
        </div>
    )
}

export default SettingEquipmentForm
