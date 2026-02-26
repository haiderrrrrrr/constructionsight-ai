import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiFileText, FiDollarSign, FiUser, FiShield, FiBarChart2, FiUsers, FiCamera, FiSettings, FiAlertCircle, FiX } from 'react-icons/fi';
import { apiGet, apiPatch, apiPost } from '../../utils/api';
import topTostError from '../../utils/topTostError';
import { useFormPersist } from '../../hooks/useFormPersist';
import TabPMDetails from './TabPMDetails';
import TabPMBudget from './TabPMBudget';
import TabPMSiteSupervisors from './TabPMSiteSupervisors';
import TabPMSafetyOfficers from './TabPMSafetyOfficers';
import TabPMDataAnalysts from './TabPMDataAnalysts';
import TabPMStakeholders from './TabPMStakeholders';
import TabPMCamerasZones from './TabPMCamerasZones';
import TabPMActivate from './TabPMActivate';

const STEPS = [
  { key: "info",        name: "Project Info",       Icon: FiFileText },
  { key: "budget",      name: "Budget",             Icon: FiDollarSign },
  { key: "supervisors", name: "Site Supervisors",   Icon: FiUser },
  { key: "safety",      name: "Safety Officers",    Icon: FiShield },
  { key: "analysts",    name: "Data Analysts",      Icon: FiBarChart2 },
  { key: "stakeholders",name: "Stakeholders",       Icon: FiUsers },
  { key: "cameras",     name: "Cameras & Zones",    Icon: FiCamera },
  { key: "activate",    name: "Activate",           Icon: FiSettings },
];

const EMPTY_FORM = {
  name: '', location: '', description: '', client_name: '',
  start_date: '', end_date: '', budget_tier: '',
};


