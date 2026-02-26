import React, { useEffect, useState, useCallback } from 'react'
import { apiGet } from '@/utils/api'
import { onBroadcast } from '@/utils/broadcast'

const AdminProjectsStatistics = () => {
    const [stats, setStats] = useState({ active: 0, archived: 0, total: 0 })

    const load = useCallback(() => {
        apiGet('/admin/projects')
            .then(data => {
                const counts = { active: 0, archived: 0, total: 0 }
                ;(data || []).forEach(p => {
                    counts.total++
                    if (counts[p.status] !== undefined) counts[p.status]++
                })
                setStats(counts)
            })
            .catch(() => {})
    }, [])

    useEffect(() => {
        load()
    }, [load])

    // Broadcast listener for project status changes
    useEffect(() => {
        const handler = () => load()
        window.addEventListener('cs:projects-stats-refresh', handler)
        const unsub = onBroadcast('cs:projects-stats-refresh', handler)
        return () => {
            window.removeEventListener('cs:projects-stats-refresh', handler)
            unsub()
        }
    }, [load])

    const cards = [
        { label: 'Active', count: stats.active, description: 'Active Projects', detail: `${stats.total} Total`, pct: stats.total ? Math.round((stats.active / stats.total) * 100) : 0, color: 'bg-success' },
        { label: 'Archived', count: stats.archived, description: 'Archived Projects', detail: `${stats.total} Total`, pct: stats.total ? Math.round((stats.archived / stats.total) * 100) : 0, color: 'bg-danger' },
        { label: 'Total', count: stats.total, description: 'Total projects', detail: `${stats.total} Total`, pct: stats.total ? 100 : 0, color: 'bg-warning' },
        { label: 'Total', count: stats.total, description: 'Total projects', detail: `${stats.total} Total`, pct: stats.total ? 100 : 0, color: 'bg-warning' },
    ]

    return (
        <>
            {cards.map((c, i) => (
                <div key={i} className="col-xxl-3 col-md-6">
                    <div className="card stretch stretch-full">
                        <div className="card-body">
                            <a href="#" className="fw-bold d-block">
                                <span className="d-block">{c.label}</span>
                                <span className="fs-24 fw-bolder d-block">{String(c.count).padStart(2, '0')}</span>
                            </a>
                            <div className="pt-4">
                                <div className="d-flex align-items-center justify-content-between">
                                    <a href="#" className="fs-12 fw-medium text-muted">
                                        <span>{c.description}</span>
                                    </a>
                                    <div>
                                        <span className="fs-12 text-muted">{c.pct}% of total</span>
                                    </div>
                                </div>
                                <div className="progress mt-2 ht-3">
                                    <div className={`progress-bar ${c.color}`} role="progressbar" style={{ width: `${c.pct}%` }} />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            ))}
        </>
    )
}

export default AdminProjectsStatistics
