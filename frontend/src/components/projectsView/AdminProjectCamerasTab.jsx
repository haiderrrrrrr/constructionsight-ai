import React, { useState, useEffect } from 'react';
import { FiPlus, FiTrash2, FiAlertCircle, FiEdit2, FiEye, FiX, FiTag, FiLayers } from 'react-icons/fi';
import { apiGet, apiPost, apiDelete, apiPatch } from '@/utils/api';
import topTostError from '@/utils/topTostError';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { SelectDropdown } from '@/components/shared/Dropdown';
import { sanitizeProjectText, validateHumanText } from '@/utils/projectValidation';

const DEFAULT_CAMERA_LOGO = '/images/logo/security-camera-logo.png';
const MAX_DESC_WORDS = 50;
const countWords = (s) => s.trim() === '' ? 0 : s.trim().split(/\s+/).length;
const truncate = (val, max = 90) => {
    const s = String(val || '').trim();
    if (!s) return '';
    if (s.length <= max) return s;
    return `${s.slice(0, max).trimEnd()}…`;
};

const AdminProjectCamerasTab = ({ projectId, projectStatus, projectSiteId }) => {
    const isArchived = projectStatus === 'archived';
    const actionBtnStyle = { height: 40, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' };

    // All cameras with is_assigned flag marking if assigned to this project
    const [availableCameras, setAvailableCameras] = useState([]);
    // Cameras currently assigned to this project (for zone assignment)
    const [assignedCameras, setAssignedCameras] = useState([]);
    const [zones, setZones] = useState([]);

    const [loadingCameras, setLoadingCameras] = useState(true);
    const [creatingZone, setCreatingZone] = useState(false);
    const [acting, setActing] = useState(false);

    const [showZoneForm, setShowZoneForm] = useState(false);
    const [newZoneName, setNewZoneName] = useState('');
    const [newZoneType, setNewZoneType] = useState('');
    const [newZoneDescription, setNewZoneDescription] = useState('');
    const [newZoneErrors, setNewZoneErrors] = useState({});

    const [confirm, setConfirm] = useState(null);

    const [editZone, setEditZone] = useState(null);
    const [editName, setEditName] = useState('');
    const [editType, setEditType] = useState('');
    const [editDescription, setEditDescription] = useState('');
    const [updatingZone, setUpdatingZone] = useState(false);
    const [editError, setEditError] = useState('');
    const [editZoneErrors, setEditZoneErrors] = useState({});
    const [viewZone, setViewZone] = useState(null);

    useEffect(() => { loadData(); }, [projectId]);

    const loadData = async () => {
        setLoadingCameras(true);
        try {
            const [allCamsRes, assignedRes, zonesRes] = await Promise.all([
                apiGet('/admin/cameras'),
                apiGet(`/admin/projects/${projectId}/cameras`),
                apiGet(`/projects/${projectId}/zones`),
            ]);
            const allCams = Array.isArray(allCamsRes) ? allCamsRes : [];
            const assigned = Array.isArray(assignedRes) ? assignedRes : [];
            const assignedIds = new Set(assigned.map(c => c.id));

            // Merge: show only cameras that are:
            // 1. Not archived globally, AND
            // 2. Either assigned to THIS project OR not assigned to any project
            const merged = allCams
                .filter(c =>
                    !c.archived_at &&
                    (!projectSiteId || c.site_id === projectSiteId) &&
                    (assignedIds.has(c.id) || !c.project_id)
                )
                .map(c => ({ ...c, is_assigned: assignedIds.has(c.id) }));

            setAvailableCameras(merged);  // Cameras for this project only
            setAssignedCameras(assigned);   // Cameras assigned to this project (for zone assignment)
            setZones(Array.isArray(zonesRes) ? zonesRes : []);
        } catch (err) {
            console.error('Failed to load cameras and zones:', err);
            topTostError('Failed to load cameras and zones');
        } finally {
            setLoadingCameras(false);
        }
    };


    // Toggle camera assignment (Assign or Remove)
    const handleToggleCamera = async (cameraId, isAssigned) => {
        console.log('[handleToggleCamera] Called with cameraId:', cameraId, 'isAssigned:', isAssigned);
        const camera = availableCameras.find(c => c.id === cameraId);
        console.log('[handleToggleCamera] Found camera:', camera);
        if (!camera) {
            console.warn('[handleToggleCamera] Camera not found');
            return;
        }

        // If removing, show warning dialog first
        if (isAssigned) {
            console.log('[handleToggleCamera] Showing removal confirmation dialog');
            setConfirm({
                variant: 'warning',
                title: 'Unassign Camera',
                message: `Unassigning "${camera.name}" will stop any active inferences for this camera. Continue?`,
                onConfirm: async () => {
                    console.log('[handleToggleCamera.onConfirm] Removal confirmed, proceeding with unassign');
                    // Optimistic update
                    setAvailableCameras(prev => prev.map(c => c.id === cameraId ? { ...c, is_assigned: false } : c));
                    setAssignedCameras(prev => prev.filter(c => c.id !== cameraId));

                    try {
                        console.log('[handleToggleCamera.onConfirm] Calling DELETE /admin/cameras/' + cameraId + '/projects/' + projectId);
                        const result = await apiDelete(`/admin/cameras/${cameraId}/projects/${projectId}`);
                        console.log('[handleToggleCamera.onConfirm] Delete successful, result:', result);
                        topTostError(`"${camera.name}" removed from project`, 'success');
                    } catch (err) {
                        console.error('[handleToggleCamera.onConfirm] Camera unassign error:');
                        console.error('  Status:', err.response?.status);
                        console.error('  Data:', err.response?.data);
                        console.error('  Message:', err.message);
                        console.error('  Full error:', err);
                        await loadData();
                        const detail = err.response?.data?.detail || err.message || 'Failed to remove camera';
                        topTostError(detail, 'error');
                    }
                },
            });
            console.log('[handleToggleCamera] setConfirm called');
            return;
        }

        // If assigning, proceed without dialog
        console.log('[handleToggleCamera] Assigning camera without dialog');
        // Optimistic update
        setAvailableCameras(prev => prev.map(c => c.id === cameraId ? { ...c, is_assigned: true } : c));
        const newCam = { id: camera.id, name: camera.name, vendor: camera.vendor, model: camera.model, logo_url: camera.logo_url, registry_status: camera.registry_status, zone_id: null, zone_name: null };
        setAssignedCameras(prev => [...prev, newCam]);

        try {
            console.log('[handleToggleCamera] Calling POST /admin/cameras/' + cameraId + '/projects/' + projectId);
            await apiPost(`/admin/cameras/${cameraId}/projects/${projectId}`, {});
            console.log('[handleToggleCamera] Post successful');
            topTostError(`"${camera.name}" assigned to project`, 'success');
        } catch (err) {
            console.error('[handleToggleCamera] Camera assign error:', err.response?.status, err.response?.data);
            await loadData();
            const detail = err.response?.data?.detail || 'Failed to assign camera';
            topTostError(detail, 'error');
        }
    };

    // Change zone for assigned camera
    // NOTE: Zone changes are logged with before/after for complete audit trail.
    // All inference data is preserved; only zone assignment changes (inferences adapt to new zone).
    const handleChangeZone = async (cameraId, zoneId) => {
        console.log('[handleChangeZone] Called with cameraId:', cameraId, 'zoneId:', zoneId);
        const camera = assignedCameras.find(c => c.id === cameraId);
        console.log('[handleChangeZone] Found camera:', camera);
        if (!camera) {
            console.warn('[handleChangeZone] Camera not found');
            return;
        }
        const zone = zones.find(z => z.id === parseInt(zoneId));
        const oldZoneName = camera.zone_name || 'Unassigned';
        const newZoneName = zone?.name || 'Unassigned';

        console.log('[handleChangeZone] Showing zone change dialog from', oldZoneName, 'to', newZoneName);
        setConfirm({
            variant: 'warning',
            title: 'Change Camera Zone',
            message: `Changing "${camera.name}" from zone "${oldZoneName}" to "${newZoneName}" will stop inferences for the old zone and start new ones. Analytics are preserved. Continue?`,
            onConfirm: async () => {
                console.log('[handleChangeZone.onConfirm] Zone change confirmed');
                setAssignedCameras(prev => prev.map(c => c.id === cameraId ? { ...c, zone_id: zoneId ? parseInt(zoneId) : null, zone_name: zone?.name || null } : c));
                try {
                    console.log('[handleChangeZone.onConfirm] Calling PATCH /projects/' + projectId + '/cameras/' + cameraId + '/zone');
                    const result = await apiPatch(`/projects/${projectId}/cameras/${cameraId}/zone`, { zone_id: zoneId ? parseInt(zoneId) : null });
                    console.log('[handleChangeZone.onConfirm] Patch result:', result);
                    if (!result || !result.ok) {
                        console.error('[handleChangeZone.onConfirm] Zone assignment failed');
                        topTostError('Zone assignment failed');
                        await loadData();
                        return;
                    }
                    topTostError(`Zone changed to "${newZoneName}"`, 'success');
                } catch (err) {
                    console.error('[handleChangeZone.onConfirm] Error:', err.response?.status, err.response?.data);
                    await loadData();
                    topTostError(err.response?.data?.detail || 'Failed to assign zone');
                }
            },
        });
        console.log('[handleChangeZone] setConfirm called');
    };

    // Create zone
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
        if (countWords(newZoneDescription) > MAX_DESC_WORDS) errs.description = `Description must be ${MAX_DESC_WORDS} words or fewer`;
        setNewZoneErrors(errs);
        if (Object.keys(errs).length) return;

        const name = sanitizeProjectText(newZoneName);
        const description = sanitizeProjectText(newZoneDescription, { multiline: true });
        setCreatingZone(true);
        try {
            const res = await apiPost(`/projects/${projectId}/zones`, { name, zone_type: newZoneType || null, description: description || null });
            if (res?.id) setZones(prev => [...prev, res]);
            setNewZoneName(''); setNewZoneType(''); setNewZoneDescription(''); setNewZoneErrors({}); setShowZoneForm(false);
            topTostError('Zone created', 'success');
        } catch (err) {
            let msg = 'Failed to create zone';
            try { msg = JSON.parse(err.message || '{}').detail || msg; } catch { msg = err.message || msg; }
            setNewZoneErrors({ name: msg });
        } finally { setCreatingZone(false); }
    };

    // Delete zone
    const askDeleteZone = (zone) => {
        const cameraCount = assignedCameras.filter(c => c.zone_id === zone.id).length;
        setConfirm({
            variant: 'danger',
            title: 'Delete Zone',
            message: cameraCount > 0
                ? `Delete "${zone.name}"? ${cameraCount} camera(s) assigned to this zone will be unassigned.`
                : `Delete "${zone.name}" permanently? This cannot be undone.`,
            onConfirm: async () => {
                try {
                    await apiDelete(`/projects/${projectId}/zones/${zone.id}`);
                    setZones(prev => prev.filter(z => z.id !== zone.id));
                    // Auto-unassign cameras from this zone in UI
                    if (cameraCount > 0) {
                        setAssignedCameras(prev => prev.map(c => c.zone_id === zone.id ? { ...c, zone_id: null, zone_name: null } : c));
                    }
                    topTostError(`Zone "${zone.name}" deleted${cameraCount > 0 ? ` (${cameraCount} camera(s) unassigned)` : ''}`, 'success');
                    setConfirm(null);
                } catch (err) {
                    topTostError(err.response?.data?.detail || 'Failed to delete zone', 'error');
                }
            },
        });
    };

    // Update zone
    const openEditZone = (zone) => { setEditZone(zone); setEditName(zone.name); setEditType(zone.zone_type || ''); setEditDescription(zone.description || ''); setEditError(''); setEditZoneErrors({}); };
    const closeEditZone = () => { setEditZone(null); setEditError(''); setEditZoneErrors({}); };

    const handleUpdateZone = async () => {
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
        if (countWords(editDescription) > MAX_DESC_WORDS) errs.description = `Description must be ${MAX_DESC_WORDS} words or fewer`;
        setEditZoneErrors(errs);
        if (Object.keys(errs).length) return;

        const name = sanitizeProjectText(editName);
        const description = sanitizeProjectText(editDescription, { multiline: true });
        setUpdatingZone(true);
        const prev = zones;
        try {
            setZones(z => z.map(x => x.id === editZone.id ? { ...x, name, zone_type: editType || null, description: description || null } : x));
            await apiPatch(`/projects/${projectId}/zones/${editZone.id}`, { name, zone_type: editType || null, description: description || null });
            topTostError('Zone updated', 'success');
            closeEditZone();
        } catch (err) {
            setZones(prev);
            const msg = err.response?.data?.detail || 'Failed to update zone';
            if (err.response?.status === 409 || err.response?.status === 400) setEditZoneErrors({ name: msg });
            else topTostError(msg, 'error');
        } finally { setUpdatingZone(false); }
    };

    const closeConfirm = () => {
        console.log('[closeConfirm] Called, acting:', acting);
        if (!acting) setConfirm(null);
    };
    const runConfirm = async () => {
        console.log('[runConfirm] Called, confirm:', confirm);
        if (!confirm) return;
        setActing(true);
        try {
            console.log('[runConfirm] Calling onConfirm...');
            await confirm.onConfirm();
            console.log('[runConfirm] onConfirm completed successfully');
        } catch (err) {
            console.error('[runConfirm] Error in onConfirm:', err);
        } finally {
            console.log('[runConfirm] Finally block, clearing confirm and acting');
            setActing(false);
            setConfirm(null);
        }
    };

    return (
        <div className="main-content">
            <style>{`
                .pm-cam-logo {
                    width: 40px; height: 40px; border-radius: 999px;
                    display: inline-flex; align-items: center; justify-content: center;
                    background: var(--bs-secondary-bg); border: 1px solid var(--bs-border-color);
                    overflow: hidden; flex: 0 0 auto;
                }
                html.app-skin-dark .pm-cam-logo { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.12); }
                .pm-cam-logo img { width: 24px; height: 24px; object-fit: contain; display: block; }
                .pm-zone-select { min-height: 38px; }
                .pm-zone-textarea { min-height: 110px; resize: none !important; font-size: 0.875rem; }
                .pm-zone-view-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; z-index: 1050; padding: 18px; }
                .pm-zone-view-card { width: min(860px, 100%); border-radius: 14px; border: 1px solid var(--bs-border-color); overflow: hidden; box-shadow: 0 18px 60px rgba(0,0,0,0.35); color: rgba(2,6,23,0.86); }
                html.app-skin-dark .pm-zone-view-card { color: rgba(255,255,255,0.86); }
                .pm-zone-card-title { font-size: 1.25rem; font-weight: 700; line-height: 1.2; color: rgba(2,6,23,0.92); }
                html.app-skin-dark .pm-zone-card-title { color: rgba(255,255,255,0.92); }
                .pm-zone-card-sub { font-size: 0.75rem; font-weight: 400; line-height: 1.3; color: rgba(2,6,23,0.58); }
                html.app-skin-dark .pm-zone-card-sub { color: rgba(255,255,255,0.62); }
                html.app-skin-dark .pm-zone-view-card .btn-close { filter: invert(1) grayscale(100%); opacity: .8; }
                html.app-skin-dark .pm-zone-view-card .text-muted { color: rgba(255,255,255,0.62) !important; }
                .pm-zone-avatar-wrap { width: 72px; height: 72px; border-radius: 999px; display: flex; align-items: center; justify-content: center; background: rgba(2,6,23,0.06); border: 1px solid var(--bs-border-color); }
                html.app-skin-dark .pm-zone-avatar-wrap { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.12); }
                .pm-zone-avatar-wrap svg { color: rgba(2,6,23,0.92); }
                html.app-skin-dark .pm-zone-avatar-wrap svg { color: rgba(255,255,255,0.92); }
                .pm-zone-split-col { border-left: 1px dashed var(--bs-border-color); }
                html.app-skin-dark .pm-zone-split-col { border-left-color: rgba(255,255,255,0.10); }
                @media (max-width: 767.98px) { .pm-zone-split-col { border-left: none; } }
                .pm-zone-surface { background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.06); }
                html.app-skin-dark .pm-zone-surface { background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.10); }
                .pm-table-wrap { border-radius: 0.5rem; overflow: hidden; }
                .pm-table-wrap .table > :not(caption) > * > * { padding: 0.95rem 0.85rem; }
                .pm-table-wrap .table thead th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
                .pm-table-wrap .table td { vertical-align: middle; }
                .pm-pill { display: inline-flex; align-items: center; padding: 0.45rem 0.65rem; border-radius: var(--bs-border-radius); font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; line-height: 1; }
                .pm-pill-warning { background: rgba(var(--bs-warning-rgb), 1); border: 0; color: #fff; }
                .pm-pill-primary { background: rgba(var(--bs-primary-rgb), 1); border: 0; color: #fff; }
                .pm-zone-action { outline: none; box-shadow: none; border: 0; }
                .pm-zone-action:focus, .pm-zone-action:focus-visible { outline: none; box-shadow: none; }
            `}</style>

            <div className="wizard pm-setup-wide">
                <div className="content clearfix" style={{ maxWidth: 'none', padding: 0 }}>
                    <div className="body current" style={{ padding: 0 }}>
                        <div className="row g-3">

                {/* ── Card 1: Available Cameras ── */}
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
                                <div className="p-5 d-flex flex-column align-items-center justify-content-center text-muted" style={{ minHeight: 200 }}>
                                    <FiAlertCircle size={32} className="mb-3" style={{ opacity: 0.5 }} />
                                    <span className="text-center">No verified cameras found. Ask your admin to register and verify cameras first.</span>
                                </div>
                            ) : (
                                <div className="table-responsive pm-table-wrap" style={{ overflowX: 'auto', overflowY: 'visible' }}>
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
                                            {availableCameras.map(cam => (
                                                <tr key={cam.id}>
                                                    <td>
                                                        <div className="d-flex align-items-center gap-3">
                                                            <div className="pm-cam-logo">
                                                                <img src={cam.logo_url || DEFAULT_CAMERA_LOGO} alt="" onError={e => { e.currentTarget.src = DEFAULT_CAMERA_LOGO; }} />
                                                            </div>
                                                            <div className="min-w-0">
                                                                <span className="d-block fw-semibold">{cam.name}</span>
                                                                <span className="fs-12 d-block fw-normal text-muted text-truncate-1-line">{(cam.vendor || '').trim()} {(cam.model || '').trim()}</span>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <span className="badge bg-soft-success text-success text-uppercase">
                                                            {(cam.registry_status || 'verified').toString()}
                                                        </span>
                                                    </td>
                                                    <td>
                                                        <div className="d-flex justify-content-end">
                                                            <button
                                                                type="button"
                                                                className={`btn btn-sm ${cam.is_assigned ? 'btn-danger' : 'btn-primary'}`}
                                                                onClick={() => handleToggleCamera(cam.id, cam.is_assigned)}
                                                                disabled={isArchived}
                                                            >
                                                                {cam.is_assigned ? 'Remove' : 'Assign'}
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

                {/* ── Card 2: Camera Zone Assignment ── */}
                <div className="col-12">
                    <div className="card">
                        <div className="card-header">
                            <div>
                                <h5 className="mb-0">Camera Zone Assignment</h5>
                                <span className="fs-12 text-muted">Assign each camera to a zone</span>
                            </div>
                            <span className="badge bg-soft-success text-success text-uppercase">{assignedCameras.length} Assigned</span>
                        </div>
                        <div className="card-body custom-card-action p-0" style={{ overflow: 'visible' }}>
                            {loadingCameras ? (
                                <div className="d-flex align-items-center justify-content-center py-5">
                                    <div className="spinner-border spinner-border-sm text-primary" role="status" />
                                </div>
                            ) : assignedCameras.length === 0 ? (
                                <div className="p-5 d-flex flex-column align-items-center justify-content-center text-muted" style={{ minHeight: 200 }}>
                                    <FiAlertCircle size={32} className="mb-3" style={{ opacity: 0.5 }} />
                                    <span className="text-center">Assign cameras first to configure zones</span>
                                </div>
                            ) : (
                                <div style={{ overflow: 'visible', borderRadius: '0.5rem' }}>
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
                                            {assignedCameras.map(cam => (
                                                <tr key={cam.id} style={{ minHeight: '80px' }}>
                                                    <td>
                                                        <div className="d-flex align-items-center gap-3">
                                                            <div className="pm-cam-logo">
                                                                <img src={cam.logo_url || DEFAULT_CAMERA_LOGO} alt="" onError={e => { e.currentTarget.src = DEFAULT_CAMERA_LOGO; }} />
                                                            </div>
                                                            <div className="min-w-0">
                                                                <span className="d-block fw-semibold">{cam.name}</span>
                                                                <span className="fs-12 d-block fw-normal text-muted text-truncate-1-line">{(cam.vendor || '').trim()} {(cam.model || '').trim()}</span>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <SelectDropdown
                                                            value={cam.zone_id ? String(cam.zone_id) : ''}
                                                            placeholder={zones.length === 0 ? 'Create a zone first' : 'Select zone'}
                                                            disabled={zones.length === 0}
                                                            options={zones.map(z => ({ value: String(z.id), label: z.name }))}
                                                            onChange={(v) => handleChangeZone(cam.id, v ? parseInt(v) : null)}
                                                            fullWidth={false}
                                                            menuMatchTriggerWidth={true}
                                                            dropdownDisplay="static"
                                                            menuStyle={{ zIndex: 5000 }}
                                                            buttonClassName="form-select-sm pm-zone-select"
                                                            buttonStyle={{ width: 200, maxWidth: '100%', borderRadius: '0.375rem' }}
                                                        />
                                                    </td>
                                                    <td className="text-end">
                                                        {cam.zone_id
                                                            ? <span className="badge bg-soft-success text-success text-uppercase">Assigned</span>
                                                            : <span className="badge bg-soft-danger text-danger text-uppercase">Required</span>
                                                        }
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

                {/* ── Card 3: Zones ── */}
                <div className="col-12">
                    <div className="card">
                        <div className="card-header">
                            <div>
                                <h5 className="mb-0">Zones</h5>
                                <span className="fs-12 text-muted">Manage zones for camera grouping</span>
                            </div>
                            {!isArchived && (
                                <button
                                    type="button"
                                    className={`btn d-inline-flex align-items-center ${showZoneForm ? 'btn-danger' : 'btn-success'}`}
                                    onClick={() => setShowZoneForm(v => !v)}
                                    style={actionBtnStyle}
                                >
                                    {showZoneForm ? <FiX size={14} className="me-1" /> : <FiPlus size={14} className="me-1" />}
                                    {showZoneForm ? 'Close' : 'Create Zone'}
                                </button>
                            )}
                        </div>
                        <div className="card-body p-0" style={{ overflow: 'visible' }}>

                            {/* Collapsible zone form */}
                            {showZoneForm && (
                                <div className="p-3">
                                    <div className="row g-2 mb-3">
                                        <div className="col-12 col-md-6">
                                            <label className="fs-11 fw-semibold text-muted text-uppercase mb-1" style={{ letterSpacing: '0.06em' }}>Zone Name <span className="text-danger">*</span></label>
                                            <div className="input-group">
                                                <span className="input-group-text"><FiTag size={14} /></span>
                                                <input
                                                    type="text"
                                                    className="form-control"
                                                    placeholder="Zone name"
                                                    value={newZoneName}
                                                    maxLength="200"
                                                    onChange={e => {
                                                        setNewZoneName(e.target.value)
                                                        setNewZoneErrors(prev => ({ ...prev, name: null }))
                                                    }}
                                                    style={{ fontSize: '0.875rem' }}
                                                />
                                            </div>
                                            {newZoneErrors.name && (
                                                <div className="text-danger fs-11 mt-1">{newZoneErrors.name}</div>
                                            )}
                                        </div>
                                        <div className="col-12 col-md-6">
                                            <label className="fs-11 fw-semibold text-muted text-uppercase mb-1" style={{ letterSpacing: '0.06em' }}>Zone Type</label>
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
                                        <label className="fs-11 fw-semibold text-muted text-uppercase mb-1" style={{ letterSpacing: '0.06em' }}>Description</label>
                                        <textarea
                                            className={`form-control pm-zone-textarea${countWords(newZoneDescription) > MAX_DESC_WORDS ? ' is-invalid' : ''}`}
                                            placeholder="Enter a brief description of this zone and its monitoring purpose"
                                            value={newZoneDescription}
                                            rows="3"
                                            onChange={e => {
                                                setNewZoneDescription(e.target.value)
                                                setNewZoneErrors(prev => ({ ...prev, description: null }))
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
                                        <button type="button" className="btn btn-lg btn-success" onClick={handleCreateZone} disabled={creatingZone} style={actionBtnStyle}>
                                            {creatingZone && <span className="spinner-border spinner-border-sm me-2" />}
                                            <FiPlus size={14} className="me-1" />Create Zone
                                        </button>
                                        <button type="button" className="btn btn-lg btn-outline-secondary" onClick={() => { setShowZoneForm(false); setNewZoneName(''); setNewZoneType(''); setNewZoneDescription(''); setNewZoneErrors({}); }} disabled={creatingZone} style={actionBtnStyle}>
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            )}

                            {zones.length === 0 ? (
                                <div className="p-5 d-flex flex-column align-items-center justify-content-center text-muted" style={{ minHeight: 200 }}>
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
                                                <th>Zone</th>
                                                <th>Description</th>
                                                <th>Type</th>
                                                <th className="text-end">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {zones.map(zone => (
                                                <tr key={zone.id} style={{ verticalAlign: 'middle' }}>
                                                    <td><span className="pm-pill pm-pill-warning">{zone.name}</span></td>
                                                    <td>
                                                        {zone.description
                                                            ? <span className="cam-meta"><span className="cam-meta-text text-truncate-2-line" style={{ maxWidth: '100%' }}>{truncate(zone.description, 120)}</span></span>
                                                            : <span className="text-muted">—</span>
                                                        }
                                                    </td>
                                                    <td><span className="pm-pill pm-pill-primary">{zone.zone_type ? zone.zone_type.toString() : 'None'}</span></td>
                                                    <td className="text-end">
                                                        <div className="hstack gap-2 justify-content-end">
                                                            <button type="button" className="avatar-text avatar-md" onClick={() => setViewZone(zone)} title="View zone"><FiEye /></button>
                                                            {!isArchived && (
                                                                <>
                                                                    <button type="button" className="pm-zone-action" onClick={() => openEditZone(zone)} title="Edit zone" style={{ width: 30, height: 30, borderRadius: '50%', background: '#3b82f6', border: '2px solid transparent', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0, lineHeight: 1, boxSizing: 'border-box' }}>
                                                                        <FiEdit2 size={13} strokeWidth={2} />
                                                                    </button>
                                                                    <button type="button" className="pm-zone-action" onClick={() => askDeleteZone(zone)} title="Delete zone" style={{ width: 30, height: 30, borderRadius: '50%', background: '#ef4444', border: '2px solid transparent', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0, lineHeight: 1, boxSizing: 'border-box' }}>
                                                                        <FiTrash2 size={13} strokeWidth={2} />
                                                                    </button>
                                                                </>
                                                            )}
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
                    </div>
                </div>
            </div>

            {/* ── Edit Zone Modal ── */}
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
                                            setEditName(e.target.value)
                                            setEditError('')
                                            setEditZoneErrors(prev => ({ ...prev, name: null }))
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
                                        setEditDescription(e.target.value)
                                        setEditZoneErrors(prev => ({ ...prev, description: null }))
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

            {/* ── View Zone Modal ── */}
            {viewZone && (
                <div className="pm-zone-view-overlay" onClick={() => setViewZone(null)}>
                    <div className="card pm-zone-view-card" onClick={(e) => e.stopPropagation()}>
                        <div className="card-header d-flex align-items-center justify-content-between">
                            <div>
                                <div className="pm-zone-card-title">Zone Overview</div>
                                <div className="pm-zone-card-sub">Overview of zone configuration and monitoring purpose</div>
                            </div>
                            <button type="button" className="btn-close" onClick={() => setViewZone(null)} />
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

            {/* ── Confirm Dialog ── */}
            <ConfirmDialog
                open={!!confirm}
                variant={confirm?.variant || 'warning'}
                title={confirm?.title || ''}
                message={confirm?.message || ''}
                onConfirm={runConfirm}
                onClose={closeConfirm}
                loading={acting}
            />
        </div>
    );
};

export default AdminProjectCamerasTab;
