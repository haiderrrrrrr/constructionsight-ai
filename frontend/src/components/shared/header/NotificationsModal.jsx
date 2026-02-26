import React, { useEffect, useState } from 'react'
import {
    FiActivity, FiAlertCircle, FiArchive, FiBell, FiCheck, FiCheckCircle,
    FiClock, FiInfo, FiShield, FiUsers, FiWifi, FiX,
} from 'react-icons/fi'
import { Link } from 'react-router-dom'
import { apiGet, apiPatch, apiDelete, STREAM_BASE, refreshTokens, isTokenValid } from '@/utils/api'


function timeAgo(dateStr) {
    const date = new Date(dateStr)
    const diff = Math.floor((Date.now() - date.getTime()) / 1000)
    if (diff < 60) return 'just now'
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    const now = new Date()
    const opts = diff < 86400 * 365 && date.getFullYear() === now.getFullYear()
        ? { month: 'short', day: 'numeric' }
        : { month: 'short', day: 'numeric', year: 'numeric' }
    return date.toLocaleDateString(undefined, opts)
}

function notificationVisual(typeRaw) {
    const t = String(typeRaw || '').toLowerCase()
    if (t.includes('offline')) return { color: 'danger', Icon: FiWifi, label: 'Offline' }
    if (t.includes('degraded')) return { color: 'warning', Icon: FiActivity, label: 'Degraded' }
    if (t.includes('maintenance')) return { color: 'info', Icon: FiInfo, label: 'Maintenance' }
    if (t.includes('verify_failed') || (t.includes('verify') && t.includes('fail'))) return { color: 'danger', Icon: FiAlertCircle, label: 'Failed' }
    if (t.includes('verified')) return { color: 'success', Icon: FiCheckCircle, label: 'Verified' }
    if (t.includes('project_archived'))     return { color: 'warning', Icon: FiArchive,     label: 'Archived' }
    if (t.includes('project_unarchived'))   return { color: 'info',    Icon: FiShield,      label: 'Restored' }
    if (t.includes('project_activated'))    return { color: 'success', Icon: FiShield,      label: 'Activated' }
    if (t.includes('project_setup'))        return { color: 'info',    Icon: FiActivity,    label: 'Setup' }
    if (t.includes('archive')) return { color: 'info', Icon: FiArchive, label: 'Archived' }
    if (t.includes('health')) return { color: 'primary', Icon: FiActivity, label: 'Health' }
    if (t.includes('ppe_critical')) return { color: 'danger', Icon: FiShield, label: 'Critical' }
    if (t.includes('ppe_violation') || t.includes('ppe')) return { color: 'warning', Icon: FiAlertCircle, label: 'PPE' }
    if (t.includes('workforce_alert') || t.includes('workforce')) return { color: 'warning', Icon: FiUsers, label: 'Workforce' }
    if (t.includes('activity_alert') || t.includes('activity')) return { color: 'info', Icon: FiActivity, label: 'Activity' }
    if (t.includes('account_approved'))     return { color: 'success', Icon: FiCheckCircle, label: 'Approved' }
    if (t.includes('invitation_accepted'))  return { color: 'success', Icon: FiCheckCircle, label: 'Accepted' }
    if (t.includes('invitation_rejected'))  return { color: 'warning', Icon: FiAlertCircle, label: 'Rejected' }
    if (t.includes('member_removed'))       return { color: 'danger',  Icon: FiAlertCircle, label: 'Removed' }
    if (t.includes('task_completed'))       return { color: 'success', Icon: FiCheckCircle, label: 'Done' }
    if (t.includes('task_created'))         return { color: 'info',    Icon: FiClock,       label: 'Task' }
    if (t.includes('report_ready'))         return { color: 'success', Icon: FiCheckCircle, label: 'Report' }
    if (t.includes('report_failed') || t.includes('report_email_failed')) return { color: 'danger', Icon: FiAlertCircle, label: 'Report' }
    if (t.includes('camera_verify_failed')) return { color: 'danger',  Icon: FiAlertCircle, label: 'Failed' }
    if (t.includes('camera')) return { color: 'primary', Icon: FiShield, label: 'Camera' }
    return { color: 'secondary', Icon: FiBell, label: 'Notification' }
}

