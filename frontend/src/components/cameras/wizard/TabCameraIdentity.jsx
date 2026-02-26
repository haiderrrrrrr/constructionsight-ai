import React from 'react'
import { FiAlertCircle } from 'react-icons/fi'

const TabCameraIdentity = ({ formData, setFormData, sites, errors }) => {
    const set = (field) => (e) => {
        setFormData(p => ({ ...p, [field]: e.target.value }))
    }

    const FieldError = ({ field }) => errors[field] ? (
        <span className="field-error d-flex align-items-center gap-1" style={{ fontSize: '0.72rem', color: '#ef4444' }}>
            <FiAlertCircle size={11} />{errors[field]}
        </span>
    ) : null

    return (
        <div className="row g-3">
            <div className="col-12">
                <label className="fs-11 fw-semibold text-muted text-uppercase mb-2 d-block">Camera Name *</label>
                <input
                    type="text"
                    className={`form-control ${errors.name ? 'is-invalid' : ''}`}
                    placeholder="e.g., Front Gate Camera"
                    value={formData.name}
                    onChange={set('name')}
                />
                <FieldError field="name" />
            </div>

            <div className="col-12">
                <label className="fs-11 fw-semibold text-muted text-uppercase mb-2 d-block">Project *</label>
                <select
                    className={`form-control ${errors.site_id ? 'is-invalid' : ''}`}
                    value={formData.site_id}
                    onChange={set('site_id')}
                >
                    <option value="">Select a project</option>
                    {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <FieldError field="site_id" />
            </div>

            <div className="col-md-6">
                <label className="fs-11 fw-semibold text-muted text-uppercase mb-2 d-block">Vendor</label>
                <input
                    type="text"
                    className={`form-control ${errors.vendor ? 'is-invalid' : ''}`}
                    placeholder="e.g., Hikvision"
                    value={formData.vendor}
                    onChange={set('vendor')}
                />
                <FieldError field="vendor" />
            </div>

            <div className="col-md-6">
                <label className="fs-11 fw-semibold text-muted text-uppercase mb-2 d-block">Model</label>
                <input
                    type="text"
                    className={`form-control ${errors.model ? 'is-invalid' : ''}`}
                    placeholder="e.g., DS-2CD2143G0-I"
                    value={formData.model}
                    onChange={set('model')}
                />
                <FieldError field="model" />
            </div>

            <div className="col-12">
                <label className="fs-11 fw-semibold text-muted text-uppercase mb-2 d-block">Serial Number</label>
                <input
                    type="text"
                    className={`form-control ${errors.serial_number ? 'is-invalid' : ''}`}
                    placeholder="Optional"
                    value={formData.serial_number}
                    onChange={set('serial_number')}
                />
                <FieldError field="serial_number" />
            </div>
        </div>
    )
}

export default TabCameraIdentity
