import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFormPersist } from '@/hooks/useFormPersist'
import {
    FiGrid, FiFileText, FiSettings, FiDollarSign,
    FiUsers, FiTarget, FiPaperclip, FiCheckCircle, FiAlertCircle, FiX,
} from 'react-icons/fi'
import { apiGet } from '@/utils/api'
import topTostError from '@/utils/topTostError'
import { validatePersonName, validateProjectDetails } from '@/utils/projectValidation'
import TabProjectType from './TabProjectType'
import TabProjectDetails from './TabProjectDetails';
import TabProjectSettings from './TabProjectSettings';
import TabProjectBudget from './TabProjectBudget';
import TabProjectAssigned from './TabProjectAssigned';
import TabProjectTarget from './TabProjectTarget';
import TabAttachement from './TabAttachement';
import TabCompleted from './TabCompleted';

const ALL_STEPS = [
    { key: "type",       name: "Type",       Icon: FiGrid,        required: false },
    { key: "details",    name: "Details",    Icon: FiFileText,    required: true  },
    { key: "settings",   name: "Settings",   Icon: FiSettings,    required: false },
    { key: "budget",     name: "Budget",     Icon: FiDollarSign,  required: false },
    { key: "assigned",   name: "Assigned",   Icon: FiUsers,       required: false },
    { key: "target",     name: "Target",     Icon: FiTarget,      required: false },
    { key: "attachment", name: "Attachment", Icon: FiPaperclip,   required: false },
    { key: "completed",  name: "Completed",  Icon: FiCheckCircle, required: false },
];

const ADMIN_SHELL_KEYS = ["type", "details", "assigned", "completed"];

