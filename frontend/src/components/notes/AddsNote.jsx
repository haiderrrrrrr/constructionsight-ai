import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { SelectDropdown } from '@/components/shared/Dropdown'
import { apiPost, apiPatch } from '@/utils/api'
import { broadcastRefresh } from '@/utils/broadcast'
import topTostError from '@/utils/topTostError'
import { sanitizeProjectText, validateHumanText } from '@/utils/projectValidation'

const CATEGORIES = [
    { value: 'tasks',     label: 'Tasks' },
    { value: 'work',      label: 'Work' },
    { value: 'team',      label: 'Team' },
    { value: 'archive',   label: 'Archive' },
    { value: 'urgent',    label: 'Urgent' },
    { value: 'personal',  label: 'Personal' },
    { value: 'client',    label: 'Client' },
    { value: 'important', label: 'Important' },
]

const AddsNote = ({ projectId, onNoteAdded, onNoteUpdated }) => {
    const [isOpen, setIsOpen]     = useState(false)
    const [editing, setEditing]   = useState(null) // { id, title, content, category }
    const [title, setTitle]       = useState('')
    const [content, setContent]   = useState('')
    const [category, setCategory] = useState('tasks')
    const [loading, setLoading]   = useState(false)
    const [fieldErrors, setFieldErrors] = useState({})

    useEffect(() => {
        const onAdd = () => {
            setEditing(null)
            setTitle('')
            setContent('')
            setCategory('tasks')
            setFieldErrors({})
            setIsOpen(true)
        }
        const onEdit = (e) => {
            const detail = e.detail || {}
            if (!detail || !detail.id) return
            setEditing({ id: detail.id })
            setTitle(String(detail.title || ''))
            setContent(String(detail.content || ''))
            setCategory(String(detail.category || 'tasks'))
            setFieldErrors({})
            setIsOpen(true)
        }
        window.addEventListener('cs:open-add-note', onAdd)
        window.addEventListener('cs:open-edit-note', onEdit)
        return () => {
            window.removeEventListener('cs:open-add-note', onAdd)
            window.removeEventListener('cs:open-edit-note', onEdit)
        }
    }, [])

    const handleClose = () => {
        if (loading) return
        setIsOpen(false)
        setTitle('')
        setContent('')
        setCategory('tasks')
        setEditing(null)
        setFieldErrors({})
    }

    useEffect(() => {
        if (!isOpen) return
        const onKeyDown = (e) => {
            if (e.key === 'Escape') handleClose()
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [isOpen])

    const handleAdd = async () => {
        if (!projectId) {
            topTostError('Project not selected')
            return
        }
        const errs = {}
        const titleErr = validateHumanText(title, 'Note title', { min: 2, max: 500 })
        if (titleErr) errs.title = titleErr
        const contentErr = validateHumanText(content, 'Description', {
            required: false,
            min: 5,
            max: 2000,
            multiline: true,
        })
        if (contentErr) errs.content = contentErr
        setFieldErrors(errs)
        if (Object.keys(errs).length) {
            return
        }
        const cleanTitle = sanitizeProjectText(title)
        const cleanContent = sanitizeProjectText(content, { multiline: true })
        setLoading(true)
        try {
            if (editing && editing.id) {
                const updated = await apiPatch(`/projects/${projectId}/notes/${editing.id}`, {
                    title: cleanTitle,
                    content: cleanContent || null,
                    category,
                })
                onNoteUpdated && onNoteUpdated(updated)
                broadcastRefresh('cs:project-notes-refresh')
            } else {
                const note = await apiPost(`/projects/${projectId}/notes`, {
                    title: cleanTitle,
                    content: cleanContent || null,
                    category,
                })
                onNoteAdded && onNoteAdded(note)
                broadcastRefresh('cs:project-notes-refresh')
            }
            handleClose()
        } catch (err) {
            let msg = 'Failed to add note'
            try { msg = JSON.parse(err.message)?.detail || msg } catch {}
            topTostError(msg)
        } finally {
            setLoading(false)
        }
    }

    if (!isOpen) return null

    return createPortal(
        <>
            <div
                onClick={handleClose}
                style={{
                    position: 'fixed',
                    inset: 0,
                    backgroundColor: 'rgba(0,0,0,0.35)',
                    zIndex: 1050,
                }}
            />
            <div
                className="modal show d-block"
                style={{ zIndex: 1055 }}
                role="dialog"
                aria-modal="true"
                onClick={handleClose}
            >
                <div className="modal-dialog modal-dialog-centered cs-note-dialog" role="document" onClick={(e) => e.stopPropagation()}>
                    <div className="modal-content">
                        <div className="modal-header">
                            <div>
                                <h5 className="modal-title mb-0">{editing ? 'Edit Note' : 'Add Notes'}</h5>
                                <div className="fs-12 text-muted">{editing ? 'Update note details' : 'Create a new note for this project'}</div>
                            </div>
                            <button
                                type="button"
                                className="btn-close"
                                onClick={handleClose}
                                disabled={loading}
                            />
                        </div>
                        <div className="modal-body">
                            <style>{`
                                @media (max-width: 575.98px) {
                                    .cs-note-dialog { margin: auto 16px !important; max-width: calc(100% - 32px) !important; }
                                }
                            `}</style>
                            <div className="row g-3">
                                <div className="col-12">
                                    <label className="form-label fs-11 fw-semibold text-muted text-uppercase mb-1" style={{ letterSpacing: '0.06em' }}>
                                        Category
                                    </label>
                                    <SelectDropdown
                                        value={category}
                                        options={CATEGORIES}
                                        onChange={(v) => setCategory(v)}
                                        disabled={loading}
                                        placeholder="Select category"
                                        dropdownDisplay="static"
                                        menuStyle={{ zIndex: 9999 }}
                                        buttonStyle={{ fontSize: '0.875rem' }}
                                    />
                                </div>
                                <div className="col-12">
                                    <label className="form-label fs-11 fw-semibold text-muted text-uppercase mb-1" style={{ letterSpacing: '0.06em' }}>
                                        Note Title <span className="text-danger">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        className="form-control"
                                        placeholder="Enter note title"
                                        style={{ fontSize: '0.875rem' }}
                                        value={title}
                                        onChange={(e) => {
                                            setTitle(e.target.value)
                                            setFieldErrors(prev => ({ ...prev, title: null }))
                                        }}
                                        disabled={loading}
                                        autoComplete="off"
                                    />
                                    {fieldErrors.title && (
                                        <div className="text-danger fs-11 mt-1">{fieldErrors.title}</div>
                                    )}
                                </div>
                                <div className="col-12">
                                    <label className="form-label fs-11 fw-semibold text-muted text-uppercase mb-1" style={{ letterSpacing: '0.06em' }}>Description</label>
                                    <textarea
                                        className="form-control"
                                        placeholder="Enter description"
                                        style={{ fontSize: '0.875rem', resize: 'none' }}
                                        rows={4}
                                        value={content}
                                        onChange={(e) => {
                                            setContent(e.target.value)
                                            setFieldErrors(prev => ({ ...prev, content: null }))
                                        }}
                                        disabled={loading}
                                    />
                                    {fieldErrors.content && (
                                        <div className="text-danger fs-11 mt-1">{fieldErrors.content}</div>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button
                                type="button"
                                className="btn btn-outline-secondary"
                                onClick={handleClose}
                                disabled={loading}
                                style={{ height: 40, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="btn btn-primary"
                                onClick={handleAdd}
                                disabled={loading || title.trim().length < 2}
                                style={{ height: 40, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}
                            >
                                {loading ? (
                                    <><span className="spinner-border spinner-border-sm me-2"></span>{editing ? 'Saving…' : 'Adding…'}</>
                                ) : (editing ? 'Save Changes' : 'Add Note')}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </>,
        document.body
    )
}

export default AddsNote
