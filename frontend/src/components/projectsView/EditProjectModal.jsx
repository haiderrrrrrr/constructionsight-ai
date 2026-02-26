import React, { useEffect, useMemo, useRef, useState } from 'react'
import { FiFolder, FiBriefcase, FiCalendar, FiAlertCircle, FiShield, FiTrash2 } from 'react-icons/fi'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import '@/styles/react-datepicker-theme.css'
import { apiPatch, apiUpload, apiDelete } from '@/utils/api'
import topTost from '@/utils/topTost'
import topTostError from '@/utils/topTostError'
import { parseApiError } from '@/utils/errorHandler'
import { sanitizeProjectDetails, validateProjectDetails } from '@/utils/projectValidation'
import { SelectDropdown } from '@/components/shared/Dropdown'
import { PAKISTAN_CITIES } from '@/components/projectsCreate/TabProjectDetails'

const LABEL = 'fs-11 fw-semibold text-muted text-uppercase mb-1'
const LABEL_STYLE = { letterSpacing: '0.06em' }
const DEFAULT_LOGO = '/images/icons/project-icon.png'

const EditProjectModal = ({ isOpen, onClose, project, onSuccess, patchEndpoint, logoEndpoint }) => {
    const [formData, setFormData] = useState({})
    const [logoPreview, setLogoPreview] = useState(null)
    const [errors, setErrors] = useState({})
    const [isLoading, setIsLoading] = useState(false)
    const logoInputRef = useRef(null)
    const startPointerRef = useRef(false)
    const endPointerRef = useRef(false)
    const [isStartCalendarOpen, setIsStartCalendarOpen] = useState(false)
    const [isEndCalendarOpen, setIsEndCalendarOpen] = useState(false)
    const [isDarkTheme, setIsDarkTheme] = useState(() => document.documentElement.classList.contains('app-skin-dark'))

    useEffect(() => {
        const el = document.documentElement
        const updateTheme = () => setIsDarkTheme(el.classList.contains('app-skin-dark'))
        const observer = new MutationObserver(() => updateTheme())
        observer.observe(el, { attributes: true, attributeFilter: ['class'] })
        return () => observer.disconnect()
    }, [])

    // Pre-fill when modal opens
    useEffect(() => {
        if (isOpen && project) {
            setFormData({
                name: project.name || '',
                location: project.location || '',
                client_name: project.client_name || '',
                start_date: project.start_date || '',
                end_date: project.end_date || '',
                description: project.description || '',
                logo_file: null,
                logo_preview: null,
                logo_url: project.logo_url || null,
                logo_removed: false,
            })
            setLogoPreview(project.logo_url || null)
            setErrors({})
        }
    }, [isOpen, project])

    const handleClose = () => {
        if (!isLoading) onClose()
    }

    // --- Logo handlers ---
    const handleLogoSelect = (e) => {
        const file = e.target.files?.[0]
        if (!file) return
        const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
        if (!allowed.includes(file.type)) {
            setErrors(prev => ({ ...prev, logo: 'Only PNG, JPEG, WebP, or SVG allowed' }))
            return
        }
        if (file.size > 2 * 1024 * 1024) {
            setErrors(prev => ({ ...prev, logo: 'Logo must be under 2 MB' }))
            return
        }
        setErrors(prev => ({ ...prev, logo: null }))
        const previewUrl = URL.createObjectURL(file)
        setLogoPreview(previewUrl)
        setFormData(prev => ({ ...prev, logo_file: file, logo_preview: previewUrl, logo_removed: false }))
    }

    const handleLogoRemove = () => {
        setLogoPreview(null)
        setFormData(prev => ({ ...prev, logo_file: null, logo_preview: null, logo_removed: true }))
        if (logoInputRef.current) logoInputRef.current.value = ''
    }

    // --- Date helpers ---
    const dateTemplate = 'YYYY-MM-DD'

    const parseISODate = (value) => {
        if (!value) return null
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value))
        if (!match) return null
        const year = Number(match[1]), monthIndex = Number(match[2]) - 1, day = Number(match[3])
        const date = new Date(year, monthIndex, day)
        if (Number.isNaN(date.getTime())) return null
        if (date.getFullYear() !== year || date.getMonth() !== monthIndex || date.getDate() !== day) return null
        return date
    }

    const formatISODate = (date) => {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
        const y = date.getFullYear()
        const m = String(date.getMonth() + 1).padStart(2, '0')
        const d = String(date.getDate()).padStart(2, '0')
        return `${y}-${m}-${d}`
    }

    const maskISODateGuide = (raw) => {
        const digits = String(raw || '').replace(/\D/g, '').slice(0, 8)
        const chars = dateTemplate.split('')
        const slots = [0, 1, 2, 3, 5, 6, 8, 9]
        for (let i = 0; i < digits.length; i++) chars[slots[i]] = digits[i]
        return { masked: chars.join(''), digitsCount: digits.length }
    }

    const autoPadDate = (value) => {
        if (!value) return value
        const { masked, digitsCount } = maskISODateGuide(value)
        if (digitsCount === 5) {
            const digits = String(value).replace(/\D/g, '')
            return `${digits.slice(0, 4)}-0${digits[4]}-MM`
        }
        if (digitsCount === 7) {
            const digits = String(value).replace(/\D/g, '')
            return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-0${digits[6]}`
        }
        return masked
    }

    const handleDateFocus = (fieldId, currentValue) => {
        requestAnimationFrame(() => {
            const { digitsCount } = maskISODateGuide(currentValue)
            const slots = [0, 1, 2, 3, 5, 6, 8, 9]
            const nextSlot = digitsCount >= slots.length ? 10 : slots[digitsCount]
            const el = document.getElementById(fieldId)
            if (el) el.setSelectionRange(nextSlot, nextSlot)
        })
    }

    const handleDateKeyDown = (e, fieldId) => {
        const slots = [0, 1, 2, 3, 5, 6, 8, 9]
        if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return
        const el = document.getElementById(fieldId)
        if (!el) return
        const pos = el.selectionStart
        if (e.key === 'ArrowLeft') {
            const prev = slots.findLast(s => s < pos)
            if (prev !== undefined) { e.preventDefault(); el.setSelectionRange(prev, prev) }
        } else {
            const next = slots.find(s => s > pos)
            if (next !== undefined) { e.preventDefault(); el.setSelectionRange(next, next) }
        }
    }

    const update = (field, value) => {
        setFormData(prev => ({ ...prev, [field]: value }))
        if (errors[field]) setErrors(prev => ({ ...prev, [field]: null }))
    }

    const cityOptions = useMemo(() => {
        const base = PAKISTAN_CITIES.map(city => ({ value: city, label: city }))
        const current = String(formData?.location || '').trim()
        if (current && !PAKISTAN_CITIES.includes(current)) {
            return [{ value: current, label: current }, ...base]
        }
        return base
    }, [formData?.location])

    // --- Validation ---
    const validate = () => {
        return validateProjectDetails(formData)
    }

    const getApiFieldError = (err) => {
        if (err?.status !== 422) return null
        try {
            const body = JSON.parse(err.message)
            const detail = Array.isArray(body?.detail) ? body.detail[0] : null
            const field = Array.isArray(detail?.loc) ? detail.loc[detail.loc.length - 1] : null
            if (field && ['name', 'location', 'client_name', 'start_date', 'end_date', 'description'].includes(field)) {
                return { [field]: detail?.msg || 'Invalid value' }
            }
        } catch {}
        return null
    }

    // --- Submit ---
    const handleSubmit = async (e) => {
        e.preventDefault()
        const errs = validate()
        if (Object.keys(errs).length > 0) { setErrors(errs); return }
        const details = sanitizeProjectDetails(formData)

        setIsLoading(true)
        setErrors({})
        try {
            const patchUrl = patchEndpoint || `/admin/projects/${project.id}`
            const logoUrl = logoEndpoint || `/admin/projects/${project.id}`
            await apiPatch(patchUrl, {
                name: details.name,
                location: details.location,
                client_name: details.client_name,
                start_date: details.start_date,
                end_date: details.end_date,
                description: details.description,
            })

            if (formData.logo_file) {
                try { await apiUpload(`${logoUrl}/logo`, formData.logo_file) } catch { /* non-blocking */ }
            } else if (formData.logo_removed) {
                try { await apiDelete(`${logoUrl}/logo`) } catch { /* non-blocking */ }
            }

            topTost('Project details updated')
            onSuccess?.()
            onClose()
        } catch (err) {
            const fieldError = getApiFieldError(err)
            if (fieldError) {
                setErrors(fieldError)
                return
            }
            const msg = parseApiError(err, 'Failed to update project')
            setErrors({ _form: msg })
            topTostError(msg)
        } finally {
            setIsLoading(false)
        }
    }

    const FieldError = ({ field }) => errors[field] ? (
        <span className="d-block mt-1" style={{ fontSize: '0.72rem', color: '#ef4444' }}>
            {errors[field]}
        </span>
    ) : null

    // Swipe-down-to-close (mobile bottom sheet)
    const swipeStartY = useRef(null)
    const swipeDeltaY = useRef(0)
    const [sheetTranslate, setSheetTranslate] = useState(0)

    const onTouchStart = (e) => {
        swipeStartY.current = e.touches[0].clientY
        swipeDeltaY.current = 0
    }
    const onTouchMove = (e) => {
        if (swipeStartY.current === null) return
        const delta = e.touches[0].clientY - swipeStartY.current
        if (delta < 0) return // no swipe up
        swipeDeltaY.current = delta
        setSheetTranslate(delta)
    }
    const onTouchEnd = () => {
        if (swipeDeltaY.current > 120) {
            handleClose()
        }
        setSheetTranslate(0)
        swipeStartY.current = null
    }

    useEffect(() => {
        if (!isOpen) setSheetTranslate(0)
    }, [isOpen])

    if (!isOpen) return null

    const isMobile = window.innerWidth < 576

    return (
        <div className="modal show d-block" style={{ backgroundColor: `rgba(0,0,0,${isMobile ? Math.max(0.1, 0.5 - swipeDeltaY.current / 400) : 0.5})`, zIndex: 1055 }}>
            <div className="modal-dialog modal-dialog-centered modal-lg modal-dialog-scrollable"
                style={isMobile ? {
                    margin: 0,
                    position: 'fixed',
                    bottom: 0,
                    left: '16px',
                    right: '16px',
                    maxWidth: 'calc(100% - 32px)',
                    maxHeight: '90dvh',
                    transform: `translateY(${sheetTranslate}px)`,
                    transition: sheetTranslate === 0 ? 'transform 0.25s ease' : 'none',
                } : {}}>
                <div className="modal-content" style={isMobile ? { borderRadius: '16px 16px 0 0', maxHeight: '90dvh', display: 'flex', flexDirection: 'column' } : {}}>
                    <div className="modal-header" style={{ flexDirection: 'column', alignItems: 'stretch', padding: isMobile ? '8px 16px 12px' : undefined, flexShrink: 0 }}
                        onTouchStart={isMobile ? onTouchStart : undefined}
                        onTouchMove={isMobile ? onTouchMove : undefined}
                        onTouchEnd={isMobile ? onTouchEnd : undefined}>
                        {isMobile && (
                            <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(128,128,128,0.4)', margin: '0 auto 10px', flexShrink: 0 }} />
                        )}
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                            <div>
                                <h5 className="modal-title mb-0">Edit Project Details</h5>
                                <div className="fs-12 text-muted">Update project information, logo, and timeline</div>
                            </div>
                            <button type="button" className="btn-close" onClick={handleClose} disabled={isLoading} />
                        </div>
                    </div>

                    <form onSubmit={handleSubmit} style={{ display: 'contents' }}>
                        <div className="modal-body" style={{ overflowY: 'auto', flex: '1 1 auto' }}>
                            <style>{`
                                .ep-logo-frame{padding:4px;border-radius:12px;background:rgba(0,0,0,0.02);border:1px solid var(--bs-border-color,rgba(0,0,0,.08));}
                                html.app-skin-dark .ep-logo-frame{background:rgba(255,255,255,0.06);border-color:rgba(255,255,255,0.10)!important;}
                                .ep-logo-img{width:80px;height:80px;object-fit:cover;border-radius:8px;background:transparent;}
                                .ep-err svg{stroke:#ef4444!important;color:#ef4444!important;}
                            `}</style>

                            {errors._form && (
                                <div className="ep-err d-flex align-items-start gap-2 px-3 py-2 rounded-2 mb-3" style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.22)', borderLeft: '3px solid #ef4444' }}>
                                    <FiShield size={14} style={{ marginTop: 2, flexShrink: 0 }} />
                                    <span style={{ fontSize: '0.8rem', color: '#ef4444' }}>{errors._form}</span>
                                </div>
                            )}

                            {/* Logo */}
                            <div className="mb-4">
                                <label className={LABEL} style={LABEL_STYLE}>Project Logo</label>
                                <div className="alert alert-soft-teal-message d-flex align-items-center gap-3 p-4 rounded-3 border-2 border-dotted mb-0">
                                    <div className="ep-logo-frame" style={{ position: 'relative', flexShrink: 0 }}>
                                        <img src={logoPreview || DEFAULT_LOGO} alt="Project logo" className="ep-logo-img" />
                                        {logoPreview && (
                                            <button type="button" onClick={handleLogoRemove} title="Remove logo" disabled={isLoading}
                                                style={{ position: 'absolute', top: -9, right: -9, width: 24, height: 24, borderRadius: '50%', background: '#ef4444', border: '2px solid var(--bs-body-bg,#0f172a)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0, lineHeight: 1 }}>
                                                <FiTrash2 size={11} />
                                            </button>
                                        )}
                                    </div>
                                    <div>
                                        <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="d-none" onChange={handleLogoSelect} />
                                        <button type="button" className="btn btn-sm bg-soft-teal text-teal d-inline-flex align-items-center gap-1" onClick={() => logoInputRef.current?.click()} disabled={isLoading}>
                                            {logoPreview ? 'Change Logo' : 'Upload Logo'}
                                        </button>
                                        <p className="fs-12 fw-medium mb-0 mt-2">PNG, JPG, WebP, SVG (up to 2 MB)</p>
                                        {errors.logo && <span className="ep-err d-flex align-items-center gap-1 mt-1" style={{ fontSize: '0.72rem', color: '#ef4444' }}><FiAlertCircle size={11} />{errors.logo}</span>}
                                    </div>
                                </div>
                            </div>

                            {/* Name + Location */}
                            <div className="row g-3 mb-3">
                                <div className="col-md-6">
                                    <label htmlFor="ep-name" className={LABEL} style={LABEL_STYLE}>Project Name <span className="text-danger">*</span></label>
                                    <div className="input-group">
                                        <div className="input-group-text"><FiFolder size={15} /></div>
                                        <input id="ep-name" type="text" className={`form-control ${errors.name ? 'is-invalid' : ''}`} placeholder="Enter project name" style={{ fontSize: '0.875rem' }} value={formData.name || ''} onChange={e => update('name', e.target.value)} maxLength={200} disabled={isLoading} />
                                    </div>
                                    <div className="d-flex justify-content-between">
                                        <FieldError field="name" />
                                        <span className="text-muted ms-auto" style={{ fontSize: '0.72rem' }}>{(formData.name || '').length}/200</span>
                                    </div>
                                </div>
                                <div className="col-md-6">
                                    <label htmlFor="ep-location" className={LABEL} style={LABEL_STYLE}>Site Location <span className="text-danger">*</span></label>
                                    <SelectDropdown
                                        id="ep-location"
                                        value={formData.location || ''}
                                        invalid={!!errors.location}
                                        placeholder="Select a city"
                                        options={cityOptions}
                                        onChange={(v) => update('location', v)}
                                        enableSearch={true}
                                        searchPlaceholder="Search city…"
                                        noResultsText="No cities found"
                                        menuPosition="end"
                                        buttonStyle={{ fontSize: '0.875rem', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                        disabled={isLoading}
                                    />
                                    <div className="mt-1">
                                        <FieldError field="location" />
                                    </div>
                                </div>
                            </div>

                            {/* Client Name + Start Date */}
                            <div className="row g-3 mb-3">
                                <div className="col-md-6">
                                    <label htmlFor="ep-client" className={LABEL} style={LABEL_STYLE}>Client Name <span className="text-danger">*</span></label>
                                    <div className="input-group">
                                        <div className="input-group-text"><FiBriefcase size={15} /></div>
                                        <input id="ep-client" type="text" className={`form-control ${errors.client_name ? 'is-invalid' : ''}`} placeholder="Enter client or organization name" style={{ fontSize: '0.875rem' }} value={formData.client_name || ''} onChange={e => update('client_name', e.target.value)} maxLength={200} disabled={isLoading} />
                                    </div>
                                    <div className="d-flex justify-content-between">
                                        <FieldError field="client_name" />
                                        <span className="text-muted ms-auto" style={{ fontSize: '0.72rem' }}>{(formData.client_name || '').length}/200</span>
                                    </div>
                                </div>
                                <div className="col-md-6">
                                    <label htmlFor="ep-start" className={LABEL} style={LABEL_STYLE}>Start Date <span className="text-danger">*</span></label>
                                    <div className="input-group" style={{ position: 'relative' }}>
                                        <div className="input-group-text" style={{ cursor: 'pointer' }} onClick={() => setIsStartCalendarOpen(true)}><FiCalendar size={15} /></div>
                                        <DatePicker
                                            id="ep-start"
                                            selected={parseISODate(formData.start_date)}
                                            value={formData.start_date || dateTemplate}
                                            onChange={(date) => { update('start_date', date ? formatISODate(date) : ''); setIsStartCalendarOpen(false) }}
                                            onChangeRaw={(e) => {
                                                const { masked, digitsCount } = maskISODateGuide(e.target.value)
                                                update('start_date', digitsCount === 0 ? '' : masked)
                                                requestAnimationFrame(() => {
                                                    const slots = [0, 1, 2, 3, 5, 6, 8, 9]
                                                    let caret = slots[digitsCount] ?? 10
                                                    if (digitsCount === 6) caret = slots[6]
                                                    if (digitsCount === 4) caret = slots[4]
                                                    const el = document.getElementById('ep-start')
                                                    if (el) el.setSelectionRange(caret, caret)
                                                })
                                            }}
                                            dateFormat="yyyy-MM-dd" placeholderText="YYYY-MM-DD"
                                            className={`form-control cs-date-input ${errors.start_date ? 'is-invalid' : ''}`}
                                            open={isStartCalendarOpen}
                                            onInputClick={() => { startPointerRef.current = true }}
                                            onClickOutside={() => setIsStartCalendarOpen(false)}
                                            onCalendarClose={() => setIsStartCalendarOpen(false)}
                                            onFocus={() => { if (startPointerRef.current) { startPointerRef.current = false; return } handleDateFocus('ep-start', formData.start_date) }}
                                            onKeyDown={(e) => handleDateKeyDown(e, 'ep-start')}
                                            onBlur={() => {
                                                if ((formData.start_date || '').trim().toUpperCase() === dateTemplate) { update('start_date', '') }
                                                else if (formData.start_date) { const p = autoPadDate(formData.start_date); if (p !== formData.start_date) update('start_date', p) }
                                            }}
                                            popperClassName={isDarkTheme ? 'react-datepicker-dark' : ''}
                                            disabled={isLoading}
                                        />
                                    </div>
                                    <FieldError field="start_date" />
                                </div>
                            </div>

                            {/* End Date */}
                            <div className="row g-3 mb-3">
                                <div className="col-md-6">
                                    <label htmlFor="ep-end" className={LABEL} style={LABEL_STYLE}>End Date <span className="text-danger">*</span></label>
                                    <div className="input-group" style={{ position: 'relative' }}>
                                        <div className="input-group-text" style={{ cursor: 'pointer' }} onClick={() => setIsEndCalendarOpen(true)}><FiCalendar size={15} /></div>
                                        <DatePicker
                                            id="ep-end"
                                            selected={parseISODate(formData.end_date)}
                                            value={formData.end_date || dateTemplate}
                                            onChange={(date) => { update('end_date', date ? formatISODate(date) : ''); setIsEndCalendarOpen(false) }}
                                            onChangeRaw={(e) => {
                                                const { masked, digitsCount } = maskISODateGuide(e.target.value)
                                                update('end_date', digitsCount === 0 ? '' : masked)
                                                requestAnimationFrame(() => {
                                                    const slots = [0, 1, 2, 3, 5, 6, 8, 9]
                                                    let caret = slots[digitsCount] ?? 10
                                                    if (digitsCount === 6) caret = slots[6]
                                                    if (digitsCount === 4) caret = slots[4]
                                                    const el = document.getElementById('ep-end')
                                                    if (el) el.setSelectionRange(caret, caret)
                                                })
                                            }}
                                            dateFormat="yyyy-MM-dd" placeholderText="YYYY-MM-DD"
                                            className={`form-control cs-date-input ${errors.end_date ? 'is-invalid' : ''}`}
                                            open={isEndCalendarOpen}
                                            onInputClick={() => { endPointerRef.current = true }}
                                            onClickOutside={() => setIsEndCalendarOpen(false)}
                                            onCalendarClose={() => setIsEndCalendarOpen(false)}
                                            onFocus={() => { if (endPointerRef.current) { endPointerRef.current = false; return } handleDateFocus('ep-end', formData.end_date) }}
                                            onKeyDown={(e) => handleDateKeyDown(e, 'ep-end')}
                                            onBlur={() => {
                                                if ((formData.end_date || '').trim().toUpperCase() === dateTemplate) { update('end_date', '') }
                                                else if (formData.end_date) { const p = autoPadDate(formData.end_date); if (p !== formData.end_date) update('end_date', p) }
                                            }}
                                            popperClassName={isDarkTheme ? 'react-datepicker-dark' : ''}
                                            disabled={isLoading}
                                        />
                                    </div>
                                    <FieldError field="end_date" />
                                </div>
                            </div>

                            {/* Description */}
                            <div className="mb-2">
                                <label htmlFor="ep-desc" className={LABEL} style={LABEL_STYLE}>Project Description <span className="text-danger">*</span></label>
                                <textarea id="ep-desc" className={`form-control ${errors.description ? 'is-invalid' : ''}`} rows={7} placeholder="Enter a brief summary of the project scope and objectives" style={{ fontSize: '0.875rem', resize: 'none' }} value={formData.description || ''} onChange={e => update('description', e.target.value)} maxLength={2000} disabled={isLoading} />
                                <div className="d-flex justify-content-between mt-1">
                                    <FieldError field="description" />
                                    <span className="text-muted ms-auto" style={{ fontSize: '0.72rem' }}>{(formData.description || '').length}/2000</span>
                                </div>
                            </div>
                        </div>

                        <div className="modal-footer" style={{ flexShrink: 0 }}>
                            <button
                                type="button"
                                className="btn btn-outline-secondary"
                                style={{ height: 40, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}
                                onClick={handleClose}
                                disabled={isLoading}
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                className="btn btn-primary"
                                style={{ height: 40, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}
                                disabled={isLoading}
                            >
                                {isLoading ? <><span className="spinner-border spinner-border-sm me-2" />Saving…</> : 'Save Changes'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    )
}

export default EditProjectModal
