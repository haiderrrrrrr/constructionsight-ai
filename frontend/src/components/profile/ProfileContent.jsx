import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FiCamera, FiTrash2, FiUser, FiAtSign, FiLock, FiSave, FiX, FiKey, FiMail, FiCalendar, FiLayers, FiEye, FiEyeOff } from 'react-icons/fi'
import { apiPatch, apiDelete, apiUpload, API_BASE } from '@/utils/api'
import { parseApiError } from '@/utils/errorHandler'
import topTostError from '@/utils/topTostError'
import useImageUpload from '@/hooks/useImageUpload'

const ProfileContent = ({ user, setUser, isEditing, setIsEditing }) => {
    const navigate = useNavigate()
    const [formData, setFormData] = useState({
        full_name: user?.full_name || '',
        username: user?.username || '',
        current_password: ''
    })
    const [passwordData, setPasswordData] = useState({
        current_password: '',
        new_password: '',
        confirm_password: ''
    })
    const [errors, setErrors] = useState({})
    const [passwordErrors, setPasswordErrors] = useState({})
    const [loading, setLoading] = useState(false)
    const { handleImageUpload, uploadedImage } = useImageUpload()
    const [showProfileCurrentPassword, setShowProfileCurrentPassword] = useState(false)
    const [showSecurityPassword, setShowSecurityPassword] = useState(false)

    const LABEL = 'fs-11 fw-semibold text-muted text-uppercase mb-1'
    const LABEL_STYLE = { letterSpacing: '0.06em' }

    // Validation helpers (same as signup)
    const validateFullName = (name) => {
        if (!name.trim()) return 'Full name is required'
        if (name.length < 2) return 'Full name must be at least 2 characters'
        if (name.length > 100) return 'Full name must be under 100 characters'
        if (!/^[A-Za-z][A-Za-z\s'\-.]{1,99}$/.test(name)) return 'Full name must contain only letters, spaces, apostrophes, hyphens, or dots'
        return null
    }

    const validateUsername = (username) => {
        if (!username.trim()) return 'Username is required'
        if (username.length < 3) return 'Username must be at least 3 characters'
        if (username.length > 30) return 'Username must be under 30 characters'
        if (!/^[a-z][a-z0-9_.-]{2,29}$/.test(username.toLowerCase())) return 'Username must start with a letter and include only letters, digits, _, ., or -'
        return null
    }

    const handleInputChange = (e) => {
        const { name, value } = e.target
        setFormData(prev => ({ ...prev, [name]: value }))
        setErrors(prev => ({ ...prev, [name]: '' }))

        // Real-time validation feedback
        if (name === 'full_name') {
            const err = validateFullName(value)
            if (err && value.length > 0) setErrors(prev => ({ ...prev, full_name: err }))
        } else if (name === 'username') {
            const err = validateUsername(value)
            if (err && value.length > 0) setErrors(prev => ({ ...prev, username: err }))
        }
    }

    const handlePasswordChange = (e) => {
        const { name, value } = e.target
        setPasswordData(prev => ({ ...prev, [name]: value }))
        setPasswordErrors(prev => ({ ...prev, [name]: '' }))
    }

    const handleAvatarUpload = async (e) => {
        const file = e.target.files?.[0]
        if (!file) return

        // Validate file type
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
        if (!allowedTypes.includes(file.type)) {
            topTostError('Only JPEG, PNG, WebP, or GIF images are allowed', 'error')
            return
        }

        // Validate file size (5MB)
        if (file.size > 5 * 1024 * 1024) {
            topTostError('Image must be less than 5MB', 'error')
            return
        }

        try {
            setLoading(true)
            const result = await apiUpload('/users/me/avatar', file)
            setUser(prev => ({ ...prev, avatar_url: result.avatar_url }))
            topTostError('Avatar uploaded successfully', 'success')
            // Reset file input
            e.target.value = ''
        } catch (err) {
            let errorMessage = 'Failed to upload avatar'

            if (err.response?.data) {
                const data = err.response.data
                if (Array.isArray(data.detail) && data.detail.length > 0) {
                    const firstError = data.detail[0]
                    if (typeof firstError === 'string') {
                        errorMessage = firstError
                    } else if (typeof firstError === 'object' && firstError !== null) {
                        errorMessage = firstError.msg || firstError.message || 'Upload failed'
                    }
                } else if (typeof data.detail === 'string') {
                    errorMessage = data.detail
                } else {
                    errorMessage = data.message || data.error || 'Upload failed'
                }
            } else if (err.message) {
                errorMessage = err.message
            }

            // Ensure clean string, never show raw JSON
            if (typeof errorMessage !== 'string') {
                errorMessage = String(errorMessage)
            }

            // If error looks like JSON stringified, extract the detail
            if (errorMessage.startsWith('{') && errorMessage.includes('detail')) {
                try {
                    const parsed = JSON.parse(errorMessage)
                    if (parsed.detail) {
                        if (typeof parsed.detail === 'string') {
                            errorMessage = parsed.detail
                        } else if (Array.isArray(parsed.detail) && parsed.detail.length > 0) {
                            const firstErr = parsed.detail[0]
                            errorMessage = typeof firstErr === 'string' ? firstErr : (firstErr.msg || firstErr.message || 'Upload failed')
                        }
                    }
                } catch (e) {
                    // Keep original if JSON parse fails
                }
            }

            topTostError(errorMessage.trim(), 'error')
        } finally {
            setLoading(false)
        }
    }

    const handleRemoveAvatar = async () => {
        try {
            setLoading(true)
            await apiDelete('/users/me/avatar')
            setUser(prev => ({ ...prev, avatar_url: null }))
            topTostError('Avatar removed', 'success')
        } catch (err) {
            topTostError(err.response?.data?.detail || 'Failed to remove avatar', 'error')
        } finally {
            setLoading(false)
        }
    }

    const handleSaveProfile = async () => {
        // Validate all fields first
        const newErrors = {}

        if (formData.full_name) {
            const err = validateFullName(formData.full_name)
            if (err) newErrors.full_name = err
        }

        if (formData.username) {
            const err = validateUsername(formData.username)
            if (err) newErrors.username = err
        }

        if (user?.auth_provider !== 'google' && !formData.current_password) {
            newErrors.current_password = 'Current password is required to save changes'
        }

        if (Object.keys(newErrors).length > 0) {
            setErrors(newErrors)
            return
        }

        try {
            setLoading(true)
            const payload = {
                full_name: formData.full_name || undefined,
                username: formData.username || undefined,
            }
            if (user?.auth_provider !== 'google') {
                payload.current_password = formData.current_password
            }
            const result = await apiPatch('/users/me/profile', payload)
            setUser(result)
            setFormData(prev => ({ ...prev, current_password: '' }))
            setIsEditing(false)
            topTostError('Profile updated successfully', 'success')
        } catch (err) {
            let errorMessage = 'Failed to update profile'

            if (err.response?.data) {
                const data = err.response.data

                // Handle Pydantic validation errors (array format)
                if (Array.isArray(data.detail)) {
                    const errors = data.detail
                    if (errors.length > 0) {
                        const firstError = errors[0]
                        // Extract message from error object
                        if (typeof firstError === 'string') {
                            errorMessage = firstError
                        } else if (typeof firstError === 'object' && firstError !== null) {
                            errorMessage = firstError.msg || firstError.message || 'Validation failed'
                        }
                    }
                }
                // Handle HTTPException errors (string format)
                else if (typeof data.detail === 'string') {
                    errorMessage = data.detail
                }
                // Fallback to other fields
                else {
                    errorMessage = data.message || data.error || 'Failed to update profile'
                }
            } else if (err.message) {
                errorMessage = err.message
            }

            // Ensure we have a clean string, never show raw JSON
            if (typeof errorMessage !== 'string') {
                errorMessage = String(errorMessage)
            }

            // If error looks like JSON stringified, try to extract the detail
            if (errorMessage.startsWith('{') && errorMessage.includes('detail')) {
                try {
                    const parsed = JSON.parse(errorMessage)
                    if (parsed.detail) {
                        if (typeof parsed.detail === 'string') {
                            errorMessage = parsed.detail
                        } else if (Array.isArray(parsed.detail) && parsed.detail.length > 0) {
                            const firstErr = parsed.detail[0]
                            errorMessage = typeof firstErr === 'string' ? firstErr : (firstErr.msg || firstErr.message || 'Validation failed')
                        }
                    }
                } catch (e) {
                    // Keep original if JSON parse fails
                }
            }

            topTostError(errorMessage.trim(), 'error')
        } finally {
            setLoading(false)
        }
    }

    const handleChangePassword = async () => {
        const newErrors = {}

        if (!passwordData.current_password) {
            newErrors.current_password = 'Current password is required'
        }

        if (!passwordData.new_password) {
            newErrors.new_password = 'New password is required'
        }

        if (passwordData.new_password !== passwordData.confirm_password) {
            newErrors.confirm_password = 'Passwords do not match'
        }

        if (Object.keys(newErrors).length > 0) {
            setPasswordErrors(newErrors)
            return
        }

        try {
            setLoading(true)
            await apiPatch('/users/me/password', {
                current_password: passwordData.current_password,
                new_password: passwordData.new_password
            })
            // Immediately clear all tokens and session data
            sessionStorage.removeItem('access_token')
            sessionStorage.removeItem('cs_session')
            localStorage.removeItem('cs_remember')
            setPasswordData({ current_password: '', new_password: '', confirm_password: '' })
            setPasswordErrors({})
            topTostError('Password changed successfully. Logging out now...', 'success')
            // Fire-and-forget: clears the refresh cookie from the browser server-side
            fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {})
            // Use replace: true so back button doesn't return to broken profile page
            navigate('/login', { replace: true })
        } catch (err) {
            // Use parseApiError to handle both Axios and plain Error styles + strip "Value error, " prefix
            const msg = parseApiError(err, 'Failed to change password')
            topTostError(msg, 'error')
        } finally {
            setLoading(false)
        }
    }

    const avatarUrl = user?.avatar_url || '/images/icons/profile-picture.png'

    return (
        <>
            <style>{`
                .profile-avatar-lg { background: var(--bs-secondary-bg); }
                html.app-skin-dark .profile-avatar-lg { background: rgba(255,255,255,0.08); border: 0 !important; }
                .cs-profile-name { color: rgba(2,6,23,0.92); }
                html.app-skin-dark .cs-profile-name { color: rgba(255,255,255,0.92); }
                .cs-profile-email { color: rgba(2,6,23,0.62); }
                html.app-skin-dark .cs-profile-email { color: rgba(255,255,255,0.62); }
                .cs-avatar-btn {
                    width: 36px;
                    height: 36px;
                    border-radius: 999px;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    background: rgba(var(--bs-primary-rgb), 0.10);
                    border: 1px solid rgba(var(--bs-primary-rgb), 0.22);
                    color: var(--bs-primary);
                    box-shadow: 0 10px 28px rgba(0,0,0,0.18);
                }
                html.app-skin-dark .cs-avatar-btn {
                    background: rgba(var(--bs-primary-rgb), 0.16);
                    border-color: rgba(var(--bs-primary-rgb), 0.28);
                }
                .cs-avatar-btn-pos {
                    position: absolute;
                    bottom: 6px;
                    right: 6px;
                    transform: translate(35%, 35%);
                }
                .cs-prof-row { border-bottom: 1px solid rgba(148,163,184,0.35); padding: 12px 0; }
                html.app-skin-dark .cs-prof-row { border-bottom: 1px solid rgba(255,255,255,0.10); }
                .cs-prof-icon {
                    width: 28px;
                    height: 28px;
                    border-radius: 8px;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    background: rgba(2,6,23,0.06);
                    color: rgba(2,6,23,0.70);
                    flex: 0 0 auto;
                }
                html.app-skin-dark .cs-prof-icon {
                    background: rgba(255,255,255,0.08);
                    color: rgba(255,255,255,0.72);
                }
                .cs-prof-label { font-size: 10px; font-weight: 800; letter-spacing: 0.10em; text-transform: uppercase; color: rgba(2,6,23,0.55); }
                html.app-skin-dark .cs-prof-label { color: rgba(255,255,255,0.62); }
                .cs-prof-val { color: rgba(2,6,23,0.88); font-size: 12px; font-weight: 600; }
                html.app-skin-dark .cs-prof-val { color: rgba(255,255,255,0.88); }
                .cs-prof-stat {
                    background: rgba(255,255,255,0.02);
                    border: 1px dashed rgba(148,163,184,0.55);
                }
                html.app-skin-dark .cs-prof-stat {
                    background: rgba(255,255,255,0.03);
                    border-color: rgba(255,255,255,0.12);
                }
                .cs-prof-stat-green {
                    background: #22c55e !important;
                    border: 1px solid rgba(34,197,94,0.35) !important;
                }
                html.app-skin-dark .cs-prof-stat-green {
                    background: #22c55e !important;
                    border-color: rgba(34,197,94,0.35) !important;
                }
                .cs-prof-stat-orange {
                    background: #f59e0b !important;
                    border: 1px solid rgba(245,158,11,0.35) !important;
                }
                html.app-skin-dark .cs-prof-stat-orange {
                    background: #f59e0b !important;
                    border-color: rgba(245,158,11,0.35) !important;
                }
                .cs-prof-stat-solid .cs-prof-stat-title { color: rgba(255,255,255,0.95) !important; }
                .cs-prof-stat-solid .cs-prof-stat-val { color: #fff !important; }
                .cs-prof-stat-solid { box-shadow: 0 10px 28px rgba(0,0,0,0.18); }
                html.app-skin-dark .cs-prof-stat-solid { box-shadow: 0 14px 34px rgba(0,0,0,0.35); }
                .cs-prof-stat-title { font-size: 10px; font-weight: 800; letter-spacing: 0.10em; text-transform: uppercase; color: rgba(2,6,23,0.55); }
                html.app-skin-dark .cs-prof-stat-title { color: rgba(255,255,255,0.62); }
                .cs-prof-stat-val { font-size: 13px; font-weight: 700; color: rgba(2,6,23,0.88); }
                html.app-skin-dark .cs-prof-stat-val { color: rgba(255,255,255,0.88); }
                .cs-prof-btn { font-size: 11px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; padding: 10px 14px; }
                .customers-nav-tabs { margin-bottom: -1px; }
                html.app-skin-dark .customers-nav-tabs .nav-item.border-top { border-top-color: rgba(255,255,255,0.10) !important; }
                .customers-nav-tabs .nav-item .nav-link {
                    border: none;
                    padding: 20px 30px;
                    color: var(--bs-body-color);
                    font-weight: 600;
                    border-radius: 0;
                    border-bottom: 3px solid transparent;
                    transition: all 0.3s ease;
                }
                .customers-nav-tabs .nav-item .nav-link.active {
                    color: var(--bs-primary);
                    border-bottom: 3px solid var(--bs-primary);
                    background-color: rgba(var(--bs-primary-rgb), 0.08);
                }
                html.app-skin-dark .customers-nav-tabs .nav-item .nav-link.active {
                    background-color: rgba(var(--bs-primary-rgb), 0.16);
                }
            `}</style>
            {/* Left Column - Profile Card */}
            <div className="col-xxl-4 col-xl-6 d-flex">
                <div className="card flex-fill">
                    <div className="card-body">
                        <div className="mb-4 text-center">
                            <div className="wd-150 ht-150 mx-auto mb-3 position-relative">
                                <div className="profile-avatar-lg wd-150 ht-150 border border-5 border-gray-3" style={{ borderRadius: '50%', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <img src={avatarUrl} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                </div>
                                <label htmlFor="avatar-upload" className="cs-avatar-btn cs-avatar-btn-pos c-pointer" style={{ cursor: 'pointer' }}>
                                    <FiCamera size={16} strokeWidth={1.8} />
                                    <input
                                        id="avatar-upload"
                                        type="file"
                                        accept="image/*"
                                        onChange={handleAvatarUpload}
                                        disabled={loading}
                                        style={{ display: 'none' }}
                                    />
                                </label>
                            </div>
                            <div className="mb-4">
                                <div className="cs-profile-name fs-14 fw-bold d-block">{user?.full_name}</div>
                                <div className="cs-profile-email fs-12 fw-normal d-block">{user?.email}</div>
                            </div>
                            <div className="fs-12 fw-normal text-muted text-center d-flex flex-wrap gap-3 mb-4">
                                <div className="cs-prof-stat cs-prof-stat-solid cs-prof-stat-orange flex-fill py-3 px-4 rounded-3 d-none d-sm-block">
                                    <div className="cs-prof-stat-title">Role</div>
                                    <div className="cs-prof-stat-val text-capitalize mt-1">{user?.platform_role}</div>
                                </div>
                                <div className={`cs-prof-stat cs-prof-stat-solid ${user?.is_active ? 'cs-prof-stat-green' : 'cs-prof-stat-orange'} flex-fill py-3 px-4 rounded-3 d-none d-sm-block`}>
                                    <div className="cs-prof-stat-title">Status</div>
                                    <div className="cs-prof-stat-val mt-1">{user?.is_active ? 'Active' : 'Inactive'}</div>
                                </div>
                            </div>
                        </div>
                        <div className="mb-4">
                            <div className="cs-prof-row d-flex align-items-center justify-content-between gap-3">
                                <div className="d-flex align-items-center gap-2" style={{ minWidth: 0 }}>
                                    <span className="cs-prof-icon"><FiMail size={13} strokeWidth={2} /></span>
                                    <span className="cs-prof-label">Email</span>
                                </div>
                                <div className="cs-prof-val text-truncate text-end" style={{ minWidth: 0 }}>{user?.email}</div>
                            </div>
                            <div className="cs-prof-row d-flex align-items-center justify-content-between gap-3">
                                <div className="d-flex align-items-center gap-2" style={{ minWidth: 0 }}>
                                    <span className="cs-prof-icon"><FiAtSign size={13} strokeWidth={2} /></span>
                                    <span className="cs-prof-label">Username</span>
                                </div>
                                <div className="cs-prof-val text-truncate text-end" style={{ minWidth: 0 }}>{user?.username}</div>
                            </div>
                            <div className="d-flex align-items-center justify-content-between gap-3 pt-3">
                                <div className="d-flex align-items-center gap-2" style={{ minWidth: 0 }}>
                                    <span className="cs-prof-icon"><FiCalendar size={13} strokeWidth={2} /></span>
                                    <span className="cs-prof-label">Joined</span>
                                </div>
                                <div className="cs-prof-val text-end">{new Date(user?.created_at).toLocaleDateString()}</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Right Column - Tabs */}
            <div className="col-xxl-8 col-xl-6 d-flex">
                <div className="card border-top-0 flex-fill">
                    <div className="card-header p-0 border-bottom">
                        <ul className="nav nav-tabs flex-wrap w-100 text-center customers-nav-tabs flex-nowrap mb-0" id="profileTab" role="tablist">
                            <li className="nav-item flex-fill border-top" role="presentation">
                                <a href="#" className="nav-link active text-uppercase fw-bold" style={{ fontSize: '11px', letterSpacing: '0.08em', padding: '16px' }} data-bs-toggle="tab" data-bs-target="#overviewTab" role="tab">Overview</a>
                            </li>
                            <li className="nav-item flex-fill border-top" role="presentation">
                                <a href="#" className="nav-link text-uppercase fw-bold" style={{ fontSize: '11px', letterSpacing: '0.08em', padding: '16px' }} data-bs-toggle="tab" data-bs-target="#securityTab" role="tab">Security</a>
                            </li>
                        </ul>
                    </div>
                    <div className="tab-content">
                        {/* Overview Tab */}
                        <div className="tab-pane fade show active" id="overviewTab" role="tabpanel">
                            <div className="card-body">
                                <div className="d-flex align-items-center justify-content-center mb-5 flex-column text-center">
                                    <h2 className="fw-bolder mb-2" style={{ fontSize: '22px', lineHeight: '1.2' }}>Profile Details</h2>
                                    <p className="fs-12 fw-medium text-muted mb-0" style={{ lineHeight: '1.6' }}>View and manage your account information</p>
                                </div>

                                {!isEditing ? (
                                    <div>
                                        <div className="cs-prof-row d-flex align-items-center justify-content-between gap-3">
                                            <div className="d-flex align-items-center gap-2" style={{ minWidth: 0 }}>
                                                <span className="cs-prof-icon"><FiUser size={13} strokeWidth={2} /></span>
                                                <span className="cs-prof-label">Full Name</span>
                                            </div>
                                            <div className="cs-prof-val text-truncate text-end" style={{ minWidth: 0 }}>{user?.full_name}</div>
                                        </div>
                                        <div className="cs-prof-row d-flex align-items-center justify-content-between gap-3">
                                            <div className="d-flex align-items-center gap-2" style={{ minWidth: 0 }}>
                                                <span className="cs-prof-icon"><FiAtSign size={13} strokeWidth={2} /></span>
                                                <span className="cs-prof-label">Username</span>
                                            </div>
                                            <div className="cs-prof-val text-truncate text-end" style={{ minWidth: 0 }}>{user?.username}</div>
                                        </div>
                                        <div className="cs-prof-row d-flex align-items-center justify-content-between gap-3">
                                            <div className="d-flex align-items-center gap-2" style={{ minWidth: 0 }}>
                                                <span className="cs-prof-icon"><FiMail size={13} strokeWidth={2} /></span>
                                                <span className="cs-prof-label">Email Address</span>
                                            </div>
                                            <div className="cs-prof-val text-truncate text-end" style={{ minWidth: 0 }}>{user?.email}</div>
                                        </div>
                                        <div className="cs-prof-row d-flex align-items-center justify-content-between gap-3">
                                            <div className="d-flex align-items-center gap-2" style={{ minWidth: 0 }}>
                                                <span className="cs-prof-icon"><FiLayers size={13} strokeWidth={2} /></span>
                                                <span className="cs-prof-label">Role</span>
                                            </div>
                                            <div className="cs-prof-val text-end text-capitalize">{user?.platform_role}</div>
                                        </div>
                                        <div className="d-flex align-items-center justify-content-between gap-3 pt-3">
                                            <div className="d-flex align-items-center gap-2" style={{ minWidth: 0 }}>
                                                <span className="cs-prof-icon">
                                                    <FiCalendar size={13} strokeWidth={2} />
                                                </span>
                                                <span className="cs-prof-label">Joined</span>
                                            </div>
                                            <div className="cs-prof-val text-end">{new Date(user?.created_at).toLocaleDateString()}</div>
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        <div className="row g-3">
                                            <div className="col-12">
                                                <label className={LABEL} style={LABEL_STYLE}>
                                                    Full Name <span className="text-danger">*</span>
                                                </label>
                                                <div className="input-group">
                                                    <div className="input-group-text"><FiUser size={15} /></div>
                                                    <input
                                                        type="text"
                                                        className="form-control"
                                                        name="full_name"
                                                        placeholder="Enter full name"
                                                        style={{ fontSize: '0.875rem' }}
                                                        value={formData.full_name}
                                                        onChange={handleInputChange}
                                                        disabled={loading}
                                                    />
                                                </div>
                                                {errors.full_name && <span className="text-danger fs-12 mt-2 d-block">{errors.full_name}</span>}
                                            </div>
                                            <div className="col-12">
                                                <label className={LABEL} style={LABEL_STYLE}>
                                                    Username <span className="text-danger">*</span>
                                                </label>
                                                <div className="input-group">
                                                    <div className="input-group-text"><FiAtSign size={15} /></div>
                                                    <input
                                                        type="text"
                                                        className="form-control"
                                                        name="username"
                                                        placeholder="Enter username"
                                                        style={{ fontSize: '0.875rem' }}
                                                        value={formData.username}
                                                        onChange={handleInputChange}
                                                        disabled={loading}
                                                    />
                                                </div>
                                                {errors.username && <span className="text-danger fs-12 mt-2 d-block">{errors.username}</span>}
                                            </div>
                                            {user?.auth_provider !== 'google' && (
                                                <div className="col-12">
                                                    <label className={LABEL} style={LABEL_STYLE}>
                                                        Current Password <span className="text-danger">*</span>
                                                    </label>
                                                    <div className="input-group">
                                                        <div className="input-group-text"><FiLock size={15} /></div>
                                                        <input
                                                        type={showProfileCurrentPassword ? 'text' : 'password'}
                                                            className="form-control"
                                                            name="current_password"
                                                            value={formData.current_password}
                                                            onChange={handleInputChange}
                                                            disabled={loading}
                                                            placeholder="Required to save changes"
                                                            style={{ fontSize: '0.875rem' }}
                                                        />
                                                    <button
                                                        type="button"
                                                        className="input-group-text border-start bg-gray-2 c-pointer"
                                                        data-bs-toggle="tooltip"
                                                        title="Show/Hide Password"
                                                        onClick={() => setShowProfileCurrentPassword(v => !v)}
                                                        tabIndex={-1}
                                                    >
                                                        {showProfileCurrentPassword ? <FiEyeOff size={16} /> : <FiEye size={16} />}
                                                    </button>
                                                    </div>
                                                    {errors.current_password && <span className="text-danger fs-12 mt-2 d-block">{errors.current_password}</span>}
                                                </div>
                                            )}
                                        </div>
                                        <div className="d-flex justify-content-center gap-3 mt-4">
                                            <button
                                                onClick={handleSaveProfile}
                                                disabled={loading}
                                                className="btn btn-lg btn-primary fw-semibold text-uppercase"
                                                style={{ letterSpacing: '0.08em' }}
                                            >
                                                Save Changes
                                            </button>
                                            <button
                                                onClick={() => { setIsEditing(false); setFormData({ ...formData, current_password: '' }); setErrors({}); }}
                                                disabled={loading}
                                                className="btn btn-lg btn-outline-secondary fw-semibold text-uppercase"
                                                style={{ letterSpacing: '0.08em' }}
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Security Tab */}
                        <div className="tab-pane fade" id="securityTab" role="tabpanel">
                            <div className="card-body">
                                {user?.auth_provider === 'google' ? (
                                    <div className="d-flex flex-column align-items-center justify-content-center text-center py-5" style={{ minHeight: 180 }}>
                                        <div
                                            className="d-inline-flex align-items-center justify-content-center rounded-circle mb-3"
                                            style={{ width: 56, height: 56, background: 'rgba(var(--bs-primary-rgb), 0.12)', color: 'var(--bs-primary)' }}
                                            aria-hidden="true"
                                        >
                                            <FiKey size={18} />
                                        </div>
                                        <div className="fw-bold fs-16 text-dark">
                                            Password managed by Google
                                        </div>
                                        <div className="fs-13 text-muted mt-1" style={{ maxWidth: 520 }}>
                                            Use your Google account settings to change your password
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        <div className="d-flex align-items-center justify-content-center mb-5 flex-column text-center">
                                            <h2 className="fw-bolder mb-2" style={{ fontSize: '22px', lineHeight: '1.2' }}>Change Password</h2>
                                            <p className="fs-12 fw-medium text-muted mb-0" style={{ lineHeight: '1.6' }}>Update your account password to maintain security</p>
                                        </div>
                                        <div className="mb-4">
                                        <label className={LABEL} style={LABEL_STYLE}>
                                            Current Password <span className="text-danger">*</span>
                                        </label>
                                        <div className="input-group">
                                            <div className="input-group-text"><FiLock size={15} /></div>
                                            <input
                                                type={showSecurityPassword ? 'text' : 'password'}
                                                className="form-control"
                                                name="current_password"
                                                value={passwordData.current_password}
                                                onChange={handlePasswordChange}
                                                disabled={loading}
                                                style={{ fontSize: '0.875rem' }}
                                            />
                                            <button
                                                type="button"
                                                className="input-group-text border-start bg-gray-2 c-pointer"
                                                data-bs-toggle="tooltip"
                                                title="Show/Hide Password"
                                                onClick={() => setShowSecurityPassword(v => !v)}
                                                tabIndex={-1}
                                            >
                                                {showSecurityPassword ? <FiEyeOff size={16} /> : <FiEye size={16} />}
                                            </button>
                                        </div>
                                        {passwordErrors.current_password && <span className="text-danger fs-12 mt-2 d-block">{passwordErrors.current_password}</span>}
                                    </div>
                                    <div className="mb-4">
                                        <label className={LABEL} style={LABEL_STYLE}>
                                            New Password <span className="text-danger">*</span>
                                        </label>
                                        <div className="input-group">
                                            <div className="input-group-text"><FiKey size={15} /></div>
                                            <input
                                                type={showSecurityPassword ? 'text' : 'password'}
                                                className="form-control"
                                                name="new_password"
                                                value={passwordData.new_password}
                                                onChange={handlePasswordChange}
                                                disabled={loading}
                                                style={{ fontSize: '0.875rem' }}
                                            />
                                        </div>
                                    </div>
                                    <div className="mb-4">
                                        <label className={LABEL} style={LABEL_STYLE}>
                                            Confirm Password <span className="text-danger">*</span>
                                        </label>
                                        <div className="input-group">
                                            <div className="input-group-text"><FiKey size={15} /></div>
                                            <input
                                                type={showSecurityPassword ? 'text' : 'password'}
                                                className="form-control"
                                                name="confirm_password"
                                                value={passwordData.confirm_password}
                                                onChange={handlePasswordChange}
                                                disabled={loading}
                                                style={{ fontSize: '0.875rem' }}
                                            />
                                        </div>
                                        {passwordErrors.confirm_password && <span className="text-danger fs-12 mt-2 d-block">{passwordErrors.confirm_password}</span>}
                                    </div>
                                        <div className="d-flex justify-content-center mt-4">
                                            <button
                                                onClick={handleChangePassword}
                                                disabled={loading}
                                                className="btn btn-lg btn-primary fw-semibold text-uppercase"
                                                style={{ letterSpacing: '0.08em' }}
                                            >
                                                Change Password
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </>
    )
}

export default ProfileContent