const ProjectCreateContent = ({
    mode = "admin_shell",
    prefillData = null,
    projectId = null,
    onActivated = null,
}) => {
    const visibleSteps = mode === "admin_shell"
        ? ALL_STEPS.filter(s => ADMIN_SHELL_KEYS.includes(s.key))
        : ALL_STEPS;

    // currentIndex / maxReached are persisted with the draft so refresh returns to the same tab
    // Which tab index to flash red briefly when user attempts to skip
    const navigate = useNavigate()
    const [flashRedIndex, setFlashRedIndex] = useState(null);
    const [detailErrors, setDetailErrors] = useState({});
    const [pmError, setPmError] = useState(null);
    const [projectCreated, setProjectCreated] = useState(false);
    const [draftBannerDismissed, setDraftBannerDismissed] = useState(false);

    // Persist form drafts across page refreshes; skip for edit mode (data comes from API)
    const persistKey = mode === "pm_setup" && projectId
        ? `cs:draft:pm-setup:${projectId}`
        : `cs:draft:project-create`
    const [formData, setFormData, clearDraft, nav, setNav, hasDraft] = useFormPersist(persistKey, {
        projectType: "",
        projectManage: "",
        name: "",
        location: "",
        description: "",
        client_name: "",
        start_date: "",
        end_date: "",
        projectBudgets: "",
        budgetsSpend: "",
        pm_user_id: null,
    }, { skip: mode === "edit", initialNav: { currentIndex: 0, maxReached: 0 } });

    const currentIndex = nav.currentIndex
    const maxReached   = nav.maxReached
    const setCurrentIndex = (v) => setNav(n => ({ ...n, currentIndex: typeof v === 'function' ? v(n.currentIndex) : v }))
    const setMaxReached   = (v) => setNav(n => ({ ...n, maxReached:   typeof v === 'function' ? v(n.maxReached)   : v }))

    useEffect(() => {
        if (prefillData) {
            setFormData(prev => ({
                ...prev,
                name: prefillData.name || "",
                location: prefillData.location || "",
                description: prefillData.description || "",
                client_name: prefillData.client_name || "",
                start_date: prefillData.start_date || "",
                end_date: prefillData.end_date || "",
            }));
        }
    }, [prefillData]);

    // Load project data for edit mode
    useEffect(() => {
        if (mode === "edit" && projectId) {
            apiGet(`/admin/projects/${projectId}`)
                .then(data => {
                    if (data) {
                        setFormData(prev => ({
                            ...prev,
                            name: data.name || "",
                            location: data.location || "",
                            description: data.description || "",
                            client_name: data.client_name || "",
                            start_date: data.start_date || "",
                            end_date: data.end_date || "",
                        }));
                    }
                })
                .catch(err => topTostError("Failed to load project details"))
        }
    }, [mode, projectId]);

    const currentStep = visibleSteps[currentIndex];

    const validateCurrent = () => {
        if (currentStep.key === "details") {
            const errs = validateProjectDetails(formData);
            if (Object.keys(errs).length > 0) {
                setDetailErrors(errs);
                return false;
            }
            setDetailErrors({});
        }
        if (currentStep.key === "assigned" && mode === "admin_shell") {
            const assignType = formData.pm_assignment_type || 'existing';
            if (assignType === 'email') {
                const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.pm_email || '');
                const nameErr = validatePersonName(formData.pm_full_name, "PM full name");
                if (!emailOk || nameErr) {
                    setPmError(nameErr || "Please enter a valid email address.");
                    return false;
                }
            } else {
                if (!formData.pm_user_id) {
                    setPmError("Please select a Project Manager before continuing.");
                    return false;
                }
            }
            setPmError(null);
        }
        return true;
    };

    const handleNext = (e) => {
        e.preventDefault();
        if (validateCurrent()) {
            const next = Math.min(currentIndex + 1, visibleSteps.length - 1);
            setCurrentIndex(next);
            setMaxReached(prev => Math.max(prev, next));
            setFlashRedIndex(null);
        } else {
            setFlashRedIndex(currentIndex); // red underline on current tab when Next fails
        }
    };

    const handlePrev = (e) => {
        e.preventDefault();
        setFlashRedIndex(null); // clear red when going back
        setCurrentIndex(prev => Math.max(prev - 1, 0));
    };

    const handleTabClick = (e, index) => {
        e.preventDefault();
        // Tabs are progress indicators only — no click navigation
        // Use Next / Previous buttons to move between steps
        if (index > maxReached) {
            setFlashRedIndex(currentIndex);
        }
    };

    const isLast = currentIndex === visibleSteps.length - 1;
    const isFirst = currentIndex === 0;

    const cancelRoute = mode === "pm_setup" ? "/projects/my" : "/admin/projects/list";

    const handleCancel = () => {
        clearDraft();
        navigate(cancelRoute);
    };

    const handleDiscardDraft = () => {
        clearDraft();
        setFormData({
            projectType: "", projectManage: "", name: "", location: "",
            description: "", client_name: "", start_date: "", end_date: "",
            projectBudgets: "", budgetsSpend: "", pm_user_id: null,
        });
        setNav({ currentIndex: 0, maxReached: 0 });
        setDraftBannerDismissed(true);
    };

    const showDraftBanner = hasDraft && !draftBannerDismissed && !projectCreated && mode !== "edit";

    const showDetailErrors = (errs) => {
        setDetailErrors(errs);
        const detailsIndex = visibleSteps.findIndex(step => step.key === 'details');
        if (detailsIndex >= 0) {
            setCurrentIndex(detailsIndex);
            setMaxReached(prev => Math.max(prev, detailsIndex));
            setFlashRedIndex(detailsIndex);
        }
    };

    const showPmError = (message) => {
        setPmError(message);
        const assignedIndex = visibleSteps.findIndex(step => step.key === 'assigned');
        if (assignedIndex >= 0) {
            setCurrentIndex(assignedIndex);
            setMaxReached(prev => Math.max(prev, assignedIndex));
            setFlashRedIndex(assignedIndex);
        }
    };

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
                <div className="card-body p-0 wizard" id="project-create-steps">
                    <div className="steps clearfix">
                        <ul role="tablist">
                            {visibleSteps.map((step, index) => {
                                const isCurrent  = index === currentIndex;
                                const isDone     = index <= maxReached && !isCurrent;
                                const isFuture   = index > maxReached;
                                const isRed      = flashRedIndex === index;

                                // Line color — red > green (completed) > blue (current) > green (done)
                                const lineColor = isRed
                                    ? '#ef4444'
                                    : (isCurrent && projectCreated) ? '#10b981'
                                    : isCurrent ? '#3b82f6'
                                    : isDone    ? '#10b981'
                                    : 'transparent';

                                const liClass = isCurrent ? 'current' : isDone ? 'done' : '';

                                return (
                                    <li
                                        key={step.key}
                                        className={liClass}
                                        style={{
                                            cursor: 'default',
                                            position: 'relative',
                                        }}
                                        onClick={(e) => handleTabClick(e, index)}
                                    >
                                        <a
                                            href="#"
                                            className="d-flex align-items-center justify-content-center gap-2 fw-bold"
                                            onClick={e => e.preventDefault()}
                                            style={{ opacity: isFuture ? 0.4 : 1, transition: 'opacity 0.2s' }}
                                        >
                                            <span className="d-none d-md-inline-flex align-items-center gap-2">
                                                <step.Icon size={13} strokeWidth={2} />
                                                <span>{step.name}</span>
                                            </span>
                                            <span className="d-inline d-md-none" style={{ fontSize: 13, fontWeight: 700 }}>{index + 1}</span>
                                        </a>
                                        {/* Absolutely-positioned bottom line — no CSS conflict with theme */}
                                        <span style={{
                                            position: 'absolute',
                                            bottom: 0,
                                            left: 0,
                                            right: 0,
                                            height: 3,
                                            background: lineColor,
                                            transition: 'background 0.25s ease',
                                            pointerEvents: 'none',
                                        }} />
                                    </li>
                                );
                            })}
                        </ul>
                    </div>

                    <div className="content clearfix">
                        {currentStep.key === "type" && (
                            <TabProjectType setFormData={setFormData} formData={formData} error={false} setError={() => {}} />
                        )}
                        {currentStep.key === "details" && (
                            <TabProjectDetails formData={formData} setFormData={setFormData} errors={detailErrors} setErrors={setDetailErrors} />
                        )}
                        {currentStep.key === "settings" && <TabProjectSettings />}
                        {currentStep.key === "budget" && (
                            <TabProjectBudget setFormData={setFormData} formData={formData} error={false} setError={() => {}} />
                        )}
                        {currentStep.key === "assigned" && (
                            <TabProjectAssigned
                                formData={formData}
                                setFormData={setFormData}
                                mode={mode}
                                projectId={projectId}
                                pmError={pmError}
                                setPmError={setPmError}
                            />
                        )}
                        {currentStep.key === "target" && <TabProjectTarget />}
                        {currentStep.key === "attachment" && <TabAttachement />}
                        {currentStep.key === "completed" && (
                            <TabCompleted
                                formData={formData}
                                mode={mode}
                                projectId={projectId}
                                onActivated={onActivated}
                                onPrev={handlePrev}
                                onCreated={() => { clearDraft(); setProjectCreated(true); }}
                                onDetailValidationError={showDetailErrors}
                                onPmValidationError={showPmError}
                            />
                        )}
                    </div>

                    <div className="actions clearfix">
                        <ul>
                            {!(currentStep.key === "completed" && projectCreated) && (
                                <li className={isFirst ? "disabled" : ""}>
                                    <a href="#" onClick={handlePrev}>Previous</a>
                                </li>
                            )}
                            {!isLast && (
                                <li>
                                    <a href="#" onClick={handleNext}>Next</a>
                                </li>
                            )}
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ProjectCreateContent