const PMSetupWizard = ({ projectId, prefillData, onActivated }) => {
  const navigate = useNavigate();
  const camerasTabRef = React.useRef(null);
  const persistKey = `cs:draft:pm-setup:${projectId}`;
  const membersKey = `${persistKey}:members`;

  const [formData, setFormData, clearDraft, nav, setNav, hasDraft] = useFormPersist(
    persistKey,
    prefillData
      ? { ...EMPTY_FORM, name: prefillData.name || '', location: prefillData.location || '',
          description: prefillData.description || '', client_name: prefillData.client_name || '',
          start_date: prefillData.start_date || '', end_date: prefillData.end_date || '',
          budget_tier: prefillData.budget_tier || '' }
      : EMPTY_FORM,
    { initialNav: { currentIndex: 0, maxReached: 0 } }
  );

  const currentIndex = nav.currentIndex;
  const maxReached   = nav.maxReached;
  const setCurrentIndex = (v) => setNav(n => ({ ...n, currentIndex: typeof v === 'function' ? v(n.currentIndex) : v }));
  const setMaxReached   = (v) => setNav(n => ({ ...n, maxReached:   typeof v === 'function' ? v(n.maxReached)   : v }));

  const [flashRedIndex, setFlashRedIndex] = useState(null);
  const [errors, setErrors] = useState({});
  const [budgetError, setBudgetError] = useState('');
  const [settings, setSettings] = useState({ report_frequency: 'weekly' });
  const [savingTab1, setSavingTab1] = useState(false);
  const [roleTabError, setRoleTabError] = useState('');
  const [camerasError, setCamerasError] = useState('');
  const [draftBannerDismissed, setDraftBannerDismissed] = useState(false);

  // Fetch available users once and share across all role tabs
  const [availableUsers, setAvailableUsers] = useState(null);
  const [usersLoadError, setUsersLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      apiGet(`/projects/${projectId}/available-users`)
        .then(data => { if (!cancelled) setAvailableUsers(data || []); })
        .catch(() => {
          window.setTimeout(() => {
            if (cancelled) return;
            apiGet(`/projects/${projectId}/available-users`)
              .then(data => { if (!cancelled) setAvailableUsers(data || []); })
              .catch(() => { if (!cancelled) setUsersLoadError(true); });
          }, 800);
        });
    };
    load();
    return () => { cancelled = true; };
  }, [projectId]);

  // Persist pending members across tab navigation and page refreshes
  const [pendingMembers, setPendingMembers] = useState({
    site_supervisor: [],
    safety_officer: [],
    data_analyst: [],
    stakeholder: [],
  });

  useEffect(() => {
    try {
      const saved = localStorage.getItem(membersKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') setPendingMembers(parsed);
      }
    } catch {}
  }, [membersKey]);

  useEffect(() => {
    localStorage.setItem(membersKey, JSON.stringify(pendingMembers));
  }, [membersKey, pendingMembers]);

  const validateStep1 = () => {
    const newErrors = {};
    if (!formData.name?.trim() || formData.name.trim().length < 2) {
      newErrors.name = 'Project name is required (min 2 characters)';
    } else if (formData.name.trim().length > 200) {
      newErrors.name = 'Project name must not exceed 200 characters';
    }
    if (!formData.location?.trim() || formData.location.trim().length < 2) {
      newErrors.location = 'Site location is required (min 2 characters)';
    } else if (formData.location.trim().length > 300) {
      newErrors.location = 'Site location must not exceed 300 characters';
    }
    if (!formData.client_name?.trim()) {
      newErrors.client_name = 'Client name is required';
    } else if (formData.client_name.trim().length > 200) {
      newErrors.client_name = 'Client name must not exceed 200 characters';
    }
    if (!formData.start_date) {
      newErrors.start_date = 'Start date is required';
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(formData.start_date)) {
      newErrors.start_date = 'Start date must be in YYYY-MM-DD format';
    }
    if (!formData.end_date) {
      newErrors.end_date = 'End date is required';
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(formData.end_date)) {
      newErrors.end_date = 'End date must be in YYYY-MM-DD format';
    }
    if (formData.start_date && formData.end_date && !newErrors.start_date && !newErrors.end_date) {
      if (new Date(formData.end_date) < new Date(formData.start_date)) {
        newErrors.end_date = 'End date must be on or after start date';
      }
    }
    if (!formData.description?.trim() || formData.description.trim().length < 10) {
      newErrors.description = 'Description is required (min 10 characters)';
    } else if (formData.description.trim().length > 2000) {
      newErrors.description = 'Description must not exceed 2000 characters';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validateBudget = () => {
    if (!formData.budget_tier) {
      setBudgetError('Budget tier is required');
      return false;
    }
    setBudgetError('');
    return true;
  };

  const onClearTabError = () => setRoleTabError('');

  const createAllInvitations = async () => {
    const roleList = ['site_supervisor', 'safety_officer', 'data_analyst', 'stakeholder'];
    let totalInvited = 0;
    for (const role of roleList) {
      const members = pendingMembers[role] || [];
      if (members.length === 0) continue;
      for (const member of members) {
        try {
          await apiPost(`/projects/${projectId}/members/invite`, {
            email: member.email, role, full_name: member.name, send_email: false,
          });
          totalInvited++;
        } catch (err) {
          if (err.status === 409) { totalInvited++; continue; }
          let detail = err.message;
          try { detail = JSON.parse(err.message)?.detail || detail; } catch {}
          topTostError(`Failed to invite ${member.email}: ${detail}`);
          throw err;
        }
      }
    }
    return totalInvited;
  };

  const handleNext = async (e) => {
    e.preventDefault();
    if (currentStep.key === "info") {
      if (!validateStep1()) { setFlashRedIndex(currentIndex); return; }
      setSavingTab1(true);
      try {
        await apiPatch(`/projects/${projectId}/setup`, {
          name: (formData.name || '').trim(),
          location: (formData.location || '').trim(),
          description: formData.description || null,
          client_name: formData.client_name || null,
          start_date: formData.start_date || null,
          end_date: formData.end_date || null,
        });
      } catch (err) {
        topTostError(err.response?.data?.detail || 'Failed to save project details');
        setSavingTab1(false);
        return;
      }
      setSavingTab1(false);
    }
    if (currentStep.key === "budget") {
      if (!validateBudget()) { setFlashRedIndex(currentIndex); return; }
    }
    const roleTabKeys = ["supervisors", "safety", "analysts", "stakeholders"];
    if (roleTabKeys.includes(currentStep.key)) setRoleTabError('');
    if (currentStep.key === "cameras") {
      if (camerasTabRef.current && !camerasTabRef.current.validate()) {
        setFlashRedIndex(currentIndex); return;
      }
    }
    if (currentIndex < STEPS.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setMaxReached(Math.max(maxReached, currentIndex + 1));
      setFlashRedIndex(null);
      setRoleTabError('');
      setCamerasError('');
    }
  };

  const handlePrev = (e) => {
    e.preventDefault();
    setFlashRedIndex(null);
    setRoleTabError('');
    if (currentIndex > 0) setCurrentIndex(currentIndex - 1);
  };

  const handleTabClick = (e, index) => {
    e.preventDefault();
    if (index > maxReached) setFlashRedIndex(currentIndex);
  };

  const handleCancel = () => {
    clearDraft();
    navigate('/projects/my');
  };

  const handleDiscardDraft = () => {
    clearDraft();
    localStorage.removeItem(membersKey);
    setFormData(prefillData
      ? { ...EMPTY_FORM, name: prefillData.name || '', location: prefillData.location || '',
          description: prefillData.description || '', client_name: prefillData.client_name || '',
          start_date: prefillData.start_date || '', end_date: prefillData.end_date || '',
          budget_tier: prefillData.budget_tier || '' }
      : EMPTY_FORM
    );
    setNav({ currentIndex: 0, maxReached: 0 });
    setDraftBannerDismissed(true);
  };

  const currentStep = STEPS[currentIndex];
  const isLast  = currentIndex === STEPS.length - 1;
  const isFirst = currentIndex === 0;
  const showDraftBanner = hasDraft && !draftBannerDismissed;

  return (
    <div className="col-lg-12">
      {/* Draft restored banner — above card */}
      {showDraftBanner && (
        <div
          className="cs-draft-banner d-flex align-items-center gap-2 mx-0 mb-3 px-3 py-2 rounded-2"
          style={{ marginTop: 8 }}
        >
          <style>{`
            .cs-draft-banner {
              background: rgba(var(--bs-warning-rgb), 0.08);
              border: 0;
              border-left: 3px solid rgba(var(--bs-warning-rgb), 0.9);
              font-size: 13px;
            }
            .cs-draft-banner svg {
              stroke: rgba(var(--bs-warning-rgb), 1) !important;
              color: rgba(var(--bs-warning-rgb), 1) !important;
            }
            .cs-draft-banner-close svg,
            .cs-draft-banner-close:hover svg,
            .cs-draft-banner-close:focus svg,
            .cs-draft-banner-close:active svg {
              stroke: rgba(var(--bs-danger-rgb), 1) !important;
              color: rgba(var(--bs-danger-rgb), 1) !important;
            }
            .cs-draft-banner .cs-draft-banner-text {
              color: rgba(var(--bs-warning-rgb), 1) !important;
            }
            .cs-draft-banner-discard {
              color: rgba(var(--bs-danger-rgb), 1) !important;
              background: none;
              border: none;
              padding: 0;
              margin: 0;
              font: inherit;
              cursor: pointer;
              font-weight: 600;
              font-size: 12px;
            }
            .cs-draft-banner-discard:hover,
            .cs-draft-banner-discard:focus,
            .cs-draft-banner-discard:active {
              color: rgba(var(--bs-danger-rgb), 1) !important;
              background: none !important;
            }
            .cs-draft-banner-close {
              color: rgba(var(--bs-danger-rgb), 1) !important;
              background: none;
              border: none;
              padding: 0;
              margin: 0;
              line-height: 1;
              cursor: pointer;
              display: flex;
              align-items: center;
            }
            .cs-draft-banner-close:hover,
            .cs-draft-banner-close:focus {
              color: rgba(var(--bs-danger-rgb), 1) !important;
              background: none !important;
            }
          `}</style>
          <FiAlertCircle size={14} style={{ flexShrink: 0 }} />
          <span className="cs-draft-banner-text flex-grow-1">Draft restored from your last session</span>
          <span
            className="cs-draft-banner-discard"
            onClick={handleDiscardDraft}
            role="button"
            tabIndex={0}
          >
            DISCARD
          </span>
          <span
            className="cs-draft-banner-close ms-2"
            onClick={() => setDraftBannerDismissed(true)}
            title="Dismiss"
            role="button"
            tabIndex={0}
          >
            <FiX size={14} />
          </span>
        </div>
      )}
      <div className="card border-top-0">
        <div className={`card-body p-0 wizard ${currentStep.key === 'cameras' ? 'pm-setup-wide' : ''}`} id="pm-setup-steps">
          <div className="steps clearfix">
            <ul role="tablist">
              {STEPS.map((step, index) => {
                const isCurrent = index === currentIndex;
                const isDone    = index <= maxReached && !isCurrent;
                const isFuture  = index > maxReached;
                const isRed     = flashRedIndex === index;

                return (
                  <li
                    key={step.key}
                    className={isRed ? 'error' : isCurrent ? 'current' : isDone ? 'done' : ''}
                    style={{ cursor: 'default', position: 'relative' }}
                    onClick={(e) => handleTabClick(e, index)}
                  >
                    <a
                      href="#"
                      className="d-flex align-items-center justify-content-center gap-2 fw-bold"
                      onClick={e => e.preventDefault()}
                      style={{ opacity: isFuture ? 0.4 : 1, transition: 'opacity 0.2s' }}
                    >
                      <step.Icon size={13} strokeWidth={2} />
                      <span style={{ whiteSpace: 'nowrap' }}>{step.name}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="content clearfix">
            {currentStep.key === "info" && (
              <TabPMDetails formData={formData} setFormData={setFormData} errors={errors} setErrors={setErrors} />
            )}
            {currentStep.key === "budget" && (
              <TabPMBudget formData={formData} setFormData={setFormData} error={budgetError} setError={setBudgetError} />
            )}
            {currentStep.key === "supervisors" && <TabPMSiteSupervisors projectId={projectId} pendingMembers={pendingMembers.site_supervisor} setPendingMembers={(m) => setPendingMembers(prev => ({ ...prev, site_supervisor: m }))} tabError={roleTabError} onClearTabError={onClearTabError} availableUsers={availableUsers} usersLoadError={usersLoadError} />}
            {currentStep.key === "safety" && <TabPMSafetyOfficers projectId={projectId} pendingMembers={pendingMembers.safety_officer} setPendingMembers={(m) => setPendingMembers(prev => ({ ...prev, safety_officer: m }))} tabError={roleTabError} onClearTabError={onClearTabError} availableUsers={availableUsers} usersLoadError={usersLoadError} />}
            {currentStep.key === "analysts" && <TabPMDataAnalysts projectId={projectId} pendingMembers={pendingMembers.data_analyst} setPendingMembers={(m) => setPendingMembers(prev => ({ ...prev, data_analyst: m }))} tabError={roleTabError} onClearTabError={onClearTabError} availableUsers={availableUsers} usersLoadError={usersLoadError} />}
            {currentStep.key === "stakeholders" && <TabPMStakeholders projectId={projectId} pendingMembers={pendingMembers.stakeholder} setPendingMembers={(m) => setPendingMembers(prev => ({ ...prev, stakeholder: m }))} tabError={roleTabError} onClearTabError={onClearTabError} availableUsers={availableUsers} usersLoadError={usersLoadError} />}
            {currentStep.key === "cameras" && <TabPMCamerasZones ref={camerasTabRef} projectId={projectId} camerasError={camerasError} setCamerasError={setCamerasError} />}
            {currentStep.key === "activate" && <TabPMActivate projectId={projectId} settings={settings} setSettings={setSettings} onActivated={() => { clearDraft(); localStorage.removeItem(membersKey); onActivated(); }} onBeforeActivate={createAllInvitations} />}
          </div>

          <div className="actions clearfix">
            <ul className="d-flex align-items-center">
              {!isFirst && (
                <li className={savingTab1 ? "disabled" : ""}>
                  <a href="#" onClick={handlePrev}>Previous</a>
                </li>
              )}
              {!isLast && (
                <li className="ms-auto">
                  <a href="#" onClick={handleNext} style={{ pointerEvents: savingTab1 ? 'none' : 'auto', opacity: savingTab1 ? 0.5 : 1 }}>
                    {savingTab1 && <span className="spinner-border spinner-border-sm me-2"></span>}
                    Next
                  </a>
                </li>
              )}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PMSetupWizard;
