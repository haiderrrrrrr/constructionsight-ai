import React, { useState, useEffect } from 'react'
import { FiTag } from 'react-icons/fi'
import { SelectDropdown } from '@/components/shared/Dropdown'
import { apiPost, apiPatch } from '@/utils/api'
import { broadcastRefresh } from '@/utils/broadcast'
import topTostError from '@/utils/topTostError'
import { sanitizeProjectText, validateHumanText } from '@/utils/projectValidation'

const LABEL = 'fs-11 fw-semibold text-muted text-uppercase mb-1'
const LABEL_STYLE = { letterSpacing: '0.06em' }
const MAX_DESC_WORDS = 50
const countWords = (s) => s.trim() === '' ? 0 : s.trim().split(/\s+/).length

// zone = null → create mode, zone = object → edit mode
const ZoneFormModal = ({ projectId, zone, onSuccess, onClose }) => {
    const isEdit = !!zone
    const [name, setName] = useState('')
    const [type, setType] = useState('')
    const [description, setDescription] = useState('')
    const [fieldErrors, setFieldErrors] = useState({})
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        if (zone) {
            setName(zone.name || '')
            setType(zone.zone_type || '')
            setDescription(zone.description || '')
        } else {
            setName('')
            setType('')
            setDescription('')
        }
        setFieldErrors({})
    }, [zone])

    const handleClose = () => {
        if (!saving) onClose()
    }

    const handleSubmit = async (e) => {
        e.preventDefault()
        const errs = {}
        const nameErr = validateHumanText(name, 'Zone name', { min: 1, max: 200 })
        if (nameErr) errs.name = nameErr
        const descriptionErr = validateHumanText(description, 'Description', {
            required: false,
            min: 5,
            max: 500,
            multiline: true,
        })
        if (descriptionErr) errs.description = descriptionErr
        if (countWords(description) > MAX_DESC_WORDS) {
            errs.description = `Description must be ${MAX_DESC_WORDS} words or fewer`
        }
        setFieldErrors(errs)
        if (Object.keys(errs).length) {
            return
        }
        const cleanName = sanitizeProjectText(name)
        const cleanDescription = sanitizeProjectText(description, { multiline: true })
        setSaving(true)
        setFieldErrors({})
        try {
            const payload = {
                name: cleanName,
                zone_type: type || null,
                description: cleanDescription || null,
            }
            let result
            if (isEdit) {
                result = await apiPatch(`/projects/${projectId}/zones/${zone.id}`, payload)
                topTostError('Zone updated successfully', 'success')
            } else {
                result = await apiPost(`/projects/${projectId}/zones`, payload)
                topTostError('Zone created', 'success')
            }
            broadcastRefresh('cs:project-zones-refresh')
            broadcastRefresh('cs:project-cameras-refresh')
            onSuccess(result)
        } catch (err) {
            const msg = err.response?.data?.detail || (isEdit ? 'Failed to update zone' : 'Failed to create zone')
            if (err.response?.status === 409 || err.response?.status === 400) {
                setFieldErrors({ name: msg })
            } else {
                topTostError(msg, 'error')
            }
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
            <div className="modal-dialog modal-dialog-centered">
                <div className="modal-content">
                    <div className="modal-header">
                        <div>
                            <h5 className="modal-title mb-0">{isEdit ? 'Edit Zone' : 'Create Zone'}</h5>
                            <div className="fs-12 text-muted">
                                {isEdit ? 'Update zone details' : 'Add a new monitoring zone to this project'}
                            </div>
                        </div>
                        <button
                            type="button"
                            className="btn-close"
                            onClick={handleClose}
                            disabled={saving}
                        />
                    </div>
                    <form onSubmit={handleSubmit}>
                        <div className="modal-body">
                            <div className="row g-3">
                                <div className="col-12">
                                    <label className={LABEL} style={LABEL_STYLE}>
                                        Zone Name <span className="text-danger">*</span>
                                    </label>
                                    <div className="input-group">
                                        <div className="input-group-text"><FiTag size={15} /></div>
                                        <input
                                            type="text"
                                            className="form-control"
                                            placeholder="e.g. North Scaffold Area"
                                            value={name}
                                            maxLength={200}
                                            onChange={(e) => {
                                                setName(e.target.value)
                                                setFieldErrors(prev => ({ ...prev, name: null }))
                                            }}
                                            style={{ fontSize: '0.875rem' }}
                                            disabled={saving}
                                            autoFocus
                                            autoComplete="off"
                                        />
                                    </div>
                                    {fieldErrors.name && (
                                        <div className="text-danger fs-11 mt-1">{fieldErrors.name}</div>
                                    )}
                                </div>

                                <div className="col-12">
                                    <label className={LABEL} style={LABEL_STYLE}>
                                        Zone Type
                                    </label>
                                    <SelectDropdown
                                        value={type}
                                        placeholder="Select zone type"
                                        options={[
                                            { value: 'scaffold', label: 'Scaffold' },
                                            { value: 'entry', label: 'Entry' },
                                            { value: 'storage', label: 'Storage' },
                                            { value: 'perimeter', label: 'Perimeter' },
                                            { value: 'other', label: 'Other' },
                                        ]}
                                        onChange={(v) => setType(v)}
                                        disabled={saving}
                                        buttonStyle={{ fontSize: '0.875rem' }}
                                    />
                                </div>

                                <div className="col-12">
                                    <label className={LABEL} style={LABEL_STYLE}>
                                        Description
                                    </label>
                                    <textarea
                                        className={`form-control${countWords(description) > MAX_DESC_WORDS ? ' is-invalid' : ''}`}
                                        placeholder="Brief description of this zone and its monitoring purpose"
                                        value={description}
                                        rows={3}
                                        onChange={(e) => {
                                            setDescription(e.target.value)
                                            setFieldErrors(prev => ({ ...prev, description: null }))
                                        }}
                                        style={{ fontSize: '0.875rem', resize: 'none', minHeight: 90 }}
                                        disabled={saving}
                                    />
                                    {fieldErrors.description && (
                                        <div className="text-danger fs-11 mt-1">{fieldErrors.description}</div>
                                    )}
                                    <div className={`fs-11 mt-1 text-end ${countWords(description) > MAX_DESC_WORDS ? 'text-danger fw-semibold' : 'text-muted'}`}>
                                        {countWords(description)} / {MAX_DESC_WORDS} words
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="modal-footer">
                            <button
                                type="button"
                                className="btn btn-outline-secondary"
                                onClick={handleClose}
                                disabled={saving}
                                style={{ height: 40, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                className="btn btn-primary"
                                disabled={saving || !name.trim()}
                                style={{ height: 40, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}
                            >
                                {saving ? (
                                    <>
                                        <span className="spinner-border spinner-border-sm me-2" />
                                        {isEdit ? 'Updating…' : 'Creating…'}
                                    </>
                                ) : (
                                    isEdit ? 'Update Zone' : 'Create Zone'
                                )}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    )
}

export default ZoneFormModal
