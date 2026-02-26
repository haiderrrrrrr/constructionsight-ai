import React, { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { apiGet, apiPatch } from '@/utils/api'
import PageLoader from '@/components/shared/PageLoader'
import topTostError from '@/utils/topTostError'

/**
 * Project-Specific PPE Settings Modal
 *
 * Each project can have its own detection sensitivity settings:
 * - alert_cooldown_frames: Time between alerts per person
 * - violation_frames: Frames to confirm violation
 * - incident_dedup_seconds: Suppress duplicate alerts window
 * - stage1_conf: Person detection confidence
 * - stage2_conf: PPE detection confidence
 *
 * Settings are stored per-project and only affect that project.
 */

export default function ProjectPPESettingsModal({ show, onClose }) {
  const { projectId } = useParams()
  const [settings, setSettings] = useState({
    alert_cooldown_frames: 90,
    violation_frames: 8,
    incident_dedup_seconds: 30,
    stage1_conf: 0.30,
    stage2_conf: 0.30,
  })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)

  useEffect(() => {
    if (show && projectId) {
      loadSettings()
    }
  }, [show, projectId])

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
      topTostError('Failed to load project PPE settings')
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
      topTostError('PPE settings updated for this project!', 'success')
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

  if (!show) return null

  return (
    <div className="modal d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="modal-dialog modal-lg">
        <div className="modal-content">
          <div className="modal-header bg-primary text-white">
            <h5 className="modal-title">PPE Detection Settings (This Project)</h5>
            <button type="button" className="btn-close btn-close-white" onClick={onClose}></button>
          </div>

          <div className="modal-body">
            {loading ? (
              <PageLoader minHeight={150} />
            ) : (
              <div className="row g-3">
                {/* Alert Cooldown */}
                <div className="col-md-6">
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
                    <strong>Current:</strong> {cooldownSeconds}s @ 30fps
                  </small>
                  <div className="form-text">
                    Stable demo: 90 | Production: 90+
                  </div>
                </div>

                {/* Violation Frames */}
                <div className="col-md-6">
                  <label className="form-label fw-semibold">Violation Confirmation (Frames)</label>
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
                    <strong>Current:</strong> {violationSeconds}s @ 30fps
                  </small>
                  <div className="form-text">
                    Stable demo: 8 | Production: 8-15
                  </div>
                </div>

                {/* Incident Dedup */}
                <div className="col-md-6">
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
                  <div className="form-text mt-2">
                    Stable demo: 30 | Production: 30+
                  </div>
                </div>

                {/* Stage 1 Confidence */}
                <div className="col-md-6">
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
                  <small className="text-muted d-block mt-2">Range: 0.0 to 1.0</small>
                </div>

                {/* Stage 2 Confidence */}
                <div className="col-md-6">
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
                  <small className="text-muted d-block mt-2">Range: 0.0 to 1.0</small>
                </div>

                {/* Info */}
                <div className="col-12">
                  <div className="alert alert-info mb-0">
                    <strong>ℹ️ Note:</strong> These settings apply only to this project. Each project can have different sensitivity levels.
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-warning"
              onClick={handleDemoMode}
              disabled={saving}
            >
              ⚡ Stable Demo
            </button>
            <button
              type="button"
              className="btn btn-info"
              onClick={handleProductionMode}
              disabled={saving}
            >
              🏢 Production
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={handleReset}
              disabled={saving || !isDirty}
            >
              Discard
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={saving}
            >
              Close
            </button>
            <button
              type="button"
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
      </div>
    </div>
  )
}
