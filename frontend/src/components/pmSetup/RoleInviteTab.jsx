import React, { useEffect, useState } from 'react';
import { FiSearch, FiAlertCircle, FiUsers, FiUserPlus, FiMail, FiUser, FiArrowRight, FiX } from 'react-icons/fi';
import PageLoader from '../../components/shared/PageLoader'
import { apiGet } from '../../utils/api';
import topTostError from '../../utils/topTostError';

const AVATAR_COLORS = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#dc2626', '#7c3aed', '#db2777'];
const avatarColor = (id) => AVATAR_COLORS[id % AVATAR_COLORS.length];
const initials = (name = '') => name.split(' ').map(w => w[0] || '').slice(0, 2).join('').toUpperCase() || '?';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Get current user ID from JWT token
const getCurrentUserId = () => {
  try {
    const token = sessionStorage.getItem('access_token');
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const decoded = JSON.parse(atob(parts[1]));
    return decoded.sub ? parseInt(decoded.sub) : null;
  } catch {
    return null;
  }
};

const RoleInviteTab = ({ projectId, role, roleLabel, pendingMembers = [], setPendingMembers, onMemberAdded, tabError, onClearTabError, availableUsers, usersLoadError }) => {
  const [assignType, setAssignType] = useState('existing');
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(availableUsers === null && !usersLoadError);
  const [search, setSearch] = useState('');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [emailErrors, setEmailErrors] = useState({});
  const [hoveredId, setHoveredId] = useState(null);
  const currentUserId = getCurrentUserId();

  // Use preloaded users from parent when available; otherwise fetch independently
  useEffect(() => {
    if (availableUsers !== null) {
      setUsers(availableUsers);
      setLoading(false);
      return;
    }
    if (usersLoadError) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    loadUsers(controller.signal);
    return () => controller.abort();
  }, [projectId, availableUsers, usersLoadError]);

  const loadUsers = async (signal) => {
    setLoading(true);
    try {
      const res = await apiGet(`/projects/${projectId}/available-users`, { signal });
      setUsers(res || []);
    } catch (err) {
      if (signal?.aborted) return
      try {
        await new Promise((r) => window.setTimeout(r, 600))
        const retryRes = await apiGet(`/projects/${projectId}/available-users`, { signal });
        setUsers(retryRes || []);
        return
      } catch (err2) {
        if (signal?.aborted) return
        topTostError('Failed to load users list');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSwitchMode = (newMode) => {
    setAssignType(newMode);
    setEmailErrors({});
    setEmail('');
    setFullName('');
    setSearch('');
  };

  const validateEmail = (value) => {
    const trimmed = (value || '').trim();
    if (!trimmed) return 'Email address is required';
    if (!EMAIL_RE.test(trimmed)) return 'Invalid email address';
    return null;
  };

  const validateFullName = (value) => {
    const trimmed = (value || '').trim();
    if (!trimmed) return 'Full name is required';
    if (trimmed.length < 2) return 'Full name must be at least 2 characters';
    return null;
  };

  const handleToggleUser = (userId) => {
    const user = users.find(u => u.id === userId);
    if (!user) return;

    // Check if user is already in pending members
    const isPending = pendingMembers.some(m => m.email === user.email);

    if (isPending) {
      // Remove from pending
      const updated = pendingMembers.filter(m => m.email !== user.email);
      setPendingMembers(updated);
    } else {
      // Add to pending
      const newMember = { name: user.full_name, email: user.email, isEmail: false };
      setPendingMembers([...pendingMembers, newMember]);
      if (onMemberAdded) onMemberAdded();
      if (onClearTabError) onClearTabError();
    }
  };

  const handleAddFromEmail = () => {
    const nameErr = validateFullName(fullName);
    const emailErr = validateEmail(email);

    setEmailErrors({});
    if (nameErr) setEmailErrors(prev => ({ ...prev, fullName: nameErr }));
    if (emailErr) setEmailErrors(prev => ({ ...prev, email: emailErr }));

    if (nameErr || emailErr) return;

    handleEmailSubmit();
  };

  const handleEmailSubmit = () => {
    setPendingMembers([...pendingMembers, { name: fullName.trim(), email: email.trim(), isEmail: true }]);
    setEmail('');
    setFullName('');
    setEmailErrors({});
    if (onMemberAdded) onMemberAdded();
    if (onClearTabError) onClearTabError();
  };

  const filtered = users.filter(u => {
    // Exclude current user (PM) and admin accounts
    if (u.id === currentUserId) return false;
    if (u.platform_role === 'admin') return false;

    // Apply search filter
    if (search) {
      return u.full_name.toLowerCase().includes(search.toLowerCase()) ||
             u.email.toLowerCase().includes(search.toLowerCase());
    }
    return true;
  });

  const emailReady = !emailErrors.email && email.trim();
  const nameReady = !emailErrors.fullName && fullName.trim();
  const emailFormReady = emailReady && nameReady;

  const FieldError = ({ field }) => emailErrors[field] ? (
    <span className="field-error d-flex align-items-center gap-1 mt-1" style={{ fontSize: '0.72rem', color: '#ef4444' }}>
      <FiAlertCircle size={11} style={{ flexShrink: 0 }} />{emailErrors[field]}
    </span>
  ) : null;

  if (loading) return (
      <section className="step-body mt-4 body current">
        <PageLoader minHeight={200} />
      </section>
    );

  return (
    <section className="step-body mt-4 body current">
      <style>{`.pm-error svg{stroke:#ef4444!important;color:#ef4444!important;}`}</style>
      <form id={`project-${role}`}>
        <fieldset>
          <div className="mb-5 text-center">
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '10px',
              fontWeight: 700,
              letterSpacing: '1.1px',
              textTransform: 'uppercase',
              padding: '5px 13px',
              borderRadius: '30px',
              background: 'linear-gradient(135deg, rgba(var(--bs-primary-rgb),0.22) 0%, rgba(var(--bs-primary-rgb),0.07) 100%)',
              color: 'var(--bs-primary)',
              border: '1px solid rgba(var(--bs-primary-rgb),0.35)',
              marginBottom: '14px',
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
              boxShadow: '0 4px 14px rgba(var(--bs-primary-rgb),0.18), inset 0 1px 0 rgba(255,255,255,0.55), inset 0 -1px 0 rgba(var(--bs-primary-rgb),0.12)'
            }}>
              Assignment
            </div>
            <h2 className="fw-bolder mb-2" style={{ fontSize: '22px', lineHeight: '1.2' }}>
              Assign {roleLabel}
            </h2>
            <p className="fs-12 fw-medium text-muted mb-0" style={{ lineHeight: '1.6' }}>
              Select existing users or invite new members to assign as {roleLabel.toLowerCase()}{role === 'safety_officer' ? '..' : ''}
            </p>
          </div>

          {/* Mode Toggle */}
          <div className="d-flex justify-content-center mb-4">
            <div
              className="cs-pm-toggle d-flex gap-2 p-1 rounded-3"
              style={{
                background: 'rgba(var(--bs-primary-rgb), 0.04)',
                border: '1px solid var(--bs-border-color, rgba(0,0,0,0.10))',
              }}
            >
              <button
                type="button"
                className="btn btn-sm d-inline-flex align-items-center gap-2"
                style={{
                  borderRadius: '8px',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  padding: '7px 18px',
                  background: assignType === 'existing' ? 'var(--bs-primary)' : 'transparent',
                  color: assignType === 'existing' ? '#fff' : 'var(--bs-secondary-color,#6c757d)',
                  border: 'none',
                  transition: 'all 0.15s',
                  boxShadow: 'none',
                }}
                onClick={() => handleSwitchMode('existing')}
              >
                <FiUsers size={13} /> Select Existing User
              </button>
              <button
                type="button"
                className="btn btn-sm d-inline-flex align-items-center gap-2"
                style={{
                  borderRadius: '8px',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  padding: '7px 18px',
                  background: assignType === 'email' ? 'var(--bs-primary)' : 'transparent',
                  color: assignType === 'email' ? '#fff' : 'var(--bs-secondary-color,#6c757d)',
                  border: 'none',
                  transition: 'all 0.15s',
                  boxShadow: 'none',
                }}
                onClick={() => handleSwitchMode('email')}
              >
                <FiUserPlus size={13} /> Invite by Email
              </button>
            </div>
          </div>

          {/* Content Panel */}
          <div style={{ maxWidth: 540, margin: '0 auto' }}>
            {assignType === 'existing' ? (
              <>
                {/* User Search and Selection */}
                {users.length > 5 && (
                  <div className="input-group mb-4">
                    <div className="input-group-text"><FiSearch size={14} /></div>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="Search users"
                      style={{ fontSize: '0.875rem' }}
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                    />
                  </div>
                )}

                <div style={{ maxHeight: 340, overflowY: 'auto', paddingRight: 4 }}>
                  {filtered.length === 0 && (
                    <div className="d-flex flex-column align-items-center justify-content-center" style={{ minHeight: 180 }}>
                      <div
                        className="d-inline-flex align-items-center justify-content-center rounded-circle mb-3"
                        style={{ width: 56, height: 56, background: 'rgba(var(--bs-primary-rgb), 0.12)', color: 'var(--bs-primary)' }}
                      >
                        <FiSearch size={18} />
                      </div>
                      <h6 className="fw-bold fs-16 mb-1">No users found</h6>
                      <div className="fs-13 text-muted mt-1">
                        {search.trim() ? 'Try a different search term' : 'No users available.'}
                      </div>
                    </div>
                  )}
                  {filtered.map(u => {
                    const isPending = pendingMembers.some(m => m.email === u.email);
                    const isHovered = hoveredId === u.id && !isPending;
                    return (
                      <div
                        key={u.id}
                        className="cs-pm-usercard d-flex flex-row justify-content-between align-items-center px-4 py-4 mb-3 rounded-3"
                        style={{
                          cursor: 'pointer',
                          border: isPending ? '1.5px solid #10b981' : '1.5px solid var(--bs-border-color, rgba(0,0,0,0.10))',
                          borderLeft: isPending ? '4px solid #10b981' : '1.5px solid var(--bs-border-color, rgba(0,0,0,0.10))',
                          background: isPending ? 'rgba(16,185,129,0.07)' : isHovered ? 'rgba(var(--bs-primary-rgb), 0.04)' : 'transparent',
                          boxShadow: isHovered ? '0 10px 30px rgba(0,0,0,0.06)' : 'none',
                          transition: 'all 0.15s ease',
                        }}
                        onClick={() => handleToggleUser(u.id)}
                        onMouseEnter={() => setHoveredId(u.id)}
                        onMouseLeave={() => setHoveredId(null)}
                      >
                        <span className="hstack gap-3">
                          <span
                            className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                            style={{
                              width: 42,
                              height: 42,
                              fontSize: 13,
                              fontWeight: 700,
                              background: avatarColor(u.id),
                              color: '#fff',
                              boxShadow: isPending ? '0 0 0 3px rgba(16,185,129,0.25)' : 'none',
                              transition: 'box-shadow 0.15s ease',
                            }}
                          >
                            {initials(u.full_name)}
                          </span>
                          <span>
                            <span className="cs-pm-user-name d-block fs-13 fw-bold">{u.full_name}</span>
                            <span className="d-block text-muted mb-0" style={{ fontSize: '0.78rem' }}>{u.email}</span>
                          </span>
                        </span>
                        <span style={{ width: 24 }} />
                      </div>
                    );
                  })}
                </div>

                {/* Pending Members Display */}
                {pendingMembers.length > 0 && (
                  <div className="mt-4">
                    {pendingMembers.map((m, i) => (
                      <div
                        key={i}
                        className="card border mb-3 cs-pm-selected-card"
                        style={{ cursor: 'pointer', transition: 'all 0.15s ease' }}
                        onClick={() => {
                          const updated = pendingMembers.filter((_, idx) => idx !== i);
                          setPendingMembers(updated);
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.opacity = '0.8';
                          e.currentTarget.style.boxShadow = '0 10px 30px rgba(0,0,0,0.06)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.opacity = '1';
                          e.currentTarget.style.boxShadow = 'none';
                        }}
                      >
                        <style>{`
                          html.app-skin-dark .cs-pm-selected-card {
                            border-color: rgba(255,255,255,0.10) !important;
                            background: linear-gradient(135deg, rgba(var(--bs-primary-rgb), 0.22) 0%, rgba(255,255,255, 0.04) 55%, rgba(var(--bs-info-rgb), 0.18) 100%) !important;
                          }
                          .cs-pm-selected-card {
                            overflow: hidden;
                            border-color: rgba(var(--bs-primary-rgb), 0.18) !important;
                            background: linear-gradient(135deg, rgba(var(--bs-primary-rgb), 0.14) 0%, rgba(var(--bs-primary-rgb), 0.05) 55%, rgba(var(--bs-info-rgb), 0.10) 100%);
                            color: var(--bs-body-color);
                          }
                          html.app-skin-dark .cs-pm-selected-card {
                            color: rgba(255,255,255,0.92);
                          }
                          .cs-pm-selected-card .cs-pm-head {
                            display: flex;
                            align-items: center;
                            justify-content: space-between;
                            gap: 12px;
                            margin-bottom: 12px;
                          }
                          .cs-pm-selected-card .cs-pm-title {
                            font-weight: 700;
                            font-size: 14px;
                            letter-spacing: 0.5px;
                            line-height: 1.2;
                            color: var(--bs-secondary-color);
                            text-transform: uppercase;
                          }
                          html.app-skin-dark .cs-pm-selected-card .cs-pm-title {
                            color: rgba(255,255,255,0.96);
                          }
                          .cs-pm-selected-card .cs-invite-card {
                            display: flex; align-items: center; padding-left: 12px;
                            border-left: 4px solid #b45309 !important;
                            margin-top: 8px;
                          }
                          .cs-pm-selected-card .cs-invite-line { margin-top: 0; font-size: 12px; color: rgba(2, 6, 23, 0.72); }
                          html.app-skin-dark .cs-pm-selected-card .cs-invite-line { color: rgba(255, 255, 255, 0.76); }
                          .cs-pm-user-name { font-weight: bold; font-size: 14px; line-height: 1.3; margin-bottom: 4px; }
                        `}</style>
                        <div className="card-body pt-4 pb-3 px-4">
                          <div className="cs-pm-head mb-4">
                            <div className="cs-pm-title">Selected {roleLabel}</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span className="badge bg-soft-warning text-warning fs-11 fw-bold text-uppercase">PENDING</span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const updated = pendingMembers.filter((_, idx) => idx !== i);
                                  setPendingMembers(updated);
                                }}
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  cursor: 'pointer',
                                  padding: '4px 8px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  borderRadius: '6px',
                                  color: 'var(--bs-secondary-color)',
                                  transition: 'all 0.15s ease',
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.background = 'rgba(239,68,68,0.1)';
                                  e.currentTarget.style.color = '#ef4444';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = 'transparent';
                                  e.currentTarget.style.color = 'var(--bs-secondary-color)';
                                }}
                                title="Remove from pending"
                              >
                                <FiX size={16} strokeWidth={2.5} />
                              </button>
                            </div>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <div className="d-flex align-items-center gap-4">
                              <span
                                className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                                style={{
                                  width: 42,
                                  height: 42,
                                  fontSize: 13,
                                  fontWeight: 700,
                                  background: avatarColor(m.email.charCodeAt(0)),
                                  color: '#fff',
                                }}
                              >
                                {initials(m.name)}
                              </span>
                              <div className="flex-grow-1">
                                <div className="cs-pm-user-name">{m.name}</div>
                                <div className="d-block text-muted mb-0 fw-normal" style={{ fontSize: '12px', lineHeight: 1.3, marginBottom: '10px' }}>
                                  {m.email}
                                </div>
                              </div>
                            </div>
                            <div className="cs-invite-card">
                              <span className="cs-invite-line">The invitation will be sent when project is activated</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                {/* Email Invite Form */}
                <div className="mb-3">
                  <label className="fs-11 fw-semibold text-muted text-uppercase mb-1" style={{ letterSpacing: '0.06em' }}>
                    Full Name <span className="text-danger">*</span>
                  </label>
                  <div className="input-group">
                    <div className="input-group-text"><FiUser size={14} /></div>
                    <input
                      type="text"
                      className={`form-control ${emailErrors.fullName ? 'is-invalid' : ''}`}
                      placeholder="Enter full name"
                      style={{ fontSize: '0.875rem' }}
                      value={fullName}
                      onChange={e => {
                        setFullName(e.target.value);
                        if (emailErrors.fullName) setEmailErrors(prev => ({ ...prev, fullName: null }));
                      }}
                      maxLength={100}
                    />
                  </div>
                  <FieldError field="fullName" />
                </div>

                <div className="mb-4">
                  <label className="fs-11 fw-semibold text-muted text-uppercase mb-1" style={{ letterSpacing: '0.06em' }}>
                    Email Address <span className="text-danger">*</span>
                  </label>
                  <div className="input-group">
                    <div className="input-group-text"><FiMail size={14} /></div>
                    <input
                      type="email"
                      className={`form-control ${emailErrors.email ? 'is-invalid' : ''}`}
                      placeholder="Enter email address"
                      style={{ fontSize: '0.875rem' }}
                      value={email}
                      onChange={e => {
                        setEmail(e.target.value);
                        if (emailErrors.email) setEmailErrors(prev => ({ ...prev, email: null }));
                      }}
                    />
                  </div>
                  <FieldError field="email" />
                  <div className="text-muted mt-1" style={{ fontSize: '0.72rem' }}>
                    An account will be created after the invitation is accepted
                  </div>
                </div>

                <div className="mt-4 d-flex justify-content-center">
                  <button
                    type="button"
                    onClick={handleAddFromEmail}
                    disabled={!emailFormReady}
                    className="btn btn-sm btn-success d-inline-flex align-items-center gap-1"
                    style={!emailFormReady ? { pointerEvents: 'none', opacity: 0.5 } : {}}
                  >
                    <FiArrowRight size={12} />
                    Add {roleLabel}
                  </button>
                </div>

                {/* Pending Members Display for Email Mode */}
                {pendingMembers.length > 0 && (
                  <div className="mt-4">
                    {pendingMembers.map((m, i) => (
                      <div
                        key={i}
                        className="card border mb-3 cs-pm-selected-card"
                        style={{ cursor: 'pointer', transition: 'all 0.15s ease' }}
                        onClick={() => {
                          const updated = pendingMembers.filter((_, idx) => idx !== i);
                          setPendingMembers(updated);
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.opacity = '0.8';
                          e.currentTarget.style.boxShadow = '0 10px 30px rgba(0,0,0,0.06)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.opacity = '1';
                          e.currentTarget.style.boxShadow = 'none';
                        }}
                      >
                        <style>{`
                          html.app-skin-dark .cs-pm-selected-card {
                            border-color: rgba(255,255,255,0.10) !important;
                            background: linear-gradient(135deg, rgba(var(--bs-primary-rgb), 0.22) 0%, rgba(255,255,255, 0.04) 55%, rgba(var(--bs-info-rgb), 0.18) 100%) !important;
                          }
                          .cs-pm-selected-card {
                            overflow: hidden;
                            border-color: rgba(var(--bs-primary-rgb), 0.18) !important;
                            background: linear-gradient(135deg, rgba(var(--bs-primary-rgb), 0.14) 0%, rgba(var(--bs-primary-rgb), 0.05) 55%, rgba(var(--bs-info-rgb), 0.10) 100%);
                            color: var(--bs-body-color);
                          }
                          html.app-skin-dark .cs-pm-selected-card {
                            color: rgba(255,255,255,0.92);
                          }
                          .cs-pm-selected-card .cs-pm-head {
                            display: flex;
                            align-items: center;
                            justify-content: space-between;
                            gap: 12px;
                            margin-bottom: 12px;
                          }
                          .cs-pm-selected-card .cs-pm-title {
                            font-weight: 700;
                            font-size: 14px;
                            letter-spacing: 0.5px;
                            line-height: 1.2;
                            color: var(--bs-secondary-color);
                            text-transform: uppercase;
                          }
                          html.app-skin-dark .cs-pm-selected-card .cs-pm-title {
                            color: rgba(255,255,255,0.96);
                          }
                          .cs-pm-selected-card .cs-invite-card {
                            display: flex; align-items: center; padding-left: 12px;
                            border-left: 4px solid #b45309 !important;
                            margin-top: 8px;
                          }
                          .cs-pm-selected-card .cs-invite-line { margin-top: 0; font-size: 12px; color: rgba(2, 6, 23, 0.72); }
                          html.app-skin-dark .cs-pm-selected-card .cs-invite-line { color: rgba(255, 255, 255, 0.76); }
                          .cs-pm-user-name { font-weight: bold; font-size: 14px; line-height: 1.3; margin-bottom: 4px; }
                        `}</style>
                        <div className="card-body pt-4 pb-3 px-4">
                          <div className="cs-pm-head mb-4">
                            <div className="cs-pm-title">Selected {roleLabel}</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span className="badge bg-soft-warning text-warning fs-11 fw-bold text-uppercase">PENDING</span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const updated = pendingMembers.filter((_, idx) => idx !== i);
                                  setPendingMembers(updated);
                                }}
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  cursor: 'pointer',
                                  padding: '4px 8px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  borderRadius: '6px',
                                  color: 'var(--bs-secondary-color)',
                                  transition: 'all 0.15s ease',
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.background = 'rgba(239,68,68,0.1)';
                                  e.currentTarget.style.color = '#ef4444';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = 'transparent';
                                  e.currentTarget.style.color = 'var(--bs-secondary-color)';
                                }}
                                title="Remove from pending"
                              >
                                <FiX size={16} strokeWidth={2.5} />
                              </button>
                            </div>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <div className="d-flex align-items-center gap-4">
                              <span
                                className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                                style={{
                                  width: 42,
                                  height: 42,
                                  fontSize: 13,
                                  fontWeight: 700,
                                  background: avatarColor(m.email.charCodeAt(0)),
                                  color: '#fff',
                                }}
                              >
                                {initials(m.name)}
                              </span>
                              <div className="flex-grow-1">
                                <div className="cs-pm-user-name">{m.name}</div>
                                <div className="d-block text-muted mb-0 fw-normal" style={{ fontSize: '12px', lineHeight: 1.3, marginBottom: '10px' }}>
                                  {m.email}
                                </div>
                              </div>
                            </div>
                            <div className="cs-invite-card">
                              <span className="cs-invite-line">The invitation will be sent when project is activated</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Tab-level error message */}
          {tabError && (
            <div className="pm-error d-flex align-items-center gap-2 mt-4 px-3 py-2 rounded-2"
              style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.22)', borderLeft: '3px solid #ef4444' }}>
              <FiAlertCircle size={14} color="#ef4444" style={{ flexShrink: 0 }} />
              <span style={{ fontSize: '0.8rem', color: '#ef4444' }}>{tabError}</span>
            </div>
          )}
        </fieldset>
      </form>
    </section>
  );
};

export default RoleInviteTab;
