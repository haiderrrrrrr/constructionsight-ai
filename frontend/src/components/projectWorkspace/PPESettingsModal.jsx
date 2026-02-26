import React, { useState, useEffect } from 'react'
import { apiGet, apiPatch } from '@/utils/api'
import PageLoader from '@/components/shared/PageLoader'
import topTostError from '@/utils/topTostError'

/**
 * PPE Demo Settings Modal
 *
 * Allows quick adjustment of ML config for demo purposes:
 * - alert_cooldown_frames: How many frames between alerts per person
 * - violation_frames: How many frames of violation before triggering alert
 * - incident_dedup_seconds: Incident deduplication window
 *
 * Demo preset keeps the same stable tracking values used by the live PPE
 * pipeline, so testing does not disable smoothing or ReID.
 */

export default function PPESettingsModal({ show, onClose }) {
  const [settings, setSettings] = useState({
    alert_cooldown_frames: 90,
    violation_frames: 8,
    incident_dedup_seconds: 30,
  })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // Load current settings on mount
  useEffect(() => {
    if (show) {
      loadSettings()
    }
  }, [show])

  const loadSettings = async () => {
    setLoading(true)
    try {
      const data = await apiGet('/admin/ml-config')
      setSettings({
        alert_cooldown_frames: data.alert_cooldown_frames,
        violation_frames: data.violation_frames,
        incident_dedup_seconds: data.incident_dedup_seconds,
      })
    } catch (err) {
      topTostError('Failed to load ML settings')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await apiPatch('/admin/ml-config', settings)
      topTostError('ML settings updated! Changes take effect immediately.', 'success')
      onClose()
    } catch (err) {
      topTostError(err.response?.data?.detail || 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    setSettings({
      alert_cooldown_frames: 90,
      violation_frames: 8,
      incident_dedup_seconds: 30,
    })
  }

  const handleDemoMode = () => {
    setSettings({
      alert_cooldown_frames: 90,
      violation_frames: 8,
      incident_dedup_seconds: 30,
    })
  }

  if (!show) return null

  // Frame to seconds @ 30fps
  const framesPerSec = 30
  const cooldownSeconds = (settings.alert_cooldown_frames / framesPerSec).toFixed(2)
  const violationSeconds = (settings.violation_frames / framesPerSec).toFixed(2)

  return (
    <div className="modal d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="modal-dialog modal-lg">
        <div className="modal-content">
          <div className="modal-header bg-primary text-white">
            <h5 className="modal-title">PPE Detection Settings</h5>
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
                      setSettings({ ...settings, alert_cooldown_frames: parseInt(e.target.value) })
                    }
                  />
                  <small className="text-muted">
                    Frames between alerts per person: <strong>{cooldownSeconds}s @ 30fps</strong>
                  </small>
                  <div className="form-text mt-1">
                    <strong>Stable demo:</strong> 90 frames (3s+) — keeps tracking smooth
                    <br />
                    <strong>Production:</strong> 90+ frames (3s+) — reduces spam
                  </div>
                </div>

                {/* Violation Frames */}
                <div className="col-md-6">
                  <label className="form-label fw-semibold">Violation Frames</label>
                  <input
                    type="number"
                    className="form-control"
                    min="3"
                    max="30"
                    step="1"
                    value={settings.violation_frames}
                    onChange={(e) =>
                      setSettings({ ...settings, violation_frames: parseInt(e.target.value) })
                    }
                  />
                  <small className="text-muted">
                    Consecutive frames needed to trigger alert: <strong>{violationSeconds}s @ 30fps</strong>
                  </small>
                  <div className="form-text mt-1">
                    <strong>Stable demo:</strong> 8 frames — reduces flicker false positives
                    <br />
                    <strong>Production:</strong> 8-15 frames (0.3-0.5s) — reduces false positives
                  </div>
                </div>

                {/* Incident Dedup */}
                <div className="col-md-6">
                  <label className="form-label fw-semibold">Incident Dedup (Seconds)</label>
                  <input
                    type="number"
                    className="form-control"
                    min="1"
                    max="120"
                    step="5"
                    value={settings.incident_dedup_seconds}
                    onChange={(e) =>
                      setSettings({ ...settings, incident_dedup_seconds: parseInt(e.target.value) })
                    }
                  />
                  <small className="text-muted">
                    Suppress duplicate violations from same person within this window
                  </small>
                  <div className="form-text mt-1">
                    <strong>Stable demo:</strong> 30s — prevents duplicate spam
                    <br />
                    <strong>Production:</strong> 30s+ — prevent spam
                  </div>
                </div>

                {/* Info Box */}
                <div className="col-12">
                  <div className="alert alert-info">
                    <strong>💡 Demo Tip:</strong> Click "Stable Demo" below to restore the tuned PPE values.
                    This keeps ReID/tracking behavior consistent with live detection.
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
              className="btn btn-secondary"
              onClick={handleReset}
              disabled={saving}
            >
              Reset to Defaults
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving || loading}
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
