import React, { useState } from 'react'
import { useParams, useNavigate, Navigate } from 'react-router-dom'
import { FiArrowLeft, FiCheckSquare } from 'react-icons/fi'
import { apiPost } from '@/utils/api'
import topTostError from '@/utils/topTostError'

const ProjectTasksCreate = () => {
    const { projectId } = useParams()
    const navigate = useNavigate()
    const [title, setTitle] = useState('')
    const [description, setDescription] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const actionBtnStyle = { height: 40, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }

    if (!projectId) return <Navigate to="/projects/my" replace />

    const handleSubmit = async (e) => {
        e.preventDefault()
        if (!title.trim()) {
            topTostError('Task title is required')
            return
        }
        setSubmitting(true)
        try {
            await apiPost(`/projects/${projectId}/tasks`, {
                title: title.trim(),
                description: description.trim() || null,
            })
            topTostError('Task created successfully', 'success')
            navigate(`/projects/${projectId}/tasks`)
        } catch (err) {
            topTostError(err?.response?.data?.detail || 'Failed to create task')
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <div className="nxl-content-inner">
            <div className="page-header">
                <div className="page-header-left d-flex align-items-center gap-3">
                    <button
                        type="button"
                        className="btn btn-icon btn-light-brand"
                        onClick={() => navigate(`/projects/${projectId}/tasks`)}
                    >
                        <FiArrowLeft size={16} />
                    </button>
                    <div>
                        <h5 className="page-header-title fw-bold mb-0">Add New Task</h5>
                        <p className="text-muted mb-0 small">Create a task for this project</p>
                    </div>
                </div>
            </div>

            <div className="row justify-content-center mt-3">
                <div className="col-lg-7 col-xl-6">
                    <div className="card">
                        <div className="card-header d-flex align-items-center gap-2">
                            <FiCheckSquare size={18} className="text-primary" />
                            <h6 className="card-title mb-0">Task Details</h6>
                        </div>
                        <div className="card-body">
                            <form onSubmit={handleSubmit}>
                                <div className="mb-4">
                                    <label htmlFor="taskTitle" className="form-label fw-semibold">
                                        Task Name <span className="text-danger">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        id="taskTitle"
                                        className="form-control"
                                        placeholder="Enter task name"
                                        value={title}
                                        onChange={e => setTitle(e.target.value)}
                                        maxLength={500}
                                        required
                                        autoFocus
                                    />
                                    <small className="text-muted">Short description of what needs to be done</small>
                                </div>

                                <div className="mb-4">
                                    <label htmlFor="taskDesc" className="form-label fw-semibold">
                                        Note / Description
                                    </label>
                                    <textarea
                                        id="taskDesc"
                                        className="form-control"
                                        placeholder="Optional details or notes..."
                                        rows={4}
                                        value={description}
                                        onChange={e => setDescription(e.target.value)}
                                        maxLength={2000}
                                    />
                                    <small className="text-muted">Optional — max 2000 characters</small>
                                </div>

                                <div className="d-flex gap-2 justify-content-end">
                                    <button
                                        type="button"
                                        className="btn btn-lg btn-outline-secondary"
                                        onClick={() => navigate(`/projects/${projectId}/tasks`)}
                                        disabled={submitting}
                                        style={actionBtnStyle}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        className="btn btn-lg btn-primary"
                                        disabled={submitting || !title.trim()}
                                        style={actionBtnStyle}
                                    >
                                        {submitting && <span className="spinner-border spinner-border-sm me-2" />}
                                        Add Task
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default ProjectTasksCreate
