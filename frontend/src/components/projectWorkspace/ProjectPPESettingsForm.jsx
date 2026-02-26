import React, { useState, useEffect } from 'react'
import { FiSave } from 'react-icons/fi'
import { apiGet, apiPatch } from '@/utils/api'
import PageLoader from '@/components/shared/PageLoader'
import topTostError from '@/utils/topTostError'

/**
 * Project PPE Detection Settings Form
 *
 * Per-project settings for PPE detection sensitivity and alert behavior.
 * Only Project Managers can access this.
 *
 * Settings:
 * - alert_cooldown_frames: Frames between alerts for same person
 * - violation_frames: Frames needed to confirm PPE violation
 * - incident_dedup_seconds: Time window to suppress duplicate alerts
 * - stage1_conf: Person detection confidence threshold
 * - stage2_conf: PPE detection confidence threshold
 */

const DEFAULTS = {
    alert_cooldown_frames: 90,
    violation_frames: 8,
    incident_dedup_seconds: 30,
    stage1_conf: 0.30,
    stage2_conf: 0.30,
}

const DEMO_PRESET = {
    alert_cooldown_frames: 90,
    violation_frames: 8,
    incident_dedup_seconds: 30,
    stage1_conf: 0.25,
    stage2_conf: 0.30,
}

const ProjectPPESettingsForm = ({ projectId }) => {
    const [settings, setSettings] = useState(DEFAULTS)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [isDirty, setIsDirty] = useState(false)

    useEffect(() => {
        if (projectId) {
            loadSettings()
        }
    }, [projectId])

    const loadSettings = async () => {
        try {
            setLoading(true)
            const data = await apiGet(`/projects/${projectId}/ml-config`)
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
            await apiPatch(`/projects/${projectId}/ml-config`, {
                alert_cooldown_frames: parseInt(settings.alert_cooldown_frames),
                violation_frames: parseInt(settings.violation_frames),
                incident_dedup_seconds: parseInt(settings.incident_dedup_seconds),
                stage1_conf: parseFloat(settings.stage1_conf),
                stage2_conf: parseFloat(settings.stage2_conf),
            })
            topTostError('PPE detection settings saved successfully!', 'success')
            setIsDirty(false)
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

    const handleDemoMode = async () => {
        setSaving(true)
        try {
            await apiPatch(`/projects/${projectId}/ml-config`, DEMO_PRESET)
            setSettings(DEMO_PRESET)
            setIsDirty(false)
            topTostError('Demo Mode applied', 'success')
        } catch (err) {
            topTostError(err.response?.data?.detail || 'Failed to apply demo mode')
        } finally {
            setSaving(false)
        }
    }

    const handleResetToDefaults = async () => {
        setSaving(true)
        try {
            await apiPatch(`/projects/${projectId}/ml-config`, DEFAULTS)
            setSettings(DEFAULTS)
            setIsDirty(false)
            topTostError('Settings reset', 'success')
        } catch (err) {
            topTostError(err.response?.data?.detail || 'Failed to reset settings')
        } finally {
            setSaving(false)
        }
    }

    return (
        <>
            <div className="mb-4">
                <h5 className="mb-2 fw-semibold">PPE Detection Settings</h5>
                <p className="text-muted fs-13 mb-0">
                    Configure PPE detection sensitivity and alert behavior for this project
                </p>
            </div>

            {loading ? (
                <PageLoader />
            ) : (
                <>
                    {/* Alert Cooldown */}
                    <div className="mb-4">
                        <label htmlFor="cooldown" className="form-label fw-semibold">
                            Alert Cooldown (Frames)
                        </label>
                        <input
                            id="cooldown"
                            type="text"
                            inputMode="numeric"
                            className="form-control"
                            value={settings.alert_cooldown_frames}
                            onChange={(e) =>
                                handleChange('alert_cooldown_frames', parseInt(e.target.value) || 0)
                            }
                        />
                    </div>

                    {/* Violation Frames */}
                    <div className="mb-4">
                        <label htmlFor="violation" className="form-label fw-semibold">
                            Violation Confirmation (Frames)
                        </label>
                        <input
                            id="violation"
                            type="text"
                            inputMode="numeric"
                            className="form-control"
                            value={settings.violation_frames}
                            onChange={(e) =>
                                handleChange('violation_frames', parseInt(e.target.value) || 1)
                            }
                        />
                    </div>

                    {/* Incident Deduplication */}
                    <div className="mb-5">
                        <label htmlFor="dedup" className="form-label fw-semibold">
                            Incident Deduplication (Seconds)
                        </label>
                        <input
                            id="dedup"
                            type="text"
                            inputMode="numeric"
                            className="form-control"
                            value={settings.incident_dedup_seconds}
                            onChange={(e) =>
                                handleChange('incident_dedup_seconds', parseInt(e.target.value) || 0)
                            }
                        />
                    </div>

                    <div className="d-flex align-items-center justify-content-between border-top pt-3 mt-4">
                        <div className="d-flex gap-2">
                            <button
                                type="button"
                                className="btn btn-success cs-btn-nohover"
                                onClick={handleDemoMode}
                                disabled={saving}
                            >
                                Demo Mode
                            </button>
                            <button
                                type="button"
                                className="btn btn-danger cs-btn-nohover"
                                onClick={handleResetToDefaults}
                                disabled={saving}
                            >
                                Reset
                            </button>
                        </div>
                        <div className="d-flex gap-2">
                            <button
                                type="button"
                                className="btn btn-outline-secondary"
                                onClick={handleReset}
                                disabled={saving}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="btn btn-primary"
                                onClick={handleSave}
                                disabled={saving || !isDirty}
                            >
                                <FiSave size={16} className="me-2" />
                                Save Changes
                            </button>
                        </div>
                    </div>
                </>
            )}
        </>
    )
}

export default ProjectPPESettingsForm
