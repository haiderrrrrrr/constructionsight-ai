import React, { useState, useEffect, useImperativeHandle } from 'react';
import { FiPlus, FiTrash2, FiAlertCircle, FiEdit2, FiEye, FiX, FiTag, FiLayers } from 'react-icons/fi';
import { apiGet, apiPost, apiDelete, apiPatch } from '../../utils/api';
import topTostError from '../../utils/topTostError';
import ConfirmDialog from '../../components/shared/ConfirmDialog';
import { SelectDropdown } from '../../components/shared/Dropdown';
import { sanitizeProjectText, validateHumanText } from '../../utils/projectValidation';

const DEFAULT_CAMERA_LOGO = '/images/logo/security-camera-logo.png';
const MAX_DESC_WORDS = 50;
const countWords = (s) => s.trim() === '' ? 0 : s.trim().split(/\s+/).length;

const TabPMCamerasZones = React.forwardRef(({ projectId, camerasError, setCamerasError, onValidateNext }, ref) => {
  const [availableCameras, setAvailableCameras] = useState([]);
  const [assignedCameras, setAssignedCameras] = useState([]);
  const [zones, setZones] = useState([]);
  const [newZoneName, setNewZoneName] = useState('');
  const [newZoneType, setNewZoneType] = useState('');
  const [newZoneDescription, setNewZoneDescription] = useState('');
  const [newZoneErrors, setNewZoneErrors] = useState({});
  const [showZoneForm, setShowZoneForm] = useState(false);
  const [loadingCameras, setLoadingCameras] = useState(false);
  const [creatingZone, setCreatingZone] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [acting, setActing] = useState(false);
  const [editZone, setEditZone] = useState(null);
  const [viewZone, setViewZone] = useState(null);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [updatingZone, setUpdatingZone] = useState(false);
  const [editError, setEditError] = useState('');
  const [editZoneErrors, setEditZoneErrors] = useState({});
  const assignedCount = assignedCameras.length;
  const actionBtnStyle = { height: 40, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' };

  useEffect(() => {
    loadData();
  }, [projectId]);

  // Expose validation function to parent
  useImperativeHandle(ref, () => ({
    validate: () => {
      if (!assignedCameras || assignedCameras.length === 0) {
        if (setCamerasError) setCamerasError('Please assign at least 1 camera to the project');
        return false;
      }

      const camerasWithoutZones = assignedCameras.filter(cam => !cam.zone_id);
      if (camerasWithoutZones.length > 0) {
        const msg = `All ${assignedCameras.length} camera(s) must be assigned to a zone before proceeding`;
        if (setCamerasError) setCamerasError(msg);
        return false;
      }

      if (setCamerasError) setCamerasError('');
      return true;
    }
  }), [assignedCameras, setCamerasError]);

  const openEditZone = (zone) => {
    setEditZone(zone);
    setEditName(zone.name);
    setEditType(zone.zone_type || '');
    setEditDescription(zone.description || '');
    setEditError('');
    setEditZoneErrors({});
  };

  const closeEditZone = () => {
    setEditZone(null);
    setEditError('');
    setEditZoneErrors({});
  };
  const openViewZone = (zone) => setViewZone(zone);
  const closeViewZone = () => setViewZone(null);

  const truncate = (val, max = 90) => {
    const s = String(val || '').trim();
    if (!s) return '';
    if (s.length <= max) return s;
    return `${s.slice(0, max).trimEnd()}…`;
  };

  const handleUpdateZone = async () => {
    setEditError('');
    const errs = {};
    const nameErr = validateHumanText(editName, 'Zone name', { min: 1, max: 200 });
    if (nameErr) errs.name = nameErr;
    const descErr = validateHumanText(editDescription, 'Description', {
      required: false,
      min: 5,
      max: 500,
      multiline: true,
    });
    if (descErr) errs.description = descErr;
    if (countWords(editDescription) > MAX_DESC_WORDS) {
      errs.description = `Description must be ${MAX_DESC_WORDS} words or fewer`;
    }
    setEditZoneErrors(errs);

    if (Object.keys(errs).length) {
      return;
    }

    const name = sanitizeProjectText(editName);
    const description = sanitizeProjectText(editDescription, { multiline: true });
    setUpdatingZone(true);
    const prevZones = zones;
    try {
      // Optimistic update
      setZones(prev => prev.map(z => z.id === editZone.id ? { ...z, name, zone_type: editType || null, description: description || null } : z));

      await apiPatch(`/projects/${projectId}/zones/${editZone.id}`, {
        name,
        zone_type: editType || null,
        description: description || null,
      });
      topTostError('Zone updated successfully', 'success');
      closeEditZone();
    } catch (err) {
      // Rollback state on error
      setZones(prevZones);

      let errorMsg = err.response?.data?.detail || 'Failed to update zone';
      if (err.response?.status === 409 || err.response?.status === 400) {
        setEditZoneErrors({ name: errorMsg });
      } else {
        topTostError(errorMsg, 'error');
      }
    } finally {
      setUpdatingZone(false);
    }
  };

  const loadData = async () => {
    setLoadingCameras(true);
    try {
      const [availRes, assignedRes, zonesRes] = await Promise.all([
        apiGet(`/projects/${projectId}/cameras/available`),
        apiGet(`/projects/${projectId}/cameras`),
        apiGet(`/projects/${projectId}/zones`),
      ]);
      setAvailableCameras(availRes || []);
      setAssignedCameras(assignedRes || []);
      setZones(zonesRes || []);
    } catch (err) {
      topTostError('Failed to load cameras and zones');
    } finally {
      setLoadingCameras(false);
    }
  };

  const handleToggleCamera = async (cameraId, isAssigned) => {
    const camera = availableCameras.find(c => c.id === cameraId);
    if (!camera) {
      topTostError('Camera not found in available cameras');
      return;
    }

    try {
      // Optimistic update
      if (isAssigned) {
        setAssignedCameras(prev => prev.filter(c => c.id !== cameraId));
        setAvailableCameras(prev => prev.map(c => c.id === cameraId ? { ...c, is_assigned: false } : c));
      } else {
        setAssignedCameras(prev => [...prev, { ...camera, is_assigned: true }]);
        setAvailableCameras(prev => prev.map(c => c.id === cameraId ? { ...c, is_assigned: true } : c));
      }

      // API call
      if (isAssigned) {
        const result = await apiDelete(`/projects/${projectId}/cameras/${cameraId}`);
        if (!result || !result.ok) {
          topTostError('Failed to remove camera - please try again');
          await loadData();
          return;
        }
      } else {
        const result = await apiPost(`/projects/${projectId}/cameras/${cameraId}`, {});
        if (!result || !result.ok) {
          topTostError('Failed to assign camera - please try again');
          await loadData();
          return;
        }
      }

      const action = isAssigned ? 'removed from' : 'added to';
      topTostError(`Camera "${camera.name}" ${action} project`, 'success');
    } catch (err) {
      await loadData();
      topTostError(err.response?.data?.detail || 'Failed to update camera assignment');
    }
  };

  const handleChangeZone = async (cameraId, zoneId) => {
    // Validate camera is actually assigned
    const camera = assignedCameras.find(c => c.id === cameraId);
    if (!camera) {
      topTostError('Camera is not assigned to this project');
      return;
    }

    // Validate zone exists if one is selected
    if (zoneId) {
      const zone = zones.find(z => z.id === parseInt(zoneId));
      if (!zone) {
        topTostError('Selected zone not found');
        return;
      }
    }

    try {
      // Optimistic update
      setAssignedCameras(prev => prev.map(c => c.id === cameraId ? { ...c, zone_id: zoneId || null } : c));

      const result = await apiPatch(`/projects/${projectId}/cameras/${cameraId}/zone`, {
        zone_id: zoneId || null,
      });

      // Validate response
      if (!result || !result.ok) {
        topTostError('Zone assignment failed - please try again');
        await loadData();
        return;
      }

      const zoneName = zoneId ? zones.find(z => z.id === parseInt(zoneId))?.name : 'None';
      topTostError(`Zone "${zoneName}" assigned to "${camera.name}"`, 'success');
    } catch (err) {
      await loadData();
      topTostError(err.response?.data?.detail || 'Failed to assign zone to camera');
    }
  };

  const handleCreateZone = async () => {
    const errs = {};
    const nameErr = validateHumanText(newZoneName, 'Zone name', { min: 1, max: 200 });
    if (nameErr) errs.name = nameErr;
    const descErr = validateHumanText(newZoneDescription, 'Description', {
      required: false,
      min: 5,
      max: 500,
      multiline: true,
    });
    if (descErr) errs.description = descErr;
    if (countWords(newZoneDescription) > MAX_DESC_WORDS) {
      errs.description = `Description must be ${MAX_DESC_WORDS} words or fewer`;
    }
    setNewZoneErrors(errs);
    if (Object.keys(errs).length) {
      return;
    }

    const name = sanitizeProjectText(newZoneName);
    const description = sanitizeProjectText(newZoneDescription, { multiline: true });
    setCreatingZone(true);
    try {
      const res = await apiPost(`/projects/${projectId}/zones`, {
        name,
        zone_type: newZoneType || null,
        description: description || null,
      });
      // Add to state immediately (optimistic)
      if (res?.id) {
        setZones(prev => [...prev, res]);
      }
      setNewZoneName('');
      setNewZoneType('');
      setNewZoneDescription('');
      setNewZoneErrors({});
      setShowZoneForm(false);
      topTostError('Zone created', 'success');
    } catch (err) {
      // Extract detailed error message from error response
      let errorMsg = 'Failed to create zone';

      try {
        // Try to parse JSON from error message
        const errorData = JSON.parse(err.message || '{}');
        errorMsg = errorData.detail || errorData.message || errorMsg;
      } catch {
        // If not JSON, use the error message as is
        errorMsg = err.message || errorMsg;
      }

      setNewZoneErrors({ name: errorMsg });
    } finally {
      setCreatingZone(false);
    }
  };

  const askDeleteZone = (zone) => {
    // Count cameras assigned to this zone
    const cameraCount = assignedCameras.filter(cam => cam.zone_id === zone.id).length;

    // Prevent deletion if cameras are assigned
    if (cameraCount > 0) {
      topTostError(
        `Cannot delete zone "${zone.name}". It has ${cameraCount} camera(s) assigned. Unassign cameras first.`,
        'error'
      );
      return;
    }

    setConfirm({
      variant: 'danger',
      title: 'Delete Zone',
      message: `Delete "${zone.name}" permanently? This cannot be undone.`,
      onConfirm: async () => {
        try {
          const res = await apiDelete(`/projects/${projectId}/zones/${zone.id}`);
          // Optimistic update
          setZones(prev => prev.filter(z => z.id !== zone.id));
          topTostError(`Zone "${zone.name}" deleted successfully`, 'success');
          setConfirm(null);
        } catch (err) {
          const errMsg = err.response?.data?.detail || 'Failed to delete zone';
          topTostError(errMsg, 'error');
        }
      },
    });
  };

  const closeConfirm = () => { if (!acting) setConfirm(null); };
  const runConfirm = async () => {
    if (!confirm) return;
    setActing(true);
    try {
      await confirm.onConfirm();
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="step-body mt-4 body current">
      <style>{`
        .pm-cam-logo {
          width: 40px;
          height: 40px;
          border-radius: 999px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: var(--bs-secondary-bg);
          border: 1px solid var(--bs-border-color);
          overflow: hidden;
          flex: 0 0 auto;
        }
        html.app-skin-dark .pm-cam-logo {
          background: rgba(255,255,255,0.08);
          border-color: rgba(255,255,255,0.12);
        }
        .pm-cam-logo img {
          width: 24px;
          height: 24px;
          object-fit: contain;
          display: block;
        }
        .pm-zone-select {
          min-height: 38px;
        }
        .pm-zone-textarea {
          min-height: 110px;
          resize: none !important;
          font-size: 0.875rem;
        }
        .pm-zone-view-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.55);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1050;
          padding: 18px;
        }
        .pm-zone-view-card {
          width: min(860px, 100%);
          border-radius: 14px;
          border: 1px solid var(--bs-border-color);
          overflow: hidden;
          box-shadow: 0 18px 60px rgba(0,0,0,0.35);
          color: rgba(2,6,23,0.86);
        }
        html.app-skin-dark .pm-zone-view-card {
          color: rgba(255,255,255,0.86);
        }
        .pm-zone-card-title { font-size: 1.25rem; font-weight: 700; letter-spacing: 0; line-height: 1.2; color: rgba(2,6,23,0.92); }
        html.app-skin-dark .pm-zone-card-title { color: rgba(255,255,255,0.92); }
        .pm-zone-card-sub { font-size: 0.75rem; font-weight: 400; letter-spacing: 0; line-height: 1.3; color: rgba(2,6,23,0.58); }
        html.app-skin-dark .pm-zone-card-sub { color: rgba(255,255,255,0.62); }
        html.app-skin-dark .pm-zone-view-card .btn-close {
          filter: invert(1) grayscale(100%);
          opacity: .8;
        }
        html.app-skin-dark .pm-zone-view-card .text-muted { color: rgba(255,255,255,0.62) !important; }
        .pm-zone-avatar-wrap {
          width: 72px;
          height: 72px;
          border-radius: 999px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(2,6,23,0.06);
          border: 1px solid var(--bs-border-color);
        }
        html.app-skin-dark .pm-zone-avatar-wrap {
          background: rgba(255,255,255,0.08);
          border-color: rgba(255,255,255,0.12);
        }
        .pm-zone-avatar-wrap svg { color: rgba(2,6,23,0.92); }
        html.app-skin-dark .pm-zone-avatar-wrap svg { color: rgba(255,255,255,0.92); }
        .pm-zone-split-col { border-left: 1px dashed var(--bs-border-color); }
        html.app-skin-dark .pm-zone-split-col { border-left-color: rgba(255,255,255,0.10); }
        @media (max-width: 767.98px) { .pm-zone-split-col { border-left: none; } }
        .pm-zone-surface {
          background: rgba(255,255,255,0.025);
          border: 1px solid rgba(255,255,255,0.06);
        }
        html.app-skin-dark .pm-zone-surface {
          background: rgba(255,255,255,0.06);
          border-color: rgba(255,255,255,0.10);
        }
        .pm-table-wrap { border-radius: 0.5rem; overflow: visible; }
        .pm-table-wrap .table > :not(caption) > * > * { padding: 0.95rem 0.85rem; }
        .pm-table-wrap .table thead th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
        .pm-table-wrap .table td { vertical-align: middle; }
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
        .pm-pill-primary {
          background: rgba(var(--bs-primary-rgb), 1);
          border: 0;
          color: #fff;
        }
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
          Cameras & Zones
        </div>
        <h2 className="fw-bolder mb-2" style={{ fontSize: '22px', lineHeight: '1.2' }}>
          Camera & Zone Configuration
        </h2>
        <p className="fs-12 fw-medium text-muted mb-0" style={{ lineHeight: '1.6' }}>
          Assign cameras and organize them into zones
        </p>
      </div>
      <div className="row g-3">
        <div className="col-12">
          <div className="card">
            <div className="card-header">
              <div>
                <h5 className="mb-0">Available Cameras</h5>
                <span className="fs-12 text-muted">Verified cameras available for assignment</span>
              </div>
              <span className="badge bg-soft-warning text-warning">{availableCameras.length}</span>
            </div>
            <div className="card-body custom-card-action p-0">
              {loadingCameras ? (
                <div className="d-flex align-items-center justify-content-center py-5">
                  <div className="spinner-border spinner-border-sm text-primary" role="status" />
                </div>
              ) : availableCameras.length === 0 ? (
                <div className="p-5 d-flex flex-column align-items-center justify-content-center text-muted" style={{ minHeight: '200px' }}>
                  <FiAlertCircle size={32} className="mb-3" style={{ opacity: 0.5 }} />
                  <span className="text-center">No verified cameras found. Ask your admin to register and verify cameras first.</span>
                </div>
              ) : (
                <div className="table-responsive pm-table-wrap" style={{ overflow: 'visible' }}>
                  <table className="table table-hover mb-0 align-middle">
                    <colgroup>
                      <col style={{ width: '45%' }} />
                      <col style={{ width: '45%' }} />
                      <col style={{ width: '10%' }} />
                    </colgroup>
                    <thead>
                      <tr className="border-b">
                        <th scope="row">Camera</th>
                        <th>Verification Status</th>
                        <th className="text-end">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {availableCameras.map((cam) => (
                        <tr key={cam.id}>
                          <td>
                            <div className="d-flex align-items-center gap-3">
                              <div className="pm-cam-logo">
                                <img
                                  src={cam.logo_url || DEFAULT_CAMERA_LOGO}
                                  alt=""
                                  onError={(e) => { e.currentTarget.src = DEFAULT_CAMERA_LOGO; }}
                                />
                              </div>
                              <div className="min-w-0">
                                <span className="d-block fw-semibold">{cam.name}</span>
                                <span className="fs-12 d-block fw-normal text-muted text-truncate-1-line">
                                  {(cam.vendor || '').trim()} {(cam.model || '').trim()}
                                </span>
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className="badge bg-soft-success text-success text-uppercase">
                              {(cam.registry_status || 'verified').toString()}
                            </span>
                          </td>
                          <td className="text-end">
                            <button
                              type="button"
                              className={`btn btn-sm ${cam.is_assigned ? 'btn-danger' : 'btn-primary'}`}
                              onClick={() => handleToggleCamera(cam.id, cam.is_assigned)}
                            >
                              {cam.is_assigned ? 'Remove' : 'Assign'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="col-12">
          <div className="card">
            <div className="card-header">
              <div>
                <h5 className="mb-0">Camera Zone Assignment</h5>
                <span className="fs-12 text-muted">Assign each camera to a zone</span>
              </div>
              <span className="badge bg-soft-success text-success text-uppercase">{assignedCount} Assigned</span>
            </div>
            <div className="card-body custom-card-action p-0" style={{ overflow: 'visible' }}>
              {loadingCameras ? (
                <div className="d-flex align-items-center justify-content-center py-5">
                  <div className="spinner-border spinner-border-sm text-primary" role="status" />
                </div>
              ) : assignedCameras.length === 0 ? (
                <div className="p-5 d-flex flex-column align-items-center justify-content-center text-muted" style={{ minHeight: '200px' }}>
                  <FiAlertCircle size={32} className="mb-3" style={{ opacity: 0.5 }} />
                  <span className="text-center">Assign cameras first to configure zones</span>
                </div>
              ) : (
                <div className="table-responsive pm-table-wrap">
                  <table className="table table-hover mb-0 align-middle">
                    <colgroup>
                      <col style={{ width: '45%' }} />
                      <col style={{ width: '40%' }} />
                      <col style={{ width: '15%' }} />
                    </colgroup>
                    <thead>
                      <tr className="border-b">
                        <th scope="row">Camera</th>
                        <th>Zone</th>
                        <th className="text-end">Zone Assignment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assignedCameras.map((cam) => (
                        <tr key={cam.id} style={{ minHeight: '80px' }}>
                          <td>
                            <div className="d-flex align-items-center gap-3">
                              <div className="pm-cam-logo">
                                <img
                                  src={cam.logo_url || DEFAULT_CAMERA_LOGO}
                                  alt=""
                                  onError={(e) => { e.currentTarget.src = DEFAULT_CAMERA_LOGO; }}
                                />
                              </div>
                              <div className="min-w-0">
                                <span className="d-block fw-semibold">{cam.name}</span>
                                <span className="fs-12 d-block fw-normal text-muted text-truncate-1-line">
                                  {(cam.vendor || '').trim()} {(cam.model || '').trim()}
                                </span>
                              </div>
                            </div>
                          </td>
                          <td>
                            <SelectDropdown
                              value={cam.zone_id ? String(cam.zone_id) : ''}
                              placeholder={zones.length === 0 ? 'Create a zone first' : 'Select zone'}
                              disabled={zones.length === 0}
                              options={zones.map((z) => ({ value: String(z.id), label: z.name }))}
                              onChange={(v) => handleChangeZone(cam.id, v ? parseInt(v) : null)}
                              fullWidth={false}
                              menuMatchTriggerWidth={true}
                              menuStyle={{ zIndex: 5000 }}
                              buttonClassName="form-select-sm pm-zone-select"
                              buttonStyle={{ width: 200, maxWidth: '100%', borderRadius: '0.375rem' }}
                            />
                          </td>
                          <td className="text-end">
                            {cam.zone_id ? (
                              <span className="badge bg-soft-success text-success text-uppercase">Assigned</span>
                            ) : (
                              <span className="badge bg-soft-danger text-danger text-uppercase">Required</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="col-12">
          <div className="card">
            <div className="card-header">
              <div>
                <h5 className="mb-0">Zones</h5>
                <span className="fs-12 text-muted">Manage zones for camera grouping</span>
              </div>
              <button
                type="button"
                className={`btn d-inline-flex align-items-center ${showZoneForm ? 'btn-danger' : 'btn-success'}`}
                onClick={() => setShowZoneForm((v) => !v)}
                style={actionBtnStyle}
              >
                {showZoneForm ? <FiX size={14} className="me-1" /> : <FiPlus size={14} className="me-1" />}
                {showZoneForm ? 'Close' : 'Create Zone'}
              </button>
            </div>
            <div className="card-body p-0" style={{ overflow: 'visible' }}>
              <style>{`
                .pm-zone-action{ outline:none; box-shadow:none; border:0; }
                .pm-zone-action:focus,.pm-zone-action:focus-visible{ outline:none; box-shadow:none; }
              `}</style>
              {showZoneForm && (
                <div className="p-3">
                    <div className="row g-2 mb-3">
                      <div className="col-12 col-md-6">
                        <label className="fs-11 fw-semibold text-muted text-uppercase mb-1" style={{ letterSpacing: '0.06em' }}>
                          Zone Name <span className="text-danger">*</span>
                        </label>
                        <div className="input-group">
                          <span className="input-group-text">
                            <FiTag size={14} />
                          </span>
                          <input
                            type="text"
                            className="form-control"
                            placeholder="Zone name"
                            value={newZoneName}
                            maxLength="200"
                            onChange={(e) => {
                              setNewZoneName(e.target.value);
                              setNewZoneErrors(prev => ({ ...prev, name: null }));
                            }}
                            style={{ fontSize: '0.875rem' }}
                          />
                        </div>
                        {newZoneErrors.name && (
                          <div className="text-danger fs-11 mt-1">{newZoneErrors.name}</div>
                        )}
                      </div>
                      <div className="col-12 col-md-6">
                        <label className="fs-11 fw-semibold text-muted text-uppercase mb-1" style={{ letterSpacing: '0.06em' }}>
                          Zone Type
                        </label>
                        <SelectDropdown
                          value={newZoneType}
                          placeholder="Select zone type"
                          options={[
                            { value: 'scaffold', label: 'Scaffold' },
                            { value: 'entry', label: 'Entry' },
                            { value: 'storage', label: 'Storage' },
                            { value: 'perimeter', label: 'Perimeter' },
                            { value: 'other', label: 'Other' },
                          ]}
                          onChange={(v) => setNewZoneType(v)}
                          buttonStyle={{ fontSize: '0.875rem' }}
                        />
                      </div>
                    </div>
                    <div className="mb-3">
                      <label className="fs-11 fw-semibold text-muted text-uppercase mb-1" style={{ letterSpacing: '0.06em' }}>
                        Description
                      </label>
                      <textarea
                        className={`form-control pm-zone-textarea${countWords(newZoneDescription) > MAX_DESC_WORDS ? ' is-invalid' : ''}`}
                        placeholder="Enter a brief description of this zone and its monitoring purpose"
                        value={newZoneDescription}
                        rows="3"
                        onChange={(e) => {
                          setNewZoneDescription(e.target.value);
                          setNewZoneErrors(prev => ({ ...prev, description: null }));
                        }}
                      />
                      {newZoneErrors.description && (
                        <div className="text-danger fs-11 mt-1">{newZoneErrors.description}</div>
                      )}
                      <div className={`fs-11 mt-1 text-end ${countWords(newZoneDescription) > MAX_DESC_WORDS ? 'text-danger fw-semibold' : 'text-muted'}`}>
                        {countWords(newZoneDescription)} / {MAX_DESC_WORDS} words
                      </div>
                    </div>
                    <div className="d-flex gap-2">
                      <button
                        type="button"
                        className="btn btn-lg btn-success"
                        onClick={handleCreateZone}
                        disabled={creatingZone}
                        style={actionBtnStyle}
                      >
                        {creatingZone && <span className="spinner-border spinner-border-sm me-2"></span>}
                        <FiPlus size={14} className="me-1" />
                        Create Zone
                      </button>
                      <button
                        type="button"
                        className="btn btn-lg btn-outline-secondary"
                        onClick={() => {
                          setShowZoneForm(false);
                          setNewZoneName('');
                          setNewZoneType('');
                          setNewZoneDescription('');
                          setNewZoneErrors({});
                        }}
                        disabled={creatingZone}
                        style={actionBtnStyle}
                      >
                        Cancel
                      </button>
                    </div>
                </div>
              )}

              {zones.length === 0 ? (
                <div className="p-5 d-flex flex-column align-items-center justify-content-center text-muted" style={{ minHeight: '200px' }}>
                  <FiAlertCircle size={32} className="mb-3" style={{ opacity: 0.5 }} />
                  <span className="text-center">No zones created yet</span>
                </div>
              ) : (
                <div className="table-responsive pm-table-wrap">
                  <table className="table table-hover mb-0 align-middle">
                    <colgroup>
                      <col style={{ width: '20%' }} />
                      <col style={{ width: '50%' }} />
                      <col style={{ width: '15%' }} />
                      <col style={{ width: '15%' }} />
                    </colgroup>
                    <thead>
                      <tr className="border-b">
                        <th scope="row">Zone</th>
                        <th>Description</th>
                        <th>Type</th>
                        <th className="text-end">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {zones.map((zone) => (
                        <tr key={zone.id} style={{ verticalAlign: 'middle', minHeight: '60px' }}>
                          <td>
                            <span className="pm-pill pm-pill-warning">{zone.name}</span>
                          </td>
                          <td>
                            {zone.description ? (
                              <span className="cam-meta">
                                <span className="cam-meta-text text-truncate-2-line" style={{ maxWidth: '100%' }}>
                                  {truncate(zone.description, 120)}
                                </span>
                              </span>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                          <td>
                            <span className="pm-pill pm-pill-primary">
                              {zone.zone_type ? zone.zone_type.toString() : 'None'}
                            </span>
                          </td>
                          <td className="text-end">
                            <div className="hstack gap-2 justify-content-end">
                              <button
                                type="button"
                                className="avatar-text avatar-md"
                                onClick={() => openViewZone(zone)}
                                title="View zone"
                              >
                                <FiEye />
                              </button>
                              <button
                                type="button"
                                className="pm-zone-action"
                                onClick={() => openEditZone(zone)}
                                title="Edit zone"
                                style={{
                                  width: 30,
                                  height: 30,
                                  borderRadius: '50%',
                                  background: '#3b82f6',
                                  border: '2px solid transparent',
                                  color: '#fff',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  cursor: 'pointer',
                                  padding: 0,
                                  lineHeight: 1,
                                  boxSizing: 'border-box',
                                }}
                              >
                                <FiEdit2 size={13} strokeWidth={2} />
                              </button>
                              <button
                                type="button"
                                className="pm-zone-action"
                                onClick={() => askDeleteZone(zone)}
                                title="Delete zone"
                                style={{
                                  width: 30,
                                  height: 30,
                                  borderRadius: '50%',
                                  background: '#ef4444',
                                  border: '2px solid transparent',
                                  color: '#fff',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  cursor: 'pointer',
                                  padding: 0,
                                  lineHeight: 1,
                                  boxSizing: 'border-box',
                                }}
                              >
                                <FiTrash2 size={13} strokeWidth={2} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Cameras Validation Error */}
      {camerasError && (
        <>
          <style>{`.pm-error svg{stroke:#ef4444!important;color:#ef4444!important;}`}</style>
          <div className="pm-error d-flex align-items-center gap-2 mt-4 px-3 py-2 rounded-2"
            style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.22)', borderLeft: '3px solid #ef4444' }}>
            <FiAlertCircle size={14} color="#ef4444" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: '0.8rem', color: '#ef4444' }}>{camerasError}</span>
          </div>
        </>
      )}

      {/* Edit Zone Modal */}
      {editZone && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.45)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1050
        }} onClick={closeEditZone}>
          <div className="card" style={{ maxWidth: '460px', width: '90%' }} onClick={(e) => e.stopPropagation()}>
            <div className="card-body p-4">
              <div className="d-flex justify-content-between align-items-center mb-3">
                <h5 className="mb-0">Edit Zone</h5>
                <button type="button" className="btn-close" onClick={closeEditZone} />
              </div>

              <div className="mb-3">
                <label className="fs-11 fw-semibold text-muted text-uppercase mb-1" style={{ letterSpacing: '0.06em' }}>
                  Zone Name <span className="text-danger">*</span>
                </label>
                <div className="input-group">
                  <span className="input-group-text">
                    <FiTag size={14} />
                  </span>
                  <input
                    type="text"
                    className="form-control"
                    value={editName}
                    maxLength="200"
                    onChange={(e) => {
                      setEditName(e.target.value);
                      setEditError('');
                      setEditZoneErrors(prev => ({ ...prev, name: null }));
                    }}
                    placeholder="Zone name"
                    style={{ fontSize: '0.875rem' }}
                  />
                </div>
                {editZoneErrors.name && (
                  <div className="text-danger fs-11 mt-1">{editZoneErrors.name}</div>
                )}
              </div>

              <div className="mb-3">
                <label className="fs-11 fw-semibold text-muted text-uppercase mb-1" style={{ letterSpacing: '0.06em' }}>
                  Zone Type
                </label>
                <SelectDropdown
                  value={editType}
                  placeholder="Select zone type"
                  options={[
                    { value: 'scaffold', label: 'Scaffold' },
                    { value: 'entry', label: 'Entry' },
                    { value: 'storage', label: 'Storage' },
                    { value: 'perimeter', label: 'Perimeter' },
                    { value: 'other', label: 'Other' },
                  ]}
                  onChange={(v) => setEditType(v)}
                  buttonStyle={{ fontSize: '0.875rem' }}
                />
              </div>

              <div className="mb-3">
                <label className="fs-11 fw-semibold text-muted text-uppercase mb-1" style={{ letterSpacing: '0.06em' }}>
                  Description
                </label>
                <textarea
                  className="form-control pm-zone-textarea"
                  value={editDescription}
                  maxLength="500"
                  rows="3"
                  onChange={(e) => {
                    setEditDescription(e.target.value);
                    setEditZoneErrors(prev => ({ ...prev, description: null }));
                  }}
                  placeholder="Enter a brief description of this zone and its monitoring purpose"
                />
                {editZoneErrors.description && (
                  <div className="text-danger fs-11 mt-1">{editZoneErrors.description}</div>
                )}
              </div>

              {editError && (
                <div className="pm-error d-flex align-items-center gap-2 mb-3 px-3 py-2 rounded-2"
                  style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.22)', borderLeft: '3px solid #ef4444' }}>
                  <FiAlertCircle size={14} color="#ef4444" style={{ flexShrink: 0 }} />
                  <span style={{ fontSize: '0.8rem', color: '#ef4444' }}>{editError}</span>
                </div>
              )}

              <div className="d-flex gap-2">
                <button
                  type="button"
                  className="btn btn-lg btn-primary flex-grow-1"
                  onClick={handleUpdateZone}
                  disabled={updatingZone}
                  style={actionBtnStyle}
                >
                  {updatingZone && <span className="spinner-border spinner-border-sm me-2"></span>}
                  Update Zone
                </button>
                <button
                  type="button"
                  className="btn btn-lg btn-outline-secondary flex-grow-1"
                  onClick={closeEditZone}
                  disabled={updatingZone}
                  style={actionBtnStyle}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {viewZone && (
        <div className="pm-zone-view-overlay" onClick={closeViewZone}>
          <div className="card pm-zone-view-card" onClick={(e) => e.stopPropagation()}>
            <div className="card-header d-flex align-items-center justify-content-between">
              <div>
                <div className="pm-zone-card-title">Zone Overview</div>
                <div className="pm-zone-card-sub">Overview of zone configuration and monitoring purpose</div>
              </div>
              <button type="button" className="btn-close" onClick={closeViewZone} />
            </div>
            <div className="card-body p-4">
              <div className="row g-4 align-items-start">
                <div className="col-md-4">
                  <div className="text-center">
                    <div className="pm-zone-avatar-wrap mx-auto">
                      <FiLayers size={26} />
                    </div>
                    <div className="mt-3 d-flex align-items-center justify-content-center gap-2 flex-wrap">
                      <span className="fs-11 fw-semibold text-muted text-uppercase" style={{ letterSpacing: '0.06em' }}>
                        Zone Name:
                      </span>
                      <span className="badge bg-soft-secondary text-secondary fs-11 fw-bold text-uppercase">
                        {viewZone.name}
                      </span>
                    </div>
                    <div className="mt-2 d-flex align-items-center justify-content-center gap-2 flex-wrap">
                      <span className="fs-11 fw-semibold text-muted text-uppercase" style={{ letterSpacing: '0.06em' }}>
                        Zone Type:
                      </span>
                      <span className="badge bg-soft-secondary text-secondary fs-11 fw-bold">
                        {viewZone.zone_type ? (String(viewZone.zone_type).charAt(0).toUpperCase() + String(viewZone.zone_type).slice(1)) : 'None'}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="col-md-8 pm-zone-split-col">
                  <div className="pm-zone-surface rounded-3 p-3">
                    <div className="fs-11 fw-semibold text-muted text-uppercase mb-2" style={{ letterSpacing: '0.06em' }}>
                      Description
                    </div>
                    <div className="fs-13" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                      {String(viewZone.description || '').trim() || 'None'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirm}
        variant={confirm?.variant}
        title={confirm?.title}
        message={confirm?.message}
        loading={acting}
        onClose={closeConfirm}
        onConfirm={runConfirm}
      />
    </div>
  );
});

TabPMCamerasZones.displayName = 'TabPMCamerasZones';
export default TabPMCamerasZones;
