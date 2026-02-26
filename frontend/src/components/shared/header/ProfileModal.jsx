import React, { useState, useEffect } from 'react'
import { FiLogOut, FiUser } from "react-icons/fi"
import { Link, useLocation } from 'react-router-dom'
import { apiGet } from '@/utils/api'

const closeAll = () => window.dispatchEvent(new Event('cs:close-right-panel'))

const ProfileModal = () => {
    const location = useLocation()
    const isAdminPanel = location.pathname.startsWith('/admin')
    const projectMatch = location.pathname.match(/^\/projects\/(\d+)/)
    const profileLink = isAdminPanel
        ? '/admin/profile'
        : projectMatch
            ? `/projects/${projectMatch[1]}/profile`
            : '/profile'

    const [user, setUser] = useState(null)

    useEffect(() => {
        const loadUser = () => {
            apiGet('/users/me')
                .then(data => {
                    setUser(data)
                })
                .catch(() => {
                    setUser(null)
                })
        }
        loadUser()

        const handleAvatarUpdate = () => loadUser()
        window.addEventListener('avatar:updated', handleAvatarUpdate)
        return () => window.removeEventListener('avatar:updated', handleAvatarUpdate)
    }, [])

    const avatarUrl = user?.avatar_url || '/images/icons/profile-picture.png'

    return (
        <>
            <style>{`
                .cam-logo-circle { background: var(--bs-secondary-bg); }
                html.app-skin-dark .cam-logo-circle { background: rgba(255,255,255,0.08); border: 0 !important; }
                .nxl-user-dropdown .dropdown-item { display: flex; align-items: center; gap: 10px; }
                .nxl-user-dropdown .dropdown-item i { display: inline-flex; align-items: center; }
                .nxl-user-dropdown .dropdown-item i svg { color: currentColor; }
                html.app-skin-dark .nxl-user-dropdown .dropdown-item i svg { color: currentColor !important; }

                .nxl-user-dropdown .dropdown-item.text-danger { color: #ef4444 !important; }
                .nxl-user-dropdown .dropdown-item.text-danger:hover,
                .nxl-user-dropdown .dropdown-item.text-danger:focus,
                .nxl-user-dropdown .dropdown-item.text-danger:active {
                    color: #ef4444 !important;
                    background-color: rgba(239, 68, 68, 0.1);
                }
                .nxl-user-dropdown .dropdown-item.text-danger i svg,
                .nxl-user-dropdown .dropdown-item.text-danger i svg * {
                    color: #ef4444 !important;
                    stroke: #ef4444 !important;
                }
            `}</style>
            <div className="dropdown nxl-h-item">
                <a href="#" data-bs-toggle="dropdown" role="button" className="cam-logo-circle" style={{ width: 40, height: 40, borderRadius: '50%', overflow: 'hidden', border: '2px solid var(--bs-border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <img
                        src={avatarUrl}
                        alt="user-image"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        data-fallback="0"
                        onError={(e) => {
                            if (e.currentTarget.dataset.fallback === '0') {
                                e.currentTarget.dataset.fallback = '1'
                                e.currentTarget.src = '/images/icons/profile-picture.png'
                                e.currentTarget.style.objectFit = 'cover'
                                return
                            }
                        }}
                    />
                </a>
                <div className="dropdown-menu dropdown-menu-end nxl-h-dropdown nxl-user-dropdown">
                    <div className="dropdown-header">
                        <div className="d-flex align-items-center gap-3">
                            <div className="flex-shrink-0 cam-logo-circle" style={{ width: 46, height: 46, borderRadius: '50%', overflow: 'hidden', border: '2px solid var(--bs-border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <img
                                    src={avatarUrl}
                                    alt="user-image"
                                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                    data-fallback="0"
                                    onError={(e) => {
                                        if (e.currentTarget.dataset.fallback === '0') {
                                            e.currentTarget.dataset.fallback = '1'
                                            e.currentTarget.src = '/images/icons/profile-picture.png'
                                            e.currentTarget.style.objectFit = 'cover'
                                            return
                                        }
                                    }}
                                />
                            </div>
                            <div className="flex-grow-1">
                                <h6 className="mb-0">{user?.full_name || user?.username || 'User'}</h6>
                                <small className="d-block text-muted">{user?.email}</small>
                            </div>
                        </div>
                    </div>
                    <Link to={profileLink} className="dropdown-item" onClick={closeAll}>
                        <i><FiUser /></i>
                        <span>Account Settings</span>
                    </Link>
                    <div className="dropdown-divider"></div>
                    <Link to="/logout" className="dropdown-item text-danger" onClick={closeAll}>
                        <i><FiLogOut /></i>
                        <span>Logout</span>
                    </Link>
                </div>
            </div>
        </>
    )
}

export default ProfileModal
