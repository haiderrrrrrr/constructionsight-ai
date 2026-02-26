import React, { useState, useEffect, useMemo } from 'react'
import { useParams, Navigate, useNavigate, useLocation } from 'react-router-dom'
import PageLoader from '@/components/shared/PageLoader'
import { FiCalendar, FiCheckCircle, FiEdit2, FiTrash2, FiUser } from 'react-icons/fi'
import { apiGet, apiPatch, apiDelete } from '@/utils/api'
import { broadcastRefresh, onBroadcast } from '@/utils/broadcast'
import { openCameraStream } from '@/utils/cameraSSE'
import topTost from '@/utils/topTost'
import topTostError from '@/utils/topTostError'
import ProjectTasksHeader, { ProjectTasksHeaderContent } from '@/components/projectWorkspace/ProjectTasksHeader'
import AddTaskModal from '@/components/projectWorkspace/AddTaskModal'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import PageHeader from '@/components/shared/pageHeader/PageHeader'

const ProjectTasksPage = () => {
    const { projectId } = useParams()
    const navigate = useNavigate()
    const location = useLocation()
    const [tasks, setTasks] = useState([])
    const [project, setProject] = useState(() => {
        try {
            const cached = sessionStorage.getItem(`cs:projectMeta:${projectId}`)
            if (cached) return JSON.parse(cached)
        } catch {}
        return null
    })
    const [loading, setLoading] = useState(true)
    const [confirm, setConfirm] = useState(null)
    const [acting, setActing] = useState(false)

    useEffect(() => {
        navigate({ search: '' }, { replace: true })
    }, [])

    if (!projectId) return <Navigate to="/projects/my" replace />

    useEffect(() => {
        const load = async () => {
            try {
                const cached = (() => {
                    try { return sessionStorage.getItem(`cs:projectMeta:${projectId}`) } catch { return null }
                })()
                const calls = cached
                    ? [apiGet(`/projects/${projectId}/tasks`)]
                    : [apiGet(`/projects/${projectId}/tasks`), apiGet(`/projects/${projectId}`)]
                const [tasksData, projectData] = await Promise.all(calls)
                setTasks(tasksData || [])
                if (projectData) {
                    try {
                        sessionStorage.setItem(`cs:projectMeta:${projectId}`, JSON.stringify({
                            name: projectData.name, my_role: projectData.my_role, status: projectData.status,
                            my_email: projectData.my_email, my_user_id: projectData.my_user_id,
                        }))
                    } catch {}
                    setProject(projectData)
                }
            } catch (err) {
                topTostError(err?.response?.data?.detail || 'Failed to load tasks')
            } finally {
                setLoading(false)
            }
        }
        load()
    }, [projectId])

    useEffect(() => {
        const handler = () => {
            apiGet(`/projects/${projectId}/tasks`).then(d => setTasks(d || [])).catch(() => {})
        }
        window.addEventListener('cs:project-tasks-refresh', handler)
        const unsubBroadcast = onBroadcast('cs:project-tasks-refresh', handler)
        return () => {
            window.removeEventListener('cs:project-tasks-refresh', handler)
            unsubBroadcast()
        }
    }, [projectId])

    useEffect(() => {
        return openCameraStream(`/projects/${projectId}/tasks/stream`, {
            task_refresh: () => {
                apiGet(`/projects/${projectId}/tasks`).then(d => setTasks(d || [])).catch(() => {})
            },
        })
    }, [projectId])

    const currentFilter = String(new URLSearchParams(location.search).get('filter') || 'all').toLowerCase()

    const displayTasks = useMemo(() => [...tasks]
        .filter(task => {
            if (currentFilter === 'pending') return !task.is_done
            if (currentFilter === 'completed') return task.is_done
            return true
        })
        .sort((a, b) => {
            const aTime = a?.created_at ? new Date(a.created_at).getTime() : 0
            const bTime = b?.created_at ? new Date(b.created_at).getTime() : 0
            if (aTime !== bTime) return aTime - bTime
            return (Number(a?.id) || 0) - (Number(b?.id) || 0)
        }), [tasks, currentFilter])

    const handleToggle = async (task) => {
        const newDone = !task.is_done
        setTasks(prev => prev.map(t => t.id === task.id ? { ...t, is_done: newDone } : t))
        try {
            await apiPatch(`/projects/${projectId}/tasks/${task.id}/toggle`, { is_done: newDone })
            broadcastRefresh('cs:project-tasks-refresh')
        } catch (err) {
            setTasks(prev => prev.map(t => t.id === task.id ? { ...t, is_done: task.is_done } : t))
            topTostError(err?.response?.data?.detail || 'Failed to update task')
        }
    }

    const askDelete = (task) => {
        if (!task) return
        setConfirm({
            variant: 'delete',
            title: 'Delete Task',
            message: `"${task.title}" will be permanently deleted. This cannot be undone.`,
            onConfirm: async () => {
                await apiDelete(`/projects/${projectId}/tasks/${task.id}`)
                setTasks(prev => prev.filter(t => t.id !== task.id))
                broadcastRefresh('cs:project-tasks-refresh')
                topTost('Task deleted')
                setConfirm(null)
            },
        })
    }

    const closeConfirm = () => { if (!acting) setConfirm(null) }
    const runConfirm = async () => {
        if (!confirm) return
        setActing(true)
        try {
            await confirm.onConfirm()
        } catch (err) {
            topTostError(err?.response?.data?.detail || 'Action failed')
        } finally {
            setActing(false)
        }
    }

    if (loading) return <PageLoader minHeight="60vh" />

    return (
        <>
            <PageHeader>
                <ProjectTasksHeader myRole={project?.my_role} />
            </PageHeader>

            <ProjectTasksHeaderContent
                tasks={tasks}
            />

            <div className="main-content">
                <style>{`
                    .cs-task-card {
                        position: relative;
                        border-radius: 14px;
                        border: 1px solid rgba(148, 163, 184, 0.22);
                        transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
                        overflow: hidden;
                        cursor: pointer;
                    }
                    .cs-task-card::before {
                        content: '';
                        position: absolute;
                        left: 0;
                        top: 0;
                        bottom: 0;
                        width: 6px;
                        background: var(--cs-accent, rgba(148, 163, 184, 0.75));
                    }
                    .cs-task-card:hover {
                        transform: translateY(-2px);
                        box-shadow: 0 14px 40px rgba(0, 0, 0, 0.18);
                        border-color: rgba(148, 163, 184, 0.35);
                    }
                    .cs-task-card.cs-task-completed {
                        opacity: 0.92;
                    }
                    .cs-task-title {
                        text-decoration: none;
                        letter-spacing: 0.05em;
                        line-height: 1.35;
                        color: var(--bs-body-color) !important;
                    }
                    .cs-task-desc {
                        display: -webkit-box;
                        -webkit-line-clamp: 2;
                        -webkit-box-orient: vertical;
                        overflow: hidden;
                        word-wrap: break-word;
                        overflow-wrap: break-word;
                        opacity: 0.9;
                        color: var(--bs-body-color) !important;
                    }
                    .cs-task-meta {
                        font-size: 0.78rem;
                    }
                    .cs-task-actions {
                        opacity: 0.92;
                        transition: opacity 0.18s ease, transform 0.18s ease;
                    }
                    .cs-task-card:hover .cs-task-actions {
                        opacity: 1;
                        transform: translateY(-1px);
                    }
                    .cs-task-action-btn {
                        width: 34px;
                        height: 34px;
                        padding: 0;
                        border-radius: 999px;
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        border: 2px solid transparent;
                        color: #fff;
                    }
                    .cs-task-action-btn:focus,
                    .cs-task-action-btn:focus-visible {
                        outline: none;
                        box-shadow: none;
                    }

                    html.app-skin-dark .cs-task-card {
                        border-color: rgba(148, 163, 184, 0.18);
                    }
                    html.app-skin-dark .cs-task-card:hover {
                        border-color: rgba(148, 163, 184, 0.3);
                    }
                    html.app-skin-dark .cs-task-card::before {
                        background: var(--cs-accent, rgba(148, 163, 184, 0.95));
                    }
                    html.app-skin-dark .cs-task-title {
                        color: rgba(226, 232, 240, 0.95) !important;
                    }
                    html.app-skin-dark .cs-task-desc {
                        color: rgba(226, 232, 240, 0.82) !important;
                    }
                `}</style>
                <div className="row">
                    <div className="col-12">
                        {displayTasks.length === 0 ? (
                            <div className="py-5 text-center text-muted">
                                <hr className="my-4 opacity-25" />
                                <div
                                    className="d-inline-flex align-items-center justify-content-center rounded-circle mb-3"
                                    style={{ width: 56, height: 56, background: 'rgba(var(--bs-primary-rgb), 0.12)', color: 'var(--bs-primary)' }}
                                >
                                    <FiCheckCircle size={18} />
                                </div>
                                <div className="fw-bold fs-16" style={{ color: 'var(--bs-heading-color)' }}>
                                    {tasks.length === 0 ? 'No tasks yet' : 'No tasks match this filter'}
                                </div>
                                <div className="fs-13 text-muted mt-1">
                                    {tasks.length === 0 ? 'Tasks will appear here once they are created' : 'Try another filter or switch back to All'}
                                </div>
                                <hr className="my-4 opacity-25" />
                            </div>
                        ) : (
                            <div className="row">
                                {displayTasks.map(task => (
                                    <TaskCard
                                        key={task.id}
                                        task={task}
                                        myRole={project?.my_role}
                                        onToggle={handleToggle}
                                        onDelete={askDelete}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
            <AddTaskModal projectId={parseInt(projectId, 10)} />
            <ConfirmDialog
                open={!!confirm}
                variant={confirm?.variant}
                title={confirm?.title}
                message={confirm?.message}
                loading={acting}
                onClose={closeConfirm}
                onConfirm={runConfirm}
            />
        </>
    )
}

export default ProjectTasksPage


const TaskCard = ({ task, myRole, onToggle, onDelete }) => {
    const isPM = myRole === 'project_manager'
    const canToggle = ['project_manager', 'site_supervisor', 'safety_officer'].includes(myRole)
    const createdAtText = task?.created_at ? new Date(task.created_at).toLocaleDateString() : ''
    const doneAtText = task?.done_at ? new Date(task.done_at).toLocaleDateString() : ''
    const statusColor = task.is_done ? 'success' : 'danger'

    return (
        <div className="col-12 mb-3">
            <div
                className={`card cs-task-card ${task.is_done ? 'cs-task-completed' : ''}`}
                style={{ '--cs-accent': task.is_done ? '#22c55e' : '#ef4444', cursor: canToggle ? 'pointer' : 'default' }}
                role={canToggle ? 'button' : undefined}
                tabIndex={canToggle ? 0 : undefined}
                onClick={() => canToggle && onToggle(task)}
                onKeyDown={(e) => {
                    if (canToggle && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault()
                        onToggle(task)
                    }
                }}
            >
                <div className="card-body py-3">
                    <div className="d-flex justify-content-between gap-3 align-items-start">
                        <div className="flex-grow-1" style={{ minWidth: 0 }}>
                            <div className="d-flex align-items-center gap-2 flex-wrap">
                                <div
                                    className="cs-task-title fw-semibold text-body text-uppercase"
                                    style={{ fontSize: '0.95rem', minWidth: 0 }}
                                >
                                    {task.title}
                                </div>
                                <span className={`badge bg-soft-${statusColor} text-${statusColor} fs-11 fw-bold text-uppercase`} style={{ letterSpacing: '0.08em' }}>
                                    {task.is_done ? 'DONE' : 'PENDING'}
                                </span>
                            </div>

                            {task.description && (
                                <div className="cs-task-desc mt-2 text-body" style={{ fontSize: '0.8125rem', lineHeight: 1.55 }}>
                                    {task.description}
                                </div>
                            )}

                            <div className="cs-task-meta d-flex align-items-center gap-2 mt-2 flex-wrap">
                                {task.created_by_name && (
                                    <span className="badge bg-soft-info text-info fs-11 fw-bold text-uppercase d-inline-flex align-items-center gap-1">
                                        <FiUser size={12} className="text-info" />
                                        <span>{task.created_by_name}</span>
                                    </span>
                                )}
                                {createdAtText && (
                                    <span className="badge bg-soft-warning text-warning fs-11 fw-bold text-uppercase d-inline-flex align-items-center gap-1">
                                        <FiCalendar size={12} className="text-warning" />
                                        <span>{createdAtText}</span>
                                    </span>
                                )}
                                {doneAtText && (
                                    <span className="badge bg-soft-success text-success fs-11 fw-bold text-uppercase d-inline-flex align-items-center gap-1">
                                        <FiCheckCircle size={12} className="text-success" />
                                        <span>{doneAtText}</span>
                                    </span>
                                )}
                            </div>
                        </div>

                        <div className="d-flex gap-2 flex-shrink-0 cs-task-actions">
                            {isPM && (
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        const ev = new CustomEvent('cs:open-edit-task-modal', { detail: task })
                                        window.dispatchEvent(ev)
                                    }}
                                    title="Edit task"
                                    className="cs-task-action-btn"
                                    style={{ background: '#3b82f6' }}
                                >
                                    <FiEdit2 size={14} strokeWidth={2} />
                                </button>
                            )}
                            {isPM && (
                                <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); onDelete(task) }}
                                    title="Delete task"
                                    className="cs-task-action-btn"
                                    style={{ background: '#ef4444' }}
                                >
                                    <FiTrash2 size={14} strokeWidth={2} />
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
