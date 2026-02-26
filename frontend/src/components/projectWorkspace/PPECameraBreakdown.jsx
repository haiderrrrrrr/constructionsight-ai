import React from 'react'
import PageLoader from '@/components/shared/PageLoader'

const statusBadge = (status) => {
    if (status === 'running') return <span className="badge badge-soft-success fs-10">Online</span>
    if (status === 'error') return <span className="badge badge-soft-danger fs-10">Error</span>
    return <span className="badge badge-soft-secondary fs-10">Idle</span>
}

const PPECameraBreakdown = ({ cameras, loading }) => {
    return (
        <div className="card stretch stretch-full h-100">
            <div className="card-header">
                <h5 className="card-title mb-0">Camera Breakdown</h5>
            </div>
            <div className="card-body p-0">
                {loading ? (
                    <PageLoader minHeight={180} />
                ) : cameras.length === 0 ? (
                    <div className="d-flex flex-column align-items-center justify-content-center text-center text-muted" style={{ minHeight: 220 }}>
                        <span className="fw-semibold d-block mb-1">No records available</span>
                        <span className="fs-12">No results for the current selection</span>
                    </div>
                ) : (
                    <div className="table-responsive">
                        <table className="table table-sm table-hover mb-0">
                            <thead className="table-light">
                                <tr>
                                    <th className="fs-12 fw-semibold">Camera</th>
                                    <th className="fs-12 fw-semibold text-center">Violations</th>
                                    <th className="fs-12 fw-semibold text-center">Compliance</th>
                                    <th className="fs-12 fw-semibold text-center">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {cameras.map(cam => (
                                    <tr key={cam.camera_id}>
                                        <td className="fs-12 text-truncate" style={{ maxWidth: 120 }}>
                                            {cam.camera_name}
                                        </td>
                                        <td className="text-center">
                                            <span className={`badge ${cam.violations_today > 0 ? 'badge-soft-danger' : 'badge-soft-success'} fs-10`}>
                                                {cam.violations_today}
                                            </span>
                                        </td>
                                        <td className="text-center">
                                            <span className={`fs-12 fw-semibold text-${cam.compliance_rate >= 90 ? 'success' : cam.compliance_rate >= 70 ? 'warning' : 'danger'}`}>
                                                {cam.compliance_rate}%
                                            </span>
                                        </td>
                                        <td className="text-center">{statusBadge(cam.worker_status)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    )
}

export default PPECameraBreakdown
