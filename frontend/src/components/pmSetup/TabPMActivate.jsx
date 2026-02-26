import React, { useState, useEffect } from 'react';
import { FiCheckCircle, FiXCircle, FiAlertCircle, FiZap } from 'react-icons/fi';
import { apiGet, apiPost, apiPatch } from '../../utils/api';
import topTostError from '../../utils/topTostError';
import { broadcastRefresh } from '../../utils/broadcast';

const TabPMActivate = ({ projectId, settings, setSettings, onActivated, onBeforeActivate }) => {
  const [checklist, setChecklist] = useState({
    hasNameAndLocation: false,
    hasCameras: false,
    hasPM: true,
  });
  const [activating, setActivating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [savedSettings, setSavedSettings] = useState(null);
  const [activationError, setActivationError] = useState('');

  useEffect(() => {
    refreshChecklist();
    loadSettings();
  }, [projectId]);

  const refreshChecklist = async () => {
    setRefreshing(true);
    try {
      const [projectRes, camerasRes] = await Promise.all([
        apiGet(`/projects/${projectId}`),
        apiGet(`/projects/${projectId}/cameras`),
      ]);
      setChecklist({
        hasNameAndLocation: !!(projectRes.name && projectRes.location),
        hasCameras: camerasRes.length > 0,
        hasPM: true,
      });
    } catch (err) {
      topTostError('Failed to refresh checklist');
    } finally {
      setRefreshing(false);
    }
  };

  const loadSettings = async () => {
    try {
      const res = await apiGet(`/projects/${projectId}/settings`);
      setSavedSettings(res);
      setSettings({ report_frequency: res.report_frequency || 'weekly' });
    } catch {
      setSavedSettings(null);
    }
  };

  const handleChangeFrequency = async (freq) => {
    setSettings({ report_frequency: freq });
    try {
      await apiPatch(`/projects/${projectId}/settings`, { report_frequency: freq });
      await loadSettings();
    } catch (err) {
      topTostError(err.response?.data?.detail || 'Failed to save settings');
    }
  };

  const handleActivate = async () => {
    if (!checklist.hasNameAndLocation || !checklist.hasCameras || !checklist.hasPM) {
      setActivationError('Please complete all checklist items before activating');
      return;
    }
    setActivationError('');
    setActivating(true);
    try {
      // Create all pending invitations first (silently, no toast)
      let inviteCount = 0;
      if (onBeforeActivate) {
        inviteCount = await onBeforeActivate();
      }

      // Then activate the project
      await apiPost(`/projects/${projectId}/activate`, {});
      try {
        const cacheKey = `cs:projectMeta:${projectId}`;
        const cached = JSON.parse(window.sessionStorage.getItem(cacheKey) || '{}');
        const nextMeta = { ...cached, status: 'active' };
        window.sessionStorage.setItem(cacheKey, JSON.stringify(nextMeta));
        broadcastRefresh('cs:project-status-refresh', { projectId, status: 'active' });
        broadcastRefresh('cs:projects-stats-refresh', { projectId, status: 'active' });
      } catch {
        broadcastRefresh('cs:project-status-refresh', { projectId, status: 'active' });
        broadcastRefresh('cs:projects-stats-refresh', { projectId, status: 'active' });
      }
      const msg = inviteCount > 0
        ? `Project activated! ${inviteCount} team member${inviteCount === 1 ? '' : 's'} have been invited.`
        : 'Project activated successfully!';
      topTostError(msg, 'success');
      if (onActivated) {
        setTimeout(() => onActivated(), 500);
      }
    } catch (err) {
      const errorMsg = err.response?.data?.detail || 'Failed to activate project';
      setActivationError(errorMsg);
      topTostError(errorMsg);
    } finally {
      setActivating(false);
    }
  };

  const allChecked = checklist.hasNameAndLocation && checklist.hasCameras && checklist.hasPM;

  return (
    <section className="step-body mt-4 body current">
      <style>{`
        .pm-error svg{stroke:#ef4444!important;color:#ef4444!important;}
        .pm-activate-checklist-item { color: rgba(2,6,23,0.86); }
        html.app-skin-dark .pm-activate-checklist-item { color: rgba(255,255,255,0.86); }
        .pm-alert-text { color: rgba(2,6,23,0.72); }
        html.app-skin-dark .pm-alert-text { color: rgba(255,255,255,0.90); }
        html.app-skin-dark .pm-alert-checkbox .form-check-input { border-color: rgba(255,255,255,0.25); background-color: rgba(255,255,255,0.12); }
        html.app-skin-dark .pm-alert-checkbox .form-check-input:checked { background-color: rgba(16,185,129,0.3); border-color: rgba(16,185,129,0.5); }
        html.app-skin-dark .pm-alert-checkbox .form-check-input:disabled { background-color: rgba(255,255,255,0.10); border-color: rgba(255,255,255,0.20); }
      `}</style>
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
          boxShadow: '0 4px 14px rgba(var(--bs-primary-rgb),0.18), inset 0 1px 0 rgba(255,255,255,0.55), inset 0 -1px 0 rgba(var(--bs-primary-rgb),0.12)',
        }}>
          Settings & Activate
        </div>
        <h2 className="fw-bolder mb-2" style={{ fontSize: '22px', lineHeight: '1.2' }}>
          Project Configuration & Activation
        </h2>
        <p className="fs-12 fw-medium text-muted mb-0" style={{ lineHeight: '1.6' }}>
          Review configuration and ensure all requirements are met before activation
        </p>
      </div>

      {activationError && (
        <div className="pm-error d-flex align-items-center gap-2 mb-4 px-3 py-2 rounded-2"
          style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.22)', borderLeft: '3px solid #ef4444' }}>
          <FiAlertCircle size={14} color="#ef4444" style={{ flexShrink: 0 }} />
          <span style={{ fontSize: '0.8rem', color: '#ef4444' }}>{activationError}</span>
        </div>
      )}

      <div className="row g-3">
        <div className="col-12">
          <div className="card">
            <div className="card-header">
              <div>
                <h5 className="mb-0">Configuration</h5>
                <span className="fs-12 text-muted">Review project configuration prior to activation</span>
              </div>
            </div>
            <div className="card-body">
              <div className="mb-4">
                <label className="fs-11 fw-semibold text-muted text-uppercase mb-2" style={{ letterSpacing: '0.06em', display: 'block' }}>
                  Alert Settings
                </label>
                <div className="form-check pm-alert-checkbox">
                  <input
                    type="checkbox"
                    className="form-check-input"
                    id="alerts_enabled"
                    checked={true}
                    disabled
                  />
                  <label className="form-check-label pm-alert-text" htmlFor="alerts_enabled">
                    Real-time alerts are enabled for active projects
                  </label>
                </div>
              </div>

              <div>
                <label className="fs-11 fw-semibold text-muted text-uppercase mb-2" style={{ letterSpacing: '0.06em', display: 'block' }}>
                  Report Frequency
                </label>
                <div className="d-flex gap-2 justify-content-center">
                  {['daily', 'weekly', 'monthly'].map(freq => (
                    <button
                      key={freq}
                      type="button"
                      className={`btn btn-sm ${settings.report_frequency === freq ? 'btn-success' : 'btn-outline-secondary'}`}
                      onClick={() => handleChangeFrequency(freq)}
                    >
                      {freq.charAt(0).toUpperCase() + freq.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="col-12">
          <div className="card">
            <div className="card-header">
              <div>
                <h5 className="mb-0">Activation Requirements</h5>
                <span className="fs-12 text-muted">All required conditions must be completed before activation</span>
              </div>
            </div>
            <div className="card-body">
              <ul className="list-unstyled mb-0">
                <li className="d-flex gap-3 mb-3 align-items-center">
                  {checklist.hasNameAndLocation ? (
                    <FiCheckCircle size={20} className="text-success flex-shrink-0" />
                  ) : (
                    <FiXCircle size={20} className="text-danger flex-shrink-0" />
                  )}
                  <span className="pm-activate-checklist-item">Project has a name and location</span>
                </li>
                <li className="d-flex gap-3 mb-3 align-items-center">
                  {checklist.hasCameras ? (
                    <FiCheckCircle size={20} className="text-success flex-shrink-0" />
                  ) : (
                    <FiXCircle size={20} className="text-danger flex-shrink-0" />
                  )}
                  <span className="pm-activate-checklist-item">At least 1 camera assigned</span>
                </li>
                <li className="d-flex gap-3 align-items-center">
                  {checklist.hasPM ? (
                    <FiCheckCircle size={20} className="text-success flex-shrink-0" />
                  ) : (
                    <FiXCircle size={20} className="text-danger flex-shrink-0" />
                  )}
                  <span className="pm-activate-checklist-item">Project Manager assigned</span>
                </li>
              </ul>

              <div className="mt-4 d-flex justify-content-center">
                <button
                  type="button"
                  className="btn btn-primary d-inline-flex align-items-center gap-2"
                  onClick={handleActivate}
                  disabled={!allChecked || activating}
                >
                  {activating ? (
                    <>
                      <span className="spinner-border spinner-border-sm" role="status"></span>
                      Activating...
                    </>
                  ) : (
                    <>
                      <FiZap size={15} />
                      Activate Project
                    </>
                  )}
                </button>
              </div>

              {!allChecked && (
                <div className="pm-error d-flex align-items-center gap-2 mt-3 px-3 py-2 rounded-2 mb-0"
                  style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.22)', borderLeft: '3px solid #ef4444' }}>
                  <FiAlertCircle size={14} color="#ef4444" style={{ flexShrink: 0 }} />
                  <span style={{ fontSize: '0.8rem', color: '#ef4444' }}>Complete all items above to activate your project</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default TabPMActivate;
