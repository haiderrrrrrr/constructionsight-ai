import React from 'react'
import { FiAlertCircle } from 'react-icons/fi'

const TabCameraOnvif = ({ formData, setFormData, errors }) => {
    const set = (field) => (e) => setFormData(p => ({ ...p, [field]: e.target.value }))

    const FieldError = ({ field }) => errors[field] ? (
        <span className="field-error d-flex align-items-center gap-1" style={{ fontSize: '0.72rem', color: '#ef4444' }}>
            <FiAlertCircle size={11} />{errors[field]}
        </span>
    ) : null

    if (!formData.onvif_supported) {
        return (
            <div className="alert alert-info">
                <p>ONVIF is disabled. Enable it on the Connection tab to configure ONVIF streams.</p>
            </div>
        )
    }

    return (
        <div className="row g-3">
            <div className="col-12">
                <label className="fs-11 fw-semibold text-muted text-uppercase mb-2 d-block">ONVIF Host / IP *</label>
                <input
                    type="text"
                    className={`form-control ${errors.onvif_host ? 'is-invalid' : ''}`}
                    placeholder="192.168.1.100"
                    value={formData.onvif_host}
                    onChange={set('onvif_host')}
                />
                <FieldError field="onvif_host" />
            </div>

            <div className="col-md-6">
                <label className="fs-11 fw-semibold text-muted text-uppercase mb-2 d-block">ONVIF Port</label>
                <input
                    type="number"
                    className={`form-control ${errors.onvif_port ? 'is-invalid' : ''}`}
                    placeholder="80"
                    min="1"
                    max="65535"
                    value={formData.onvif_port}
                    onChange={set('onvif_port')}
                />
                <FieldError field="onvif_port" />
            </div>

            <div className="col-md-6">
                <div className="alert alert-light border border-secondary fs-12 mt-4">
                    Use port 80 for HTTP or 8080 for alternate configurations
                </div>
            </div>

            <div className="col-12 mt-3">
                <p className="text-muted fs-12">
                    ONVIF profile URLs will be fetched automatically when you return to the connection settings.
                    Ensure the device is reachable and credentials are correct.
                </p>
            </div>
        </div>
    )
}

export default TabCameraOnvif
