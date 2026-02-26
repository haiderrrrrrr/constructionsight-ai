import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { FiCheckSquare } from 'react-icons/fi'
import topTost from '@/utils/topTost'
import topTostError from '@/utils/topTostError'
import { apiPost, apiPatch } from '@/utils/api'
import { broadcastRefresh } from '@/utils/broadcast'
import { sanitizeProjectText, validateHumanText } from '@/utils/projectValidation'

const AddTaskModal = ({ projectId: propProjectId }) => {
    const { projectId: paramProjectId } = useParams()
    const projectId = propProjectId || parseInt(paramProjectId, 10)

    const [isOpen, setIsOpen] = useState(false)
    const [title, setTitle] = useState('')
    const [description, setDescription] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [fieldErrors, setFieldErrors] = useState({})
    const [editingTask, setEditingTask] = useState(null)

    const LABEL = 'fs-11 fw-semibold text-muted text-uppercase mb-1'
    const LABEL_STYLE = { letterSpacing: '0.06em' }

    useEffect(() => {
        const handleCreate = () => {
            setEditingTask(null)
            setTitle('')
            setDescription('')
            setFieldErrors({})
            setIsOpen(true)
        }
        const handleEdit = (e) => {
            const task = e.detail
            if (task) {
                setEditingTask(task)
                setTitle(task.title || '')
                setDescription(task.description || '')
                setFieldErrors({})
                setIsOpen(true)
            }
        }
        window.addEventListener('cs:open-add-task-modal', handleCreate)
        window.addEventListener('cs:open-edit-task-modal', handleEdit)
        return () => {
            window.removeEventListener('cs:open-add-task-modal', handleCreate)
            window.removeEventListener('cs:open-edit-task-modal', handleEdit)
        }
    }, [])

    const handleClose = () => {
        if (!isLoading) {
            setIsOpen(false)
            setTitle('')
            setDescription('')
            setFieldErrors({})
        }
    }

    const handleSubmit = async (e) => {
        e.preventDefault()

        const errs = {}
        const titleErr = validateHumanText(title, 'Task title', { min: 2, max: 500 })
        if (titleErr) errs.title = titleErr
        const descriptionErr = validateHumanText(description, 'Description', {
            min: 5,
            max: 1500,
            multiline: true,
        })
        if (descriptionErr) errs.description = descriptionErr
        setFieldErrors(errs)
        if (Object.keys(errs).length) {
            return
        }

        const cleanTitle = sanitizeProjectText(title)
        const cleanDescription = sanitizeProjectText(description, { multiline: true })
        setIsLoading(true)
        try {
            if (editingTask) {
                await apiPatch(`/projects/${projectId}/tasks/${editingTask.id}`, {
                    title: cleanTitle,
                    description: cleanDescription,
                })
                topTost('Task updated successfully')
            } else {
                await apiPost(`/projects/${projectId}/tasks`, {
                    title: cleanTitle,
                    description: cleanDescription,
                })
                topTost('Task created successfully')
            }
            handleClose()
            broadcastRefresh('cs:project-tasks-refresh')
        } catch (err) {
            const msg = err?.response?.data?.detail || `Failed to ${editingTask ? 'update' : 'create'} task`
            topTostError(msg)
        } finally {
            setIsLoading(false)
        }
    }

    if (!isOpen) return null

    return (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)', padding: '16px' }}>
            <div className="modal-dialog modal-dialog-centered modal-lg" style={{ margin: '0 auto' }}>
                <div className="modal-content">
                    <div className="modal-header">
                        <div>
                            <h5 className="modal-title mb-0">{editingTask ? 'Edit Task' : 'Add Task'}</h5>
                            <div className="fs-12 text-muted">
                                {editingTask ? 'Update task details' : 'Create a new task for this project'}
                            </div>
                        </div>
                        <button
                            type="button"
                            className="btn-close"
                            onClick={handleClose}
                            disabled={isLoading}
                        ></button>
                    </div>
                    <form onSubmit={handleSubmit}>
                        <div className="modal-body">
                            <div className="row g-3">
                                <div className="col-12">
                                    <label htmlFor="taskTitle" className={LABEL} style={LABEL_STYLE}>
                                        Task Title <span className="text-danger">*</span>
                                    </label>
                                    <div className="input-group">
                                        <div className="input-group-text"><FiCheckSquare size={15} /></div>
                                        <input
                                            id="taskTitle"
                                            type="text"
                                            className="form-control"
                                            placeholder="Enter task title"
                                            style={{ fontSize: '0.875rem' }}
                                            value={title}
                                            onChange={e => {
                                                setTitle(e.target.value)
                                                setFieldErrors(prev => ({ ...prev, title: null }))
                                            }}
                                            disabled={isLoading}
                                            maxLength={500}
                                            required
                                            autoFocus
                                            autoComplete="off"
                                        />
                                    </div>
                                    {fieldErrors.title && (
                                        <div className="text-danger fs-11 mt-1">{fieldErrors.title}</div>
                                    )}
                                </div>

                                <div className="col-12">
                                    <label htmlFor="taskDescription" className={LABEL} style={LABEL_STYLE}>
                                        Description <span className="text-danger">*</span>
                                    </label>
                                    <textarea
                                        id="taskDescription"
                                        className="form-control"
                                        placeholder="Describe what needs to be done..."
                                        style={{ fontSize: '0.875rem', minHeight: 90, resize: 'none' }}
                                        value={description}
                                        onChange={e => {
                                            setDescription(e.target.value)
                                            setFieldErrors(prev => ({ ...prev, description: null }))
                                        }}
                                        disabled={isLoading}
                                        maxLength={1500}
                                        rows={3}
                                        required
                                    />
                                    {fieldErrors.description && (
                                        <div className="text-danger fs-11 mt-1">{fieldErrors.description}</div>
                                    )}
                                    <div className="fs-11 text-muted mt-1 text-end">{description.length} / 1500</div>
                                </div>
                            </div>
                        </div>

                        <div className="modal-footer">
                            <button
                                type="button"
                                className="btn btn-outline-secondary"
                                onClick={handleClose}
                                disabled={isLoading}
                                style={{ height: 40, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                className="btn btn-primary"
                                disabled={isLoading || !title.trim() || !description.trim()}
                                style={{ height: 40, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}
                            >
                                {isLoading ? (
                                    <>
                                        <span className="spinner-border spinner-border-sm me-2"></span>
                                        {editingTask ? 'Updating…' : 'Creating…'}
                                    </>
                                ) : (
                                    editingTask ? 'Update Task' : 'Create Task'
                                )}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    )
}

export default AddTaskModal
