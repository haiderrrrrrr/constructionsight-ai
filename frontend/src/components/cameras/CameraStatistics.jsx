import React, { useEffect, useState } from 'react'
import getIcon from '@/utils/getIcon';
import { apiGet } from '@/utils/api';

const STAT_DEFS = [
    { status: "Total", key: "total", icon: "feather-monitor", color: "primary" },
    { status: "Healthy", key: "healthy", icon: "feather-arrow-up", color: "success" },
    { status: "Degraded", key: "degraded", icon: "feather-arrow-down", color: "warning" },
    { status: "Offline", key: "offline", icon: "feather-arrow-down", color: "danger" },
]

const CameraStatistics = () => {
    const [summary, setSummary] = useState({ total: 0, healthy: 0, degraded: 0, offline: 0, maintenance: 0 })

    useEffect(() => {
        apiGet('/admin/cameras/health')
            .then(data => { if (data) setSummary(data) })
            .catch(() => {})
    }, [])

    const total = summary.total || 0

    return (
        <>
            {STAT_DEFS.map(({ status, key, icon, color }) => {
                const count = summary[key] || 0
                const percentage = key === 'total' ? 100 : (total > 0 ? Math.round((count / total) * 100) : 0)
                return (
                    <div key={status} className="col-xxl-3 col-md-6">
                        <div className="card stretch stretch-full">
                            <div className="card-body">
                                <div className="d-flex align-items-center justify-content-between">
                                    <a href="#" className="fw-bold d-block">
                                        <span className="d-block">{status}</span>
                                        <span className="fs-20 fw-bold d-block">{count}{key !== 'total' && `/${total}`}</span>
                                    </a>
                                    <div className={`badge bg-soft-${color} text-${color}`}>
                                        {React.cloneElement(getIcon(icon), { size: 10, className: "me-1" })}
                                        <span>{percentage}%</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            })}
        </>
    )
}

export default CameraStatistics