const NotificationsModal = () => {
    const [notifications, setNotifications] = useState([])
    const [showAll, setShowAll] = useState(false)

    const load = () => {
        apiGet('/notifications')
            .then(data => setNotifications(Array.isArray(data) ? data : []))
            .catch(() => {})
    }

    useEffect(() => {
        load()

        // SSE — use full backend URL so it works without a Vite proxy
        let es = null
        let closed = false
        let reconnectTimer = null

        async function connect() {
            if (es || closed) return

            // Ensure token is fresh before opening SSE
            if (!isTokenValid()) {
                const newToken = await refreshTokens()
                if (!newToken || closed) return
            }

            const token = window.sessionStorage.getItem('access_token')
            if (!token || closed) return

            try {
                const url = `${STREAM_BASE}/notifications/stream?token=${encodeURIComponent(token)}`
                es = new EventSource(url, { withCredentials: true })
                es.onmessage = (e) => {
                    try {
                        const notif = JSON.parse(e.data)
                        setNotifications(prev => [notif, ...prev].slice(0, 100))
                    } catch (_) {}
                }
                es.onerror = async () => {
                    if (es) { es.close(); es = null }
                    if (closed) return
                    // Silently refresh and reconnect — no error shown to user
                    const newToken = await refreshTokens()
                    if (newToken && !closed) {
                        reconnectTimer = setTimeout(() => { if (!closed) connect() }, 1000)
                    }
                }
            } catch (_) {}
        }

        function disconnect() {
            clearTimeout(reconnectTimer)
            if (es) { es.close(); es = null }
        }

        function onVisibilityChange() {
            if (document.hidden) {
                disconnect()
            } else {
                load()  // re-fetch to catch anything missed while hidden
                connect()
            }
        }

        if (!document.hidden) connect()
        document.addEventListener('visibilitychange', onVisibilityChange)

        return () => {
            closed = true
            document.removeEventListener('visibilitychange', onVisibilityChange)
            disconnect()
        }
    }, [])

    const unread = notifications.filter(n => !n.is_read).length
    const displayed = showAll ? notifications : notifications.slice(0, 15)

    const markAllRead = (e) => {
        e.preventDefault()
        apiPatch('/notifications/mark-all-read', {})
            .then(() => setNotifications(prev => prev.map(n => ({ ...n, is_read: true }))))
            .catch(() => {})
    }

    const markRead = (id) => {
        apiPatch(`/notifications/${id}/read`, {})
            .then(() => setNotifications(prev =>
                prev.map(n => n.id === id ? { ...n, is_read: true } : n)
            ))
            .catch(() => {})
    }

    const dismiss = (id) => {
        setNotifications(prev => prev.filter(n => n.id !== id))
        apiDelete(`/notifications/${id}`).catch(() => {})
    }

    return (
        <div className="dropdown nxl-h-item">
            <div className="nxl-head-link me-3" data-bs-toggle="dropdown" role="button" data-bs-auto-close="outside">
                <FiBell size={20} />
                {unread > 0 && (
                    <span className="badge bg-danger nxl-h-badge">{unread > 99 ? '99+' : unread}</span>
                )}
            </div>
            <div className="dropdown-menu dropdown-menu-end nxl-h-dropdown nxl-notifications-menu" style={{ minWidth: '420px', width: '420px' }}>
                <style>{`
                    .nxl-notifications-menu { min-width: 420px !important; width: 420px !important; }
                    .cs-notif-head { padding: 14px 16px; }
                    .cs-notif-item { padding: 12px 16px; display: flex; gap: 12px; align-items: flex-start; cursor: pointer; }
                    .cs-notif-item:hover { background: rgba(var(--bs-primary-rgb), 0.06); }
                    .cs-notif-item.unread { background: rgba(var(--bs-primary-rgb), 0.03); }
                    html.app-skin-dark .cs-notif-item:hover { background: rgba(255,255,255,0.06); }
                    html.app-skin-dark .cs-notif-item.unread { background: rgba(255,255,255,0.03); }
                    .cs-notif-avatar { width: 40px; height: 40px; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; }
                    .cs-notif-title { display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; font-size: 13px; }
                    .cs-notif-msg { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 12px; margin-top: 2px; }
                    .cs-notif-actions { display: inline-flex; align-items: center; gap: 8px; flex-shrink: 0; }
                    .cs-notif-dot { width: 8px; height: 8px; border-radius: 999px; display: inline-block; transition: background 0.2s; }
                    .cs-notif-time { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; }
                    .cs-notif-dismiss { display: inline-flex; align-items: center; cursor: pointer; color: #b91c1c !important; opacity: 0.55; transition: opacity 0.15s, color 0.15s; }
                    .cs-notif-item:hover .cs-notif-dismiss { opacity: 1; }
                    html.app-skin-dark .cs-notif-dismiss { color: #ef4444 !important; opacity: 0.9; }
                    html.app-skin-dark .cs-notif-item:hover .cs-notif-dismiss { opacity: 1; color: #f87171 !important; }
                    html.app-skin-dark .cs-notif-dismiss svg { color: #ef4444 !important; }
                    html.app-skin-dark .cs-notif-item:hover .cs-notif-dismiss svg { color: #f87171 !important; }
                    .cs-notif-dot-unread { background: #16a34a !important; cursor: pointer; }
                    .cs-notif-dot-read { background: #6b7280 !important; opacity: 0.35; cursor: default; }
                    .cs-notif-markall { color: #16a34a !important; }
                    .cs-notif-markall:hover { color: #15803d !important; }
                    html.app-skin-dark .cs-notif-markall { color: #22c55e !important; }
                    html.app-skin-dark .cs-notif-markall:hover { color: #4ade80 !important; }
                    .cs-notif-markall svg { color: currentColor !important; }
                    html.app-skin-dark .cs-notif-markall svg { color: currentColor !important; }
                `}</style>

                {/* Header */}
                <div className="d-flex align-items-center justify-content-between px-3 py-2 border-bottom">
                    <div className="d-flex align-items-center gap-2">
                        <h6 className="fw-bold mb-0" style={{ fontSize: '14px' }}>Notifications</h6>
                        {unread > 0 && (
                            <span className="badge bg-danger" style={{ fontSize: '10px', padding: '2px 6px' }}>{unread} new</span>
                        )}
                    </div>
                    {unread > 0 && (
                        <Link to="#" className="cs-notif-markall fs-11 d-flex align-items-center gap-1" onClick={markAllRead}>
                            <FiCheck size={13} />
                            <span>Mark all read</span>
                        </Link>
                    )}
                </div>

                {/* List */}
                <div style={{ maxHeight: '460px', overflowY: 'auto' }}>
                    {notifications.length === 0 ? (
                        <div className="text-center text-muted py-4" style={{ fontSize: '13px' }}>
                            <FiBell size={28} className="mb-2 opacity-25 d-block mx-auto" />
                            No notifications yet
                        </div>
                    ) : (
                        displayed.map(n => (
                            <Card
                                key={n.id}
                                id={n.id}
                                time={timeAgo(n.created_at)}
                                titleFirst={n.title}
                                titleSecond={n.message}
                                type={n.type}
                                isRead={n.is_read}
                                onRead={markRead}
                                onDismiss={dismiss}
                                actionUrl={n.action_url}
                            />
                        ))
                    )}
                </div>

                {/* Footer */}
                {notifications.length > 15 && (
                    <div className="text-center border-top py-2">
                        <Link
                            to="#"
                            className="fs-12 fw-semibold text-primary"
                            onClick={(e) => { e.preventDefault(); setShowAll(v => !v) }}
                        >
                            {showAll ? 'Show less' : `View all ${notifications.length} notifications`}
                        </Link>
                    </div>
                )}
                {notifications.length > 0 && notifications.length <= 15 && (
                    <div className="text-center border-top py-2">
                        <span className="fs-12 text-muted">You're all caught up</span>
                    </div>
                )}
            </div>
        </div>
    )
}

