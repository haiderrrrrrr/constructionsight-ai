import React from 'react'
import { Link } from 'react-router-dom'

const ErrorCover = () => {
    return (
        <main className="auth-cover-wrapper">
            <div className="auth-cover-content-inner">
                <div className="auth-cover-content-wrapper">
                    <div className="auth-img">
                        <img src="/images/auth/auth-cover-404-bg.svg" alt="img" className="img-fluid" />
                    </div>
                </div>
            </div>
            <div className="auth-cover-sidebar-inner">
                <div className="auth-cover-card-wrapper">
                    <div className="auth-cover-card p-sm-5">
                        <div className="d-flex align-items-center gap-3 mb-5">
                            <div className="wd-50 flex-shrink-0">
                                <img src="/images/logo-abbr.png" alt="img" className="img-fluid" />
                            </div>
                            <img src="/images/logo-full.png" alt="ConstructionSight" className="auth-logo-full" style={{ height: '17px', width: 'auto' }} />
                        </div>
                        <h4 className="fw-bold mb-2">Access Restricted or Page Unavailable</h4>
                        <p className="fs-12 fw-medium text-muted">The resource you requested does not exist, has been moved, or you do not have permission to access it. Please verify the URL or return to your dashboard.</p>
                        <h2 className="fw-bolder mb-4" style={{ fontSize: 120 }}>4<span className="text-danger">0</span>4</h2>
                        <div className="mt-5">
                            <Link to="/projects/my" className="btn btn-danger w-100">Back to Dashboard</Link>
                        </div>
                    </div>
                </div>
            </div>
        </main>

    )
}

export default ErrorCover