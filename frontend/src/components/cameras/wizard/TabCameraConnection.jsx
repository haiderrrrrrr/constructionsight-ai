import React, { useState } from 'react'
import { FiAlertCircle, FiEye, FiEyeOff } from 'react-icons/fi'

const TabCameraConnection = ({ formData, setFormData, errors }) => {
    const [showPwd, setShowPwd] = useState(false)
    const set = (field) => (e) => setFormData(p => ({ ...p, [field]: e.target.value }))

    const FieldError = ({ field }) => errors[field] ? (
        <span className="field-error d-flex align-items-center gap-1" style={{ fontSize: '0.72rem', color: '#ef4444' }}>
            <FiAlertCircle size={11} />{errors[field]}
        </span>
    ) : null

    return (
        <div className="row g-3">
            <div className="col-12">
                <label className="fs-11 fw-semibold text-muted text-uppercase mb-2 d-block">Record URL (RTSP) *</label>
                <input
                    type="text"
                    className={`form-control ${errors.rtsp_url ? 'is-invalid' : ''}`}
                    placeholder="rtsp://192.168.1.100:554/stream1"
                    value={formData.rtsp_url}
                    onChange={set('rtsp_url')}
                />
                <small className="d-block text-muted mt-1">High-resolution stream for recording</small>
                <FieldError field="rtsp_url" />
            </div>

            <div className="col-12">
                <label className="fs-11 fw-semibold text-muted text-uppercase mb-2 d-block">Live URL (RTSP)</label>
                <input
                    type="text"
                    className="form-control"
                    placeholder="rtsp://192.168.1.100:554/stream2"
                    value={formData.rtsp_url_sub}
                    onChange={set('rtsp_url_sub')}
                />
                <small className="d-block text-muted mt-1">Low-resolution stream for live view</small>
            </div>

            <div className="col-12">
                <label className="fs-11 fw-semibold text-muted text-uppercase mb-2 d-block">Username</label>
                <input
                    type="text"
                    className="form-control"
                    placeholder="admin"
                    value={formData.username}
                    onChange={set('username')}
                />
            </div>

            <div className="col-12">
                <label className="fs-11 fw-semibold text-muted text-uppercase mb-2 d-block">Password</label>
                <div className="input-group">
                    <input
                        type={showPwd ? 'text' : 'password'}
                        className="form-control"
                        placeholder={formData.has_stored_password ? 'Password already set' : 'Leave blank to keep current'}
                        value={formData.password}
                        onChange={set('password')}
                    />
                    <button className="btn btn-outline-secondary" onClick={() => setShowPwd(!showPwd)}>
                        {showPwd ? <FiEyeOff size={16} /> : <FiEye size={16} />}
                    </button>
                </div>
            </div>

            <div className="col-md-6">
                <label className="fs-11 fw-semibold text-muted text-uppercase mb-2 d-block">Transport</label>
                <select className="form-control" value={formData.transport} onChange={set('transport')}>
                    <option value="tcp">TCP</option>
                    <option value="udp">UDP</option>
                </select>
            </div>

            <div className="col-md-6">
                <div className="form-check mt-4">
                    <input
                        type="checkbox"
                        className="form-check-input"
                        id="onvif_check"
                        checked={formData.onvif_supported}
                        onChange={(e) => setFormData(p => ({ ...p, onvif_supported: e.target.checked }))}
                    />
                    <label className="form-check-label" htmlFor="onvif_check">
                        ONVIF Supported
                    </label>
                </div>
            </div>
        </div>
    )
}

export default TabCameraConnection