export default NotificationsModal


const Card = ({ id, time, titleFirst, titleSecond, type, isRead, onRead, onDismiss }) => {
    const v = notificationVisual(type)
    const Icon = v.Icon
    return (
        <div
            className={`notifications-item cs-notif-item${!isRead ? ' unread' : ''}`}
        >
            <span className={`cs-notif-avatar bg-soft-${v.color} text-${v.color}`}>
                <Icon size={17} />
            </span>
            <div className="notifications-desc flex-grow-1" style={{ minWidth: 0 }}>
                <div className="d-flex align-items-start justify-content-between gap-2">
                    <div style={{ minWidth: 0 }}>
                        <div className="fw-semibold text-dark cs-notif-title">{titleFirst}</div>
                        <div className="text-muted cs-notif-msg">{titleSecond}</div>
                    </div>
                    <span className="cs-notif-actions">
                        {/* Blue dot = unread, grey = read. Click to mark read */}
                        <span
                            className={`cs-notif-dot ${isRead ? 'cs-notif-dot-read' : 'cs-notif-dot-unread'}`}
                            title={isRead ? 'Read' : 'Click to mark read'}
                            onClick={(e) => { e.stopPropagation(); if (!isRead) onRead(id) }}
                        />
                        {/* Dismiss — deletes from DB */}
                        <span
                            className="cs-notif-dismiss"
                            title="Dismiss"
                            onClick={(e) => { e.stopPropagation(); onDismiss(id) }}
                        >
                            <FiX size={14} />
                        </span>
                    </span>
                </div>
                <div className="d-flex align-items-center justify-content-between mt-1">
                    <span className={`badge bg-soft-${v.color} text-${v.color}`} style={{ fontSize: '10px', padding: '2px 6px' }}>
                        {v.label}
                    </span>
                    <div className="cs-notif-time text-muted">
                        <FiClock size={11} className="opacity-50" />
                        <span>{time}</span>
                    </div>
                </div>
            </div>
        </div>
    )
}
