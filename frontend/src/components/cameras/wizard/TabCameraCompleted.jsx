import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FiCheckCircle } from 'react-icons/fi'
import { apiPatch } from '@/utils/api'
import { broadcastRefresh } from '@/utils/broadcast'
import { parseApiError } from '@/utils/errorHandler'
import topTost from '@/utils/topTost'
import topTostError from '@/utils/topTostError'
import { sanitizeCameraIdentity, validateCameraIdentity } from '@/utils/cameraValidation'

const TabCameraCompleted = ({ formData, cameraId, completed, setCompleted, setErrors }) => {
    const navigate = useNavigate()
    const [saving, setSaving] = useState(false)

    const handleSave = async () => {
        // Validate required fields before submit
        const identityErrors = validateCameraIdentity(formData)
        if (Object.keys(identityErrors).length > 0) {
            setErrors?.(identityErrors)
            return
        }
        if (!formData.site_id) {
            topTostError('Site is required')
            return
        }
        const identity = sanitizeCameraIdentity(formData)

        // Validate at least one credential
        const hasRtsp = formData.rtsp_url && formData.rtsp_url.trim()
        const hasRtspSub = formData.rtsp_url_sub && formData.rtsp_url_sub.trim()
        const hasOnvif = formData.onvif_supported && formData.onvif_host && formData.onvif_host.trim()
        if (!hasRtsp && !hasRtspSub && !hasOnvif) {
            topTostError('At least one credential (RTSP URL or ONVIF host) is required')
            return
        }

        // Validate ONVIF port if provided
        if (formData.onvif_supported && formData.onvif_port) {
            const port = Number(formData.onvif_port)
            if (port < 1 || port > 65535) {
                topTostError('ONVIF port must be between 1 and 65535')
                return
            }
        }

        setSaving(true)
        try {
            await apiPatch(`/admin/cameras/${cameraId}`, {
                name: identity.name,
                site_id: Number(formData.site_id),
                vendor: identity.vendor || null,
                model: identity.model || null,
                serial_number: identity.serial_number || null,
                onvif_supported: formData.onvif_supported,
            })

            const credPayload = {
                rtsp_url: formData.rtsp_url.trim() || null,
                rtsp_url_sub: formData.rtsp_url_sub.trim() || null,
                username: formData.username.trim() || null,
                onvif_host: formData.onvif_supported ? (formData.onvif_host.trim() || null) : null,
                onvif_port: formData.onvif_supported ? (Number(formData.onvif_port) || 80) : null,
                transport_preference: formData.transport || 'tcp',
            }
            if (formData.password) credPayload.password = formData.password
            await apiPatch(`/admin/cameras/${cameraId}/credentials`, credPayload)

            topTost('Camera updated successfully')
            setCompleted(true)
            broadcastRefresh('cs:cameras-stats-refresh')
            broadcastRefresh('cs:project-cameras-refresh')
            broadcastRefresh('cs:project-zones-refresh')
            setTimeout(() => navigate('/admin/cameras/list'), 1500)
        } catch (err) {
            // Check for conflict (409) - another user edited meanwhile
            if (err?.response?.status === 409) {
                topTostError('Camera was modified by another user. Please refresh and try again.')
            } else {
                const msg = parseApiError(err)
                topTostError(msg)
            }
        } finally {
            setSaving(false)
        }
    }

    if (completed) {
        return (
            <div className="text-center py-5">
                <div style={{ width: '80px', height: '80px', margin: '0 auto 20px', background: 'var(--bs-success)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <FiCheckCircle size={40} color="white" />
                </div>
                <h4 className="text-success mb-3">Camera Updated</h4>
                <p className="text-muted mb-4">All changes have been saved successfully.</p>
                <button className="btn btn-primary" onClick={() => navigate('/admin/cameras/list')}>
                    Return to Camera Registry
                </button>
            </div>
        )
    }

    return (
        <div className="row g-3">
            <div className="col-12">
                <h5 className="mb-3">Review Your Changes</h5>
                <div className="card bg-light p-3">
                    <div className="row">
                        <div className="col-md-6">
                            <p className="fs-12 text-muted">Name</p>
                            <p className="fw-semibold">{formData.name}</p>
                        </div>
                        <div className="col-md-6">
                            <p className="fs-12 text-muted">Vendor</p>
                            <p className="fw-semibold">{formData.vendor || 'Not set'}</p>
                        </div>
                        <div className="col-md-6">
                            <p className="fs-12 text-muted">Model</p>
                            <p className="fw-semibold">{formData.model || 'Not set'}</p>
                        </div>
                        <div className="col-md-6">
                            <p className="fs-12 text-muted">Record URL</p>
                            <p className="fw-semibold text-truncate" title={formData.rtsp_url}>{formData.rtsp_url || 'Not set'}</p>
                        </div>
                        <div className="col-md-6">
                            <p className="fs-12 text-muted">ONVIF</p>
                            <p className="fw-semibold">{formData.onvif_supported ? 'Enabled' : 'Disabled'}</p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="col-12 pt-3">
                <button
                    className="btn btn-success btn-lg"
                    onClick={handleSave}
                    disabled={saving}
                >
                    {saving ? 'Saving...' : 'Save Camera Changes'}
                </button>
            </div>
        </div>
    )
}

export default TabCameraCompleted
