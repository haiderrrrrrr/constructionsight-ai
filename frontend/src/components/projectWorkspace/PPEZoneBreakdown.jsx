import React from 'react'

const PPEZoneBreakdown = ({ zones, loading }) => {
    const rows = Array.isArray(zones) ? zones : []
    return (
        <div className="card stretch stretch-full">
            <div className="card-header">
                <div>
                    <h5 className="mb-0">Violation Summary</h5>
                    <span className="fs-12 text-muted">Distribution of safety violations across all monitored zones</span>
                </div>
            </div>
            <div className="card-body custom-card-action p-0">
                {loading ? (
                    <div className="d-flex align-items-center justify-content-center py-5">
                        <div className="spinner-border spinner-border-sm text-primary" role="status" />
                    </div>
                ) : rows.length === 0 ? (
                    <div className="d-flex flex-column align-items-center justify-content-center text-center text-muted" style={{ minHeight: 220 }}>
                        <span className="fw-semibold d-block mb-1">No records available</span>
                        <span className="fs-12">No results for the current selection</span>
                    </div>
                ) : (
                    <div className="table-responsive pm-table-wrap ppe-zone-breakdown-table">
                        <table className="table table-hover mb-0 align-middle">
                            <colgroup>
                                <col style={{ width: '12%' }} />
                                <col style={{ width: '18%' }} />
                                <col style={{ width: '15%' }} />
                                <col style={{ width: '15%' }} />
                                <col style={{ width: '15%' }} />
                                <col style={{ width: '15%' }} />
                                <col style={{ width: '10%' }} />
                            </colgroup>
                            <thead>
                                <tr className="border-b">
                                    <th scope="row" className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Zone</th>
                                    <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Camera</th>
                                    <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Total Violations</th>
                                    <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Helmet Violations</th>
                                    <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Vest Violations</th>
                                    <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Critical Violations</th>
                                    <th className="fs-11 text-uppercase text-end" style={{ letterSpacing: '0.06em' }}>
                                        <span className="d-inline-block text-start" style={{ width: 100 }}>Active Incidents</span>
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((z, i) => (
                                    <tr key={i}>
                                        <td>
                                            <span
                                                className="pm-pill pm-pill-warning"
                                                style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                            >
                                                {z.zone_name}
                                            </span>
                                        </td>
                                        <td>
                                            <span
                                                className="badge bg-soft-success text-success fs-11 fw-semibold"
                                                style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                            >
                                                {z.camera_name || '—'}
                                            </span>
                                        </td>
                                        <td>
                                            <span className="badge fs-11 bg-soft-danger text-danger">
                                                {z.violations_today ?? 0}
                                            </span>
                                        </td>
                                        <td>
                                            <span className="badge fs-11 bg-soft-warning text-warning">
                                                {z.helmet_violations ?? 0}
                                            </span>
                                        </td>
                                        <td>
                                            <span className="badge fs-11 bg-soft-warning text-warning">
                                                {z.vest_violations ?? 0}
                                            </span>
                                        </td>
                                        <td>
                                            <span className="badge fs-11 bg-soft-warning text-warning">
                                                {z.critical_violations ?? 0}
                                            </span>
                                        </td>
                                        <td className="text-end">
                                            <div className="d-flex justify-content-end">
                                                <span className="d-inline-flex justify-content-start" style={{ width: 100 }}>
                                                <span className="badge fs-11 bg-soft-info text-info" style={{ transform: 'translateY(1px)' }}>
                                                        {z.open_incidents ?? 0}
                                                    </span>
                                                </span>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <style>{`
                .pm-table-wrap { border-radius: 0.5rem; overflow: hidden; }
                .pm-table-wrap .table > :not(caption) > * > * { padding: 0.95rem 0.85rem; }
                .ppe-zone-breakdown-table .table { width: 100%; table-layout: fixed; }
                .pm-table-wrap .table td { vertical-align: middle; }
                .pm-table-wrap .table td { text-align: left; }
                .ppe-zone-breakdown-table th:first-child,
                .ppe-zone-breakdown-table td:first-child {
                    padding-left: 15px !important;
                }
                .ppe-zone-breakdown-table th:last-child,
                .ppe-zone-breakdown-table td:last-child {
                    padding-right: 15px !important;
                }
                .pm-pill {
                    display: inline-flex;
                    align-items: center;
                    padding: 0.45rem 0.65rem;
                    border-radius: var(--bs-border-radius);
                    font-size: 11px;
                    font-weight: 600;
                    letter-spacing: 0.06em;
                    text-transform: uppercase;
                    line-height: 1;
                }
                .pm-pill-warning {
                    background: rgba(var(--bs-warning-rgb), 1);
                    border: 0;
                    color: #fff;
                }
            `}</style>
        </div>
    )
}

export default PPEZoneBreakdown
