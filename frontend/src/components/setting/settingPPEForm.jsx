import React, { useState, useEffect } from 'react'
import PageHeaderSetting from '@/components/shared/pageHeader/PageHeaderSetting'
import Footer from '@/components/shared/Footer'
import PageLoader from '@/components/shared/PageLoader'
import PerfectScrollbar from 'react-perfect-scrollbar'
import InputTopLabel from '@/components/shared/InputTopLabel'
import { apiGet, apiPatch } from '@/utils/api'
import topTostError from '@/utils/topTostError'

const SettingPPEForm = () => {
    const [settings, setSettings] = useState({
        alert_cooldown_frames: 90,
        violation_frames: 8,
        incident_dedup_seconds: 30,
        stage1_conf: 0.30,
        stage2_conf: 0.30,
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
                alert_cooldown_frames: data.alert_cooldown_frames,
                violation_frames: data.violation_frames,
                incident_dedup_seconds: data.incident_dedup_seconds,
                stage1_conf: data.stage1_conf,
                stage2_conf: data.stage2_conf,
            })
            setIsDirty(false)
        } catch (err) {
            topTostError('Failed to load PPE settings')
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
                alert_cooldown_frames: parseInt(settings.alert_cooldown_frames),
                violation_frames: parseInt(settings.violation_frames),
                incident_dedup_seconds: parseInt(settings.incident_dedup_seconds),
                stage1_conf: parseFloat(settings.stage1_conf),
                stage2_conf: parseFloat(settings.stage2_conf),
            })
            topTostError('PPE settings saved successfully!', 'success')
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
            alert_cooldown_frames: 90,
            violation_frames: 8,
            incident_dedup_seconds: 30,
            stage1_conf: 0.25,
            stage2_conf: 0.30,
        }))
        setIsDirty(true)
    }

    const handleProductionMode = () => {
        setSettings(prev => ({
            ...prev,
            alert_cooldown_frames: 90,
            violation_frames: 8,
            incident_dedup_seconds: 30,
            stage1_conf: 0.30,
            stage2_conf: 0.30,
        }))
        setIsDirty(true)
    }

    // Frame to seconds conversion @ 30fps
    const framesPerSec = 30
    const cooldownSeconds = (settings.alert_cooldown_frames / framesPerSec).toFixed(2)
    const violationSeconds = (settings.violation_frames / framesPerSec).toFixed(2)

    return (
        <div className="content-area">
            <PerfectScrollbar>
                <PageHeaderSetting />
                <div className="content-area-body">
                    <div className="card mb-0">
                        <div className="card-body">
                            {/* Header */}
                            <div className="mb-4">
                                <h5 className="mb-2">PPE Detection Settings</h5>
                                <p className="text-muted">
                                    Configure PPE detection sensitivity and alert behavior. Changes take effect immediately.
                                </p>
                            </div>

                            {loading ? (
                                <PageLoader />
                            ) : (
                                <>
                                    {/* Alert Cooldown */}
                                    <div className="mb-4">
                                        <label className="form-label fw-semibold">Alert Cooldown (Frames)</label>
                                        <input
                                            type="number"
                                            className="form-control"
                                            min="5"
                                            max="300"
                                            step="5"
                                            value={settings.alert_cooldown_frames}
                                            onChange={(e) =>
                                                handleChange('alert_cooldown_frames', parseInt(e.target.value) || '')
                                            }
                                        />
                                        <small className="text-muted d-block mt-2">
                                            <strong>Current:</strong> {cooldownSeconds} seconds @ 30fps (time between alerts for same person)
                                        </small>
                                        <div className="form-text">
                                            <strong>Stable demo:</strong> 90 frames (3s+) — keeps tracking smooth
                                            <br />
                                            <strong>Production:</strong> 90+ frames (3s+) — reduces alert spam
                                        </div>
                                    </div>

                                    {/* Violation Frames */}
                                    <div className="mb-4">
                                        <label className="form-label fw-semibold">Violation Confirmation Frames</label>
                                        <input
                                            type="number"
                                            className="form-control"
                                            min="3"
                                            max="30"
                                            step="1"
                                            value={settings.violation_frames}
                                            onChange={(e) =>
                                                handleChange('violation_frames', parseInt(e.target.value) || '')
                                            }
                                        />
                                        <small className="text-muted d-block mt-2">
                                            <strong>Current:</strong> {violationSeconds} seconds @ 30fps (frames of missing PPE before alert)
                                        </small>
                                        <div className="form-text">
                                            <strong>Stable demo:</strong> 8 frames — reduces flicker false positives
                                            <br />
                                            <strong>Production:</strong> 8-15 frames (0.3-0.5s) — reduces false positives
                                        </div>
                                    </div>

                                    {/* Incident Deduplication */}
                                    <div className="mb-4">
                                        <label className="form-label fw-semibold">Incident Deduplication (Seconds)</label>
                                        <input
                                            type="number"
                                            className="form-control"
                                            min="1"
                                            max="120"
                                            step="5"
                                            value={settings.incident_dedup_seconds}
                                            onChange={(e) =>
                                                handleChange('incident_dedup_seconds', parseInt(e.target.value) || '')
                                            }
                                        />
                                        <small className="text-muted d-block mt-2">
                                            Suppress duplicate violations from same person within this window
                                        </small>
                                        <div className="form-text">
                                            <strong>Stable demo:</strong> 30s — prevents duplicate spam
                                            <br />
                                            <strong>Production:</strong> 30s+ — prevent spam
                                        </div>
                                    </div>

                                    <hr className="my-4" />

                                    {/* Detection Thresholds */}
                                    <div className="mb-4">
                                        <h6 className="mb-3">Detection Thresholds</h6>

                                        <div className="mb-3">
                                            <label className="form-label fw-semibold">Stage 1 Confidence (Person Detection)</label>
                                            <input
                                                type="number"
                                                className="form-control"
                                                min="0.1"
                                                max="1.0"
                                                step="0.05"
                                                value={settings.stage1_conf}
                                                onChange={(e) =>
                                                    handleChange('stage1_conf', parseFloat(e.target.value) || '')
                                                }
                                            />
                                            <small className="text-muted d-block mt-2">
                                                How confident the model must be to detect a person (0.0-1.0)
                                            </small>
                                            <div className="form-text">
                                                Lower = more detections (slower, more false positives)
                                                <br />
                                                Higher = fewer detections (faster, may miss people)
                                            </div>
                                        </div>

                                        <div className="mb-3">
                                            <label className="form-label fw-semibold">Stage 2 Confidence (PPE Detection)</label>
                                            <input
                                                type="number"
                                                className="form-control"
                                                min="0.1"
                                                max="1.0"
                                                step="0.05"
                                                value={settings.stage2_conf}
                                                onChange={(e) =>
                                                    handleChange('stage2_conf', parseFloat(e.target.value) || '')
                                                }
                                            />
                                            <small className="text-muted d-block mt-2">
                                                How confident the model must be to detect helmet/vest (0.0-1.0)
                                            </small>
                                            <div className="form-text">
                                                Lower = more PPE detections (more false alarms)
                                                <br />
                                                Higher = stricter PPE detection (may miss actual PPE)
                                            </div>
                                        </div>
                                    </div>

                                    <hr className="my-4" />

                                    {/* Info Box */}
                                    <div className="alert alert-info">
                                        <strong>💡 Pro Tip:</strong> Use the preset buttons below to restore the stable demo or production PPE values.
                                    </div>

                                    {/* Action Buttons */}
                                    <div className="d-flex gap-2 flex-wrap">
                                        <button
                                            className="btn btn-warning"
                                            onClick={handleDemoMode}
                                            disabled={saving}
                                        >
                                            ⚡ Stable Demo Mode
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

export default SettingPPEForm
