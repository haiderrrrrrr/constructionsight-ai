import { useRef, useState, useEffect } from 'react'
import PageLoader from '@/components/shared/PageLoader'
import { useFormPersist } from '@/hooks/useFormPersist'
import { FiAlertCircle, FiCamera, FiCheck, FiEye, FiEyeOff, FiHash, FiKey, FiMapPin, FiPackage, FiSearch, FiTag, FiUser, FiVideo, FiWifi, FiX } from 'react-icons/fi'
import { useNavigate } from 'react-router-dom'
import { apiGet, apiPatch, apiPost } from '@/utils/api'
import { parseApiError, extractFieldErrors } from '@/utils/errorHandler'
import topTost from '@/utils/topTost'
import topTostError from '@/utils/topTostError'
import { SelectDropdown } from '@/components/shared/Dropdown'
import { sanitizeCameraIdentity, validateCameraIdentity } from '@/utils/cameraValidation'

const DEFAULT_CAMERA_LOGO = '/images/logo/security-camera-logo.png'

const DEFAULT_USERNAME = import.meta.env.VITE_DEFAULT_CAMERA_USERNAME || ''
const DEFAULT_PASSWORD = import.meta.env.VITE_DEFAULT_CAMERA_PASSWORD || ''

// Simplify ONVIF errors for users - return generic message since backend doesn't differentiate error types
const simplifyOnvifError = () => {
    return 'Could not connect to ONVIF device. Please verify: Service Host / IP address is correct, Username & Password are correct, and the device is online.'
}

const EMPTY_FORM = {
    name: '', site_id: '', vendor: '', model: '', serial_number: '',
    rtsp_url: '',      // Main stream (high-res / Record URL)
    rtsp_url_sub: '',  // Sub-stream  (low-res  / Live URL)
    transport: 'tcp', username: DEFAULT_USERNAME, password: DEFAULT_PASSWORD,
    onvif_supported: true, ptz_supported: true, onvif_host: '', onvif_port: '80',
}

const LABEL = "fs-11 fw-semibold text-muted text-uppercase mb-1"
const LABEL_STYLE = { letterSpacing: '0.06em' }

const compactCameraFieldError = (message) => {
    const text = String(message || '')
    if (/must include letters/i.test(text)) return 'Add letters'
    if (/cannot contain HTML/i.test(text)) return 'No HTML'
    if (/invalid characters/i.test(text)) return 'Invalid chars'
    if (/too short|at least/i.test(text)) return 'Too short'
    if (/too long|under 200|max/i.test(text)) return 'Max 200 chars'
    return text
}

const ToggleSwitch = ({ checked, onChange, disabled, inputId }) => (
    <label className={`cs-fc-toggle ${disabled ? 'cs-fc-toggle-disabled' : ''}`} htmlFor={inputId}>
        <input
            className="cs-fc-toggle-input"
            type="checkbox"
            id={inputId}
            checked={checked}
            onChange={onChange}
            disabled={disabled}
        />
        <span className="cs-fc-toggle-ui" />
    </label>
)

const CameraAddContent = ({ mode = 'add', cameraId }) => {
    const navigate = useNavigate()
    const logoInputRef = useRef(null)
    const isEdit = mode === 'edit' && !!cameraId
    const [activeTab, setActiveTab] = useState('manual')
    const [scanning, setScanning] = useState(false)
    const [discovered, setDiscovered] = useState([])
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [sites, setSites] = useState([])
    const [form, setForm, clearDraft,, , hasDraft] = useFormPersist('cs:draft:camera-add', EMPTY_FORM, { skip: isEdit, omitKeys: ['password'] })
    const [draftBannerDismissed, setDraftBannerDismissed] = useState(false)
    const [errors, setErrors] = useState({})
    const [submitAttempted, setSubmitAttempted] = useState(false)
    const [hasStoredPassword, setHasStoredPassword] = useState(false)

    // ONVIF stream fetch state
    const [fetchingStreams, setFetchingStreams] = useState(false)
    const [onvifStreams, setOnvifStreams] = useState([])
    const [onvifDeviceInfo, setOnvifDeviceInfo] = useState(null)
    const [onvifError, setOnvifError] = useState(null)

    // Camera logo state
    const [logoFile, setLogoFile] = useState(null)
    const [logoPreview, setLogoPreview] = useState(null)
    const [logoUploading, setLogoUploading] = useState(false)
    const [logoUrl, setLogoUrl] = useState(null)
    const [logoPublicId, setLogoPublicId] = useState(null)

    // Snapshot preview state
    const [snapshotImg, setSnapshotImg] = useState(null)
    const [snapshotLoading, setSnapshotLoading] = useState(false)

    // Password visibility toggles
    const [showOnvifPwd, setShowOnvifPwd] = useState(false)
    const [showRtspPwd, setShowRtspPwd] = useState(false)
    const [showDiscoverPwd, setShowDiscoverPwd] = useState(false)

    // Discover tab credentials (required for auto-fetch on import)
    const [discoverCreds, setDiscoverCreds] = useState({ username: DEFAULT_USERNAME, password: DEFAULT_PASSWORD, port: '80' })
    const [discoverCredsErrors, setDiscoverCredsErrors] = useState({})
    const [importingIp, setImportingIp] = useState(null)

    const set = (field) => (e) => {
        const val = e.target.type === 'checkbox' ? e.target.checked : e.target.value
        setForm(prev => ({ ...prev, [field]: val }))
        setErrors(prev => {
            if (!prev) return prev
            let changed = false
            const next = { ...prev }
            const clear = (k) => { if (next[k]) { next[k] = null; changed = true } }
            clear(field)
            if (field === 'rtsp_url' || field === 'rtsp_url_sub') clear('onvif_host')
            if (field === 'onvif_host') clear('rtsp_url')
            if (field === 'onvif_supported' && !val) {
                clear('username'); clear('onvif_host'); clear('onvif_port')
            }
            return changed ? next : prev
        })
        if (['onvif_host', 'onvif_port', 'username', 'password'].includes(field)) {
            setOnvifStreams([]); setOnvifDeviceInfo(null); setOnvifError(null); setSnapshotImg(null)
        }
        if (field === 'onvif_supported' && !val) {
            setOnvifStreams([]); setOnvifDeviceInfo(null); setOnvifError(null)
        }
    }

    const FieldError = ({ field }) => errors[field] ? (
        <span className="field-error d-flex align-items-center gap-1" style={{ fontSize: '0.72rem', color: '#ef4444' }}>
            <FiAlertCircle size={11} style={{ flexShrink: 0 }} />{errors[field]}
        </span>
    ) : <span />;

    const validate = (draft) => {
        const errs = validateCameraIdentity(draft)
        const rtsp = (draft.rtsp_url || '').trim()
        const rtspSub = (draft.rtsp_url_sub || '').trim()
        const host = (draft.onvif_host || '').trim()
        const port = Number(draft.onvif_port)

        if (!draft.site_id) errs.site_id = 'Project is required'

        if (!rtsp && !host) {
            errs.rtsp_url = 'Record URL is required (or enable ONVIF and enter host)'
            if (draft.onvif_supported) errs.onvif_host = 'ONVIF host is required (or enter a Record URL)'
        }

        if (rtsp && !rtsp.toLowerCase().startsWith('rtsp://')) errs.rtsp_url = 'Record URL must start with rtsp://'
        if (rtspSub && !rtspSub.toLowerCase().startsWith('rtsp://')) errs.rtsp_url_sub = 'Live URL must start with rtsp://'
        if (rtsp && rtspSub && rtsp === rtspSub) errs.rtsp_url_sub = 'Live URL and Record URL must be different streams'

        if (draft.onvif_supported && !host) errs.onvif_host = 'ONVIF is enabled — enter the ONVIF host / IP address'
        if (host && (Number.isNaN(port) || port < 1 || port > 65535)) errs.onvif_port = 'ONVIF port must be between 1 and 65535'

        return errs
    }

    // ── Logo handlers ────────────────────────────────────────────────────────
    const handleLogoSelect = (e) => {
        const file = e.target.files?.[0]
        if (!file) return
        const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
        if (!allowed.includes(file.type)) {
            setErrors(prev => ({ ...(prev || {}), logo: 'Only PNG, JPEG, WebP, or SVG allowed' }))
            return
        }
        if (file.size > 2 * 1024 * 1024) {
            setErrors(prev => ({ ...(prev || {}), logo: 'Image must be under 2 MB' }))
            return
        }
        if (errors.logo) setErrors(prev => ({ ...prev, logo: null }))
        setLogoPreview(URL.createObjectURL(file))
        setLogoFile(file)
        setLogoUrl(null)
        setLogoPublicId(null)
    }

    const handleLogoRemove = () => {
        setLogoFile(null)
        setLogoPreview(null)
        setLogoUrl(null)
        setLogoPublicId(null)
        if (errors.logo) setErrors(prev => ({ ...prev, logo: null }))
        if (logoInputRef.current) logoInputRef.current.value = ''
    }

    useEffect(() => {
        apiGet('/admin/sites')
            .then(data => {
                if (!Array.isArray(data) || data.length === 0) {
                    topTostError('No sites found. Create a site before adding a camera.')
                    setSites([])
                    return
                }
                setSites(data.map(s => ({ id: s.id, name: s.name, location: s.location })))
            })
            .catch(() => topTostError('Failed to load sites. Refresh and try again.'))
    }, [])

    useEffect(() => {
        if (!isEdit) return
        setActiveTab('manual')
        setLoading(true)
        Promise.all([
            apiGet(`/admin/cameras/${cameraId}`),
            apiGet(`/admin/cameras/${cameraId}/credentials`),
        ])
            .then(([cam, creds]) => {
                setForm(prev => ({
                    ...prev,
                    name: cam?.name || '',
                    site_id: String(cam?.site_id || ''),
                    vendor: cam?.vendor || '',
                    model: cam?.model || '',
                    serial_number: cam?.serial_number || '',
                    onvif_supported: cam?.onvif_supported ?? true,
                    ptz_supported: cam?.onvif_supported ?? true,
                    rtsp_url: creds?.rtsp_url || '',
                    rtsp_url_sub: creds?.rtsp_url_sub || '',
                    username: creds?.username || '',
                    password: '',
                    onvif_host: creds?.onvif_host || '',
                    onvif_port: String(creds?.onvif_port || cam?.onvif_port || 80),
                    transport: creds?.transport_preference || 'tcp',
                }))

                setLogoFile(null)
                setLogoPreview(null)
                setLogoUrl(cam?.logo_url || null)
                setLogoPublicId(cam?.logo_public_id || null)
                setHasStoredPassword(!!creds?.has_password)
                setErrors({})
                setSubmitAttempted(false)
            })
            .catch(() => topTostError('Failed to load camera details. Refresh and try again.'))
            .finally(() => setLoading(false))
    }, [cameraId, isEdit])

    // ── ONVIF: fetch streams & auto-assign by resolution ──────────────────────
    const handleFetchStreams = async () => {
        const nextErrors = {}
        if (!form.onvif_host.trim()) nextErrors.onvif_host = 'ONVIF host / IP is required'
        if (!form.username.trim()) nextErrors.username = 'Username is required to fetch streams'
        if (!form.password) nextErrors.password = 'Password is required to fetch streams'
        if (Object.keys(nextErrors).length > 0) {
            setSubmitAttempted(true)
            setErrors(prev => ({ ...prev, ...nextErrors }))
            return
        }
        setFetchingStreams(true)
        setOnvifStreams([])
        setOnvifDeviceInfo(null)
        setOnvifError(null)
        try {
            const onvifPayload = {
                host: form.onvif_host.trim(),
                port: Number(form.onvif_port) || 80,
                username: form.username.trim(),
                password: form.password || undefined,
            }
            if (!form.password && cameraId) onvifPayload.camera_id = Number(cameraId)
            const data = await apiPost('/admin/cameras/onvif-streams', onvifPayload)
            const streams = data.streams || []
            setOnvifStreams(streams)
            setOnvifDeviceInfo(data.device_info || null)
            if (streams.length === 0) { setOnvifError('Device responded but returned no profiles.'); return }
            topTost(`Found ${streams.length} stream profile${streams.length !== 1 ? 's' : ''} — main stream auto-assigned.`)

            const pixels = (s) => {
                if (!s.resolution) return 0
                const [w, h] = s.resolution.toLowerCase().split('x').map(Number)
                return (w || 0) * (h || 0)
            }
            const sorted = [...streams].sort((a, b) => pixels(b) - pixels(a))
            const mainStream = sorted[0]
            const subStream  = sorted.length > 1 ? sorted[sorted.length - 1] : null
            const assignedMain = mainStream.rtsp_url

            setForm(prev => {
                const next = { ...prev, rtsp_url: mainStream.rtsp_url }
                if (subStream) next.rtsp_url_sub = subStream.rtsp_url
                if (data.device_info) {
                    next.vendor        = prev.vendor        || data.device_info.manufacturer || prev.vendor
                    next.model         = prev.model         || data.device_info.model        || prev.model
                    next.serial_number = prev.serial_number || data.device_info.serial       || prev.serial_number
                }
                return next
            })

            setSnapshotImg(null)
            setSnapshotLoading(true)
            apiPost('/admin/cameras/snapshot', { rtsp_url: assignedMain, transport: form.transport })
                .then(res => { if (res?.image) setSnapshotImg(res.image) })
                .catch(() => {})
                .finally(() => setSnapshotLoading(false))

        } catch (err) {
            const rawError = parseApiError(err)
            setOnvifError(simplifyOnvifError(rawError))
        } finally {
            setFetchingStreams(false)
        }
    }

    const handleSelectStream = (stream, slot) => {
        setForm(prev => ({ ...prev, [slot === 'sub' ? 'rtsp_url_sub' : 'rtsp_url']: stream.rtsp_url }))
    }

    // ── Network discovery ────────────────────────────────────────────────────
    const handleScan = async () => {
        setScanning(true)
        setDiscovered([])
        try {
            const data = await apiGet('/admin/cameras/discover')
            const devices = Array.isArray(data) ? data : []
            setDiscovered(devices)
            if (devices.length === 0)
                topTost('No ONVIF cameras found on this subnet. Ensure cameras are powered and on the same network.')
            else
                topTost(`Discovered ${devices.length} ONVIF device${devices.length !== 1 ? 's' : ''} on the network.`)
        } catch (err) {
            topTostError('Discovery failed: ' + parseApiError(err))
        } finally {
            setScanning(false)
        }
    }

    const handleImport = async (device) => {
        // Credentials are required to auto-fetch full device info + streams
        const credsErrs = {}
        if (!discoverCreds.username.trim()) credsErrs.username = 'Username is required'
        if (!discoverCreds.password) credsErrs.password = 'Password is required'
        if (Object.keys(credsErrs).length > 0) { setDiscoverCredsErrors(credsErrs); return }
        setDiscoverCredsErrors({})

        const autoName = device.name || device.hardware || device.ip || ''

        setForm(prev => ({
            ...prev,
            name: prev.name.trim() || autoName,
            model: prev.model.trim() || device.hardware || '',
            onvif_supported: !!device.onvif,
            onvif_host: device.ip || prev.onvif_host,
            onvif_port: discoverCreds.port || '80',
            username: prev.username || discoverCreds.username,
            password: prev.password || discoverCreds.password,
        }))
        setOnvifStreams([])
        setOnvifDeviceInfo(null)
        setOnvifError(null)

        if (device.onvif) {
            setImportingIp(device.ip)
            try {
                const data = await apiPost('/admin/cameras/onvif-streams', {
                    host: device.ip,
                    port: Number(discoverCreds.port) || 80,
                    username: discoverCreds.username.trim(),
                    password: discoverCreds.password,
                })
                const streams = data.streams || []
                setOnvifStreams(streams)
                setOnvifDeviceInfo(data.device_info || null)

                const pixels = (s) => {
                    if (!s.resolution) return 0
                    const [w, h] = s.resolution.toLowerCase().split('x').map(Number)
                    return (w || 0) * (h || 0)
                }
                const sorted = [...streams].sort((a, b) => pixels(b) - pixels(a))
                const mainStream = sorted[0]
                const subStream  = sorted.length > 1 ? sorted[sorted.length - 1] : null

                setForm(prev => {
                    const next = { ...prev, rtsp_url: mainStream?.rtsp_url || prev.rtsp_url }
                    if (subStream) next.rtsp_url_sub = subStream.rtsp_url
                    if (data.device_info) {
                        next.vendor        = prev.vendor        || data.device_info.manufacturer || ''
                        next.model         = prev.model         || data.device_info.model        || prev.model
                        next.serial_number = prev.serial_number || data.device_info.serial       || ''
                    }
                    return next
                })
            } catch {
                topTostError(`Could not fetch ONVIF details for ${device.ip}. Check credentials and try "Get Stream URLs" manually.`)
            } finally {
                setImportingIp(null)
            }
        }

        topTost(`Device "${autoName}" imported — review details and save.`)
        setActiveTab('manual')
    }

    const handleSubmit = async (e) => {
        if (saving || logoUploading) return   // prevent double-submission
        if (e?.preventDefault) e.preventDefault()
        setSubmitAttempted(true)
        const nextErrors = validate(form)
        if (Object.keys(nextErrors).length > 0) { setErrors(nextErrors); return }
        const identity = sanitizeCameraIdentity(form)

        setSaving(true)
        try {
            let finalLogoUrl = logoUrl
            let finalLogoPublicId = logoPublicId
            if (logoFile && !logoUrl) {
                setLogoUploading(true)
                try {
                    const fd = new FormData()
                    fd.append('file', logoFile)
                    const res = await fetch(`${import.meta.env.VITE_API_BASE_URL || ''}/api/admin/cameras/upload-logo`, {
                        method: 'POST',
                        headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` },
                        body: fd,
                    })
                    if (!res.ok) throw new Error('Logo upload failed')
                    const data = await res.json()
                    finalLogoUrl = data.url
                    finalLogoPublicId = data.public_id
                    setLogoUrl(finalLogoUrl)
                    setLogoPublicId(finalLogoPublicId)
                } catch {
                    topTostError('Logo upload failed — camera will be saved without a custom logo.')
                } finally {
                    setLogoUploading(false)
                }
            }

            if (isEdit) {
                await apiPatch(`/admin/cameras/${cameraId}`, {
                    name: identity.name,
                    site_id: Number(form.site_id),
                    vendor: identity.vendor || null,
                    model: identity.model || null,
                    serial_number: identity.serial_number || null,
                    onvif_supported: form.onvif_supported,
                    ptz_supported: form.onvif_supported,
                    connection_type: 'rtsp',
                    logo_url: finalLogoUrl || null,
                    logo_public_id: finalLogoPublicId || null,
                })

                const credPayload = {
                    rtsp_url: form.rtsp_url.trim() || null,
                    rtsp_url_sub: form.rtsp_url_sub.trim() || null,
                    username: form.username.trim() || null,
                    onvif_host: form.onvif_supported ? (form.onvif_host.trim() || null) : null,
                    onvif_port: form.onvif_supported ? (Number(form.onvif_port) || 80) : null,
                    transport_preference: form.transport || 'tcp',
                }
                if (form.password) credPayload.password = form.password
                await apiPatch(`/admin/cameras/${cameraId}/credentials`, credPayload)

                topTost('Camera updated successfully.')
                navigate('/admin/cameras/list')
            } else {
                const payload = {
                    name: identity.name,
                    site_id: Number(form.site_id),
                    vendor: identity.vendor || undefined,
                    model: identity.model || undefined,
                    serial_number: identity.serial_number || undefined,
                    onvif_supported: form.onvif_supported,
                    ptz_supported: form.onvif_supported,
                    connection_type: 'rtsp',
                    logo_url: finalLogoUrl || undefined,
                    logo_public_id: finalLogoPublicId || undefined,
                    rtsp_url: form.rtsp_url.trim() || undefined,
                    rtsp_url_sub: form.rtsp_url_sub.trim() || undefined,
                    username: form.username.trim() || undefined,
                    password: form.password || undefined,
                    onvif_host: form.onvif_supported ? (form.onvif_host.trim() || undefined) : undefined,
                    onvif_port: form.onvif_supported ? (Number(form.onvif_port) || 80) : undefined,
                    transport_preference: form.transport,
                }
                await apiPost('/admin/cameras', payload)
                clearDraft()
                topTost('Camera registered successfully.')
                navigate('/admin/cameras/list')
            }
        } catch (err) {
            const msg = parseApiError(err)
            const fieldHints = extractFieldErrors(err)
            Object.keys(fieldHints).forEach(key => {
                fieldHints[key] = compactCameraFieldError(fieldHints[key])
            })

            // Highlight duplicate fields based on backend message
            if (/already exists at this site/i.test(msg) || /unique/i.test(msg)) {
                if (/named '/.test(msg) || /camera named/i.test(msg)) fieldHints.name = 'A camera with this name already exists at this site'
                if (/serial/i.test(msg)) fieldHints.serial_number = 'This serial number is already registered at this site'
                if (/ONVIF host/i.test(msg)) fieldHints.onvif_host = 'A camera at this ONVIF host is already registered at this site'
                if (/Record RTSP URL/i.test(msg)) fieldHints.rtsp_url = 'This RTSP URL is already registered at this site'
            }

            // Display field-level errors on form
            if (Object.keys(fieldHints).length > 0) {
                setErrors(prev => ({ ...prev, ...fieldHints }))
            } else {
                topTostError(msg)
            }
        } finally {
            setSaving(false)
        }
    }

    const selectedSite = form.site_id ? sites.find(s => String(s.id) === String(form.site_id)) : null
    const selectedSiteLabel = selectedSite
        ? `${selectedSite.name}${selectedSite.location ? ` — ${selectedSite.location}` : ''}`
        : 'Not configured'

    const onvifPortLabel = form.onvif_port || '80'
    const liveUrlSummary = (form.rtsp_url_sub || '').trim() || 'Not configured'
    const recordUrlSummary = (form.rtsp_url || '').trim() || 'Not configured'

    return (
        <>
            <style>{`
                .cam-icon-wrap { width:28px; height:28px; border-radius:7px; flex-shrink:0; display:flex; align-items:center; justify-content:center; background:rgba(2,6,23,0.06); color:rgba(2,6,23,0.78); }
                html.app-skin-dark .cam-icon-wrap { background:rgba(255,255,255,0.08) !important; color:rgba(255,255,255,0.75) !important; }
                .cam-summary-code { background: transparent !important; }
                .cam-summary-row { border-bottom: 1px solid rgba(148,163,184,0.35); }
                html.app-skin-dark .cam-summary-row { border-bottom: 1px solid rgba(255,255,255,0.10); }
                .field-error svg { stroke:#ef4444 !important; color:#ef4444 !important; }
                .cs-project-logo-frame{
                    padding: 4px;
                    border-radius: 12px;
                    background: rgba(0,0,0,0.02);
                    border: 1px solid var(--bs-border-color, rgba(0,0,0,.08));
                }
                html.app-skin-dark .cs-project-logo-frame{
                    background: rgba(255,255,255,0.06);
                    border-color: rgba(255,255,255,0.10) !important;
                }
                .cs-project-logo-img{
                    width: 80px;
                    height: 80px;
                    object-fit: cover;
                    border-radius: 8px;
                    border: none;
                    background: transparent;
                }
            `}</style>
            {loading ? (
                <PageLoader />
            ) : (
            <>
            {/* Draft restored banner — above Register + Connection Summary cards */}
            {!isEdit && hasDraft && !draftBannerDismissed && (
                <div
                    className="col-12"
                >
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
                            onClick={() => { clearDraft(); setForm(EMPTY_FORM); setDraftBannerDismissed(true); }}
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
                </div>
            )}

            <div className={activeTab === 'discover' ? 'col-xl-12' : 'col-xl-8'}>
                <div className="card invoice-container">
                    <div className="card-header d-flex align-items-center justify-content-between flex-wrap gap-2">
                        <div>
                            <h5 className="mb-0">{isEdit ? 'Edit Camera' : 'Register Camera'}</h5>
                            <span className="fs-12 text-muted">{isEdit ? 'Update camera details' : 'Register a new camera device'}</span>
                        </div>
                        <div className="d-flex align-items-center gap-2">
                        {!isEdit && (
                        <div className="filter-dropdown">
                            <a
                                href="#"
                                className="btn btn-light-brand dropdown-toggle"
                                data-bs-toggle="dropdown"
                                data-bs-offset="0, 25"
                                data-bs-auto-close="true"
                                onClick={(e) => e.preventDefault()}
                            >
                                {activeTab === 'manual' ? 'Add Manually' : 'Scan Network'}
                            </a>
                            <ul className="dropdown-menu dropdown-menu-end">
                                <li>
                                    <button type="button" className={`dropdown-item${activeTab === 'manual' ? ' active' : ''}`} onClick={() => setActiveTab('manual')}>
                                        Add Manually
                                    </button>
                                </li>
                                <li>
                                    <button type="button" className={`dropdown-item${activeTab === 'discover' ? ' active' : ''}`} onClick={() => setActiveTab('discover')}>
                                        Scan Network
                                    </button>
                                </li>
                            </ul>
                        </div>
                        )}
                        </div>
                    </div>

                    <div className="card-body">

                        {/* ══ MANUAL TAB ══════════════════════════════════════════ */}
                        {activeTab === 'manual' && (
                            <form id={isEdit ? 'camera-edit-form' : 'camera-add-form'} onSubmit={handleSubmit}>

                                {/* Camera Logo */}
                                <div className="mb-4">
                                    <label className={LABEL} style={LABEL_STYLE}>Camera Logo <span className="text-danger">*</span></label>
                                    <div className="alert alert-soft-teal-message d-flex align-items-center gap-3 p-4 rounded-3 border-2 border-dotted mb-0">
                                        <div className="cs-project-logo-frame" style={{ position: 'relative', flexShrink: 0 }}>
                                            <img
                                                src={logoPreview || DEFAULT_CAMERA_LOGO}
                                                alt="Camera"
                                                className="cs-project-logo-img"
                                            />
                                            {logoPreview && (
                                                <button type="button" onClick={handleLogoRemove} title="Remove image"
                                                    style={{ position: 'absolute', top: -9, right: -9, width: 24, height: 24, borderRadius: '50%', background: '#ef4444', border: '2px solid var(--bs-body-bg)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}>
                                                    <FiX size={11} />
                                                </button>
                                            )}
                                        </div>
                                        <div>
                                            <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="d-none" onChange={handleLogoSelect} />
                                            <button type="button" className="btn btn-sm bg-soft-teal text-teal d-inline-flex align-items-center gap-1" onClick={() => logoInputRef.current?.click()}>
                                                {logoPreview ? 'Change Logo' : 'Upload Logo'}
                                            </button>
                                            <p className="fs-12 fw-medium mb-0 mt-2">PNG, JPG, WebP, SVG (up to 2 MB)</p>
                                            {logoPreview && !logoUrl && <div className="mt-1" style={{ fontSize: '0.72rem', color: '#f59e0b' }}>Will upload on save</div>}
                                            {errors.logo && <div className="mt-1"><FieldError field="logo" /></div>}
                                        </div>
                                    </div>
                                </div>
                                <hr className="border-dashed" />

                                {/* Camera Identity */}
                                <div className="mb-4">
                                    <div className="mb-3">
                                        <h6 className="fw-bold mb-0">Camera Identity</h6>
                                        <span className="fs-11 text-muted">Name, project assignment and hardware details</span>
                                    </div>
                                    <div className="row g-3">
                                        <div className="col-md-6">
                                            <label className={LABEL} style={LABEL_STYLE}>Camera Name <span className="text-danger">*</span></label>
                                            <div className="input-group">
                                                <div className="input-group-text"><FiCamera size={15} /></div>
                                                <input
                                                    type="text"
                                                    className={`form-control${errors.name ? ' is-invalid' : ''}`}
                                                    placeholder="e.g. Main Gate Entrance"
                                                    style={{ fontSize: '0.875rem' }}
                                                    value={form.name}
                                                    onChange={set('name')}
                                                    maxLength={200}
                                                />
                                            </div>
                                            <div className="d-flex justify-content-between mt-1">
                                                <FieldError field="name" />
                                                <span className="text-muted" style={{ fontSize: '0.72rem' }}>{(form.name || '').length}/200</span>
                                            </div>
                                        </div>
                                        <div className="col-md-6">
                                            <label className={LABEL} style={LABEL_STYLE}>Project <span className="text-danger">*</span></label>
                                            <SelectDropdown
                                                value={form.site_id}
                                                invalid={!!errors.site_id}
                                                placeholder="Select a project"
                                                options={sites.map(s => ({ value: String(s.id), label: s.name }))}
                                                onChange={(v) => set('site_id')({ target: { type: 'text', value: v } })}
                                                menuPosition="end"
                                                buttonStyle={{ fontSize: '0.875rem', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                            />
                                            {errors.site_id && <div className="mt-1"><FieldError field="site_id" /></div>}
                                        </div>
                                        <div className="col-md-4">
                                            <label className={LABEL} style={LABEL_STYLE}>Vendor</label>
                                            <div className="input-group">
                                                <div className="input-group-text"><FiPackage size={15} /></div>
                                                <input
                                                    type="text"
                                                    className={`form-control${errors.vendor ? ' is-invalid' : ''}`}
                                                    placeholder="e.g. Hikvision"
                                                    style={{ fontSize: '0.875rem' }}
                                                    value={form.vendor}
                                                    onChange={set('vendor')}
                                                    maxLength={200}
                                                />
                                            </div>
                                            {errors.vendor && <div className="mt-1"><FieldError field="vendor" /></div>}
                                        </div>
                                        <div className="col-md-4">
                                            <label className={LABEL} style={LABEL_STYLE}>Model</label>
                                            <div className="input-group">
                                                <div className="input-group-text"><FiTag size={15} /></div>
                                                <input
                                                    type="text"
                                                    className={`form-control${errors.model ? ' is-invalid' : ''}`}
                                                    placeholder="e.g. DS-2CD2185G1"
                                                    style={{ fontSize: '0.875rem' }}
                                                    value={form.model}
                                                    onChange={set('model')}
                                                    maxLength={200}
                                                />
                                            </div>
                                            {errors.model && <div className="mt-1"><FieldError field="model" /></div>}
                                        </div>
                                        <div className="col-md-4">
                                            <label className={LABEL} style={LABEL_STYLE}>Serial Number</label>
                                            <div className="input-group">
                                                <div className="input-group-text"><FiHash size={15} /></div>
                                                <input
                                                    type="text"
                                                    className={`form-control${errors.serial_number ? ' is-invalid' : ''}`}
                                                    placeholder="e.g. HK-001-A1"
                                                    style={{ fontSize: '0.875rem' }}
                                                    value={form.serial_number}
                                                    onChange={set('serial_number')}
                                                    maxLength={200}
                                                />
                                            </div>
                                            {errors.serial_number && <div className="mt-1"><FieldError field="serial_number" /></div>}
                                        </div>
                                    </div>
                                </div>
                                <hr className="border-dashed" />

                                {/* ONVIF */}
                                <div className="mb-4">
                                    <div className="d-flex align-items-center justify-content-between mb-3">
                                        <div>
                                            <h6 className="fw-bold mb-0">ONVIF</h6>
                                            <span className="fs-11 text-muted">Protocol for camera discovery and stream setup</span>
                                        </div>
                                        <div className="cs-onvif-toggle">
                                            <ToggleSwitch
                                                inputId="onvifToggle"
                                                checked={form.onvif_supported}
                                                onChange={set('onvif_supported')}
                                                disabled={false}
                                            />
                                            <style>{`
                                                .cs-onvif-toggle .cs-fc-toggle { position: relative; display: inline-flex; align-items: center; }
                                                .cs-onvif-toggle .cs-fc-toggle-input { position: absolute; opacity: 0; width: 1px; height: 1px; }
                                                .cs-onvif-toggle .cs-fc-toggle-ui {
                                                    width: 44px;
                                                    height: 22px;
                                                    border-radius: 999px;
                                                    background: linear-gradient(180deg, rgba(0,0,0,0.10), rgba(0,0,0,0.06));
                                                    border: 1px solid rgba(0,0,0,0.14);
                                                    box-shadow: 0 10px 20px rgba(0,0,0,0.10);
                                                    position: relative;
                                                    transition: all 180ms ease;
                                                    cursor: pointer;
                                                    display: inline-block;
                                                }
                                                .cs-onvif-toggle .cs-fc-toggle-ui::before {
                                                    content: '';
                                                    position: absolute;
                                                    top: 3px;
                                                    left: 3px;
                                                    width: 16px;
                                                    height: 16px;
                                                    border-radius: 999px;
                                                    background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(255,255,255,0.82));
                                                    box-shadow: 0 8px 16px rgba(0,0,0,0.18);
                                                    transition: all 180ms ease;
                                                }
                                                .cs-onvif-toggle .cs-fc-toggle-input:checked + .cs-fc-toggle-ui {
                                                    background: linear-gradient(135deg, rgba(var(--bs-primary-rgb), 1) 0%, rgba(var(--bs-info-rgb), 0.85) 100%);
                                                    border-color: rgba(var(--bs-primary-rgb), 0.45);
                                                    box-shadow: 0 12px 24px rgba(var(--bs-primary-rgb), 0.22);
                                                }
                                                .cs-onvif-toggle .cs-fc-toggle-input:checked + .cs-fc-toggle-ui::before {
                                                    left: 25px;
                                                    background: linear-gradient(180deg, rgba(255,255,255,1), rgba(255,255,255,0.86));
                                                }
                                                .cs-onvif-toggle .cs-fc-toggle-input:focus + .cs-fc-toggle-ui {
                                                    outline: none;
                                                    box-shadow: 0 0 0 .2rem rgba(var(--bs-primary-rgb), 0.18), 0 12px 24px rgba(0,0,0,0.10);
                                                }
                                                .cs-onvif-toggle .cs-fc-toggle-disabled .cs-fc-toggle-ui { cursor: not-allowed; opacity: 0.6; box-shadow: none; }
                                                html.app-skin-dark .cs-onvif-toggle .cs-fc-toggle-ui {
                                                    background: linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0.06));
                                                    border-color: rgba(255,255,255,0.14);
                                                    box-shadow: none;
                                                }
                                                html.app-skin-dark .cs-onvif-toggle .cs-fc-toggle-ui::before {
                                                    background: linear-gradient(180deg, rgba(255,255,255,0.92), rgba(255,255,255,0.74));
                                                    box-shadow: 0 10px 22px rgba(0,0,0,0.35);
                                                }
                                                html.app-skin-dark .cs-onvif-toggle .cs-fc-toggle-input:checked + .cs-fc-toggle-ui { box-shadow: 0 0 0 .2rem rgba(var(--bs-primary-rgb), 0.16); }
                                            `}</style>
                                        </div>
                                    </div>

                                    {form.onvif_supported && (
                                        <>
                                            <div className="row g-3 mb-3">
                                                <div className="col-md-6">
                                                    <label className={LABEL} style={LABEL_STYLE}>Username <span className="text-danger">*</span></label>
                                                    <div className="input-group">
                                                        <div className="input-group-text"><FiUser size={15} /></div>
                                                        <input
                                                            type="text"
                                                            className={`form-control${errors.username ? ' is-invalid' : ''}`}
                                                            placeholder="Camera username"
                                                            style={{ fontSize: '0.875rem' }}
                                                            autoComplete="off"
                                                            value={form.username}
                                                            onChange={set('username')}
                                                        />
                                                    </div>
                                                    {errors.username && <div className="mt-1"><FieldError field="username" /></div>}
                                                </div>
                                                <div className="col-md-6">
                                                    <label className={LABEL} style={LABEL_STYLE}>Password <span className="text-danger">*</span></label>
                                                    <div className="input-group">
                                                        <div className="input-group-text"><FiKey size={15} /></div>
                                                        <input
                                                            type={showOnvifPwd ? 'text' : 'password'}
                                                            className="form-control"
                                                            placeholder={isEdit && hasStoredPassword ? 'Leave blank to keep current' : 'Camera password'}
                                                            style={{ fontSize: '0.875rem' }}
                                                            autoComplete="new-password"
                                                            value={form.password}
                                                            onChange={set('password')}
                                                        />
                                                        <button type="button" className="input-group-text" style={{ cursor: 'pointer' }} onClick={() => setShowOnvifPwd(v => !v)} tabIndex={-1}>
                                                            {showOnvifPwd ? <FiEyeOff size={14} /> : <FiEye size={14} />}
                                                        </button>
                                                    </div>
                                                    {errors.password && <div className="mt-1"><FieldError field="password" /></div>}
                                                </div>
                                                <div className="col-md-6">
                                                    <label className={LABEL} style={LABEL_STYLE}>Service Host / IP <span className="text-danger">*</span></label>
                                                    <div className="input-group">
                                                        <div className="input-group-text"><FiWifi size={15} /></div>
                                                        <input
                                                            type="text"
                                                            className={`form-control${errors.onvif_host ? ' is-invalid' : ''}`}
                                                            placeholder="Hostname or IP address"
                                                            style={{ fontSize: '0.875rem' }}
                                                            value={form.onvif_host}
                                                            onChange={set('onvif_host')}
                                                        />
                                                    </div>
                                                    {errors.onvif_host && <div className="mt-1"><FieldError field="onvif_host" /></div>}
                                                </div>
                                                <div className="col-md-6">
                                                    <label className={LABEL} style={LABEL_STYLE}>ONVIF Port</label>
                                                    <div className="input-group">
                                                        <div className="input-group-text"><FiHash size={15} /></div>
                                                        <input
                                                            type="number"
                                                            className={`form-control${errors.onvif_port ? ' is-invalid' : ''}`}
                                                            placeholder="e.g. 80"
                                                            style={{ fontSize: '0.875rem' }}
                                                            value={form.onvif_port}
                                                            onChange={set('onvif_port')}
                                                        />
                                                    </div>
                                                    {errors.onvif_port && <div className="mt-1"><FieldError field="onvif_port" /></div>}
                                                </div>
                                                <div className="col-12">
                                                    <div className="form-text text-muted fs-11">
                                                        <span className="px-2 py-1 rounded text-break d-inline-flex align-items-center gap-2" style={{ backgroundColor: 'rgba(245, 158, 11, 0.15)', color: '#b45309' }}>
                                                            <span className="fw-semibold">Service URL:</span>
                                                            http://{form.onvif_host || '<host>'}/onvif/device_service
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="d-flex align-items-center gap-3 mb-3">
                                                <button type="button" className="btn btn-success btn-sm" onClick={handleFetchStreams} disabled={fetchingStreams}>
                                                    {fetchingStreams
                                                        ? <><span className="spinner-border spinner-border-sm me-2" role="status" />Connecting…</>
                                                        : <><FiWifi size={13} className="me-1" />Get Stream URLs</>
                                                    }
                                                </button>
                                                <span className="fs-11 text-muted">Connects to the camera and retrieves available stream URLs</span>
                                            </div>

                                            {onvifError && (
                                                <div className="cs-error-banner d-flex align-items-start gap-2 p-3 mb-3" style={{ fontSize: '0.875rem', color: '#dc2626', backgroundColor: 'rgba(220, 38, 38, 0.08)', borderRadius: '4px', borderLeft: '3px solid #dc2626' }}>
                                                    <FiAlertCircle size={16} className="mt-1 flex-shrink-0" style={{ color: '#dc2626' }} />
                                                    <span style={{ wordBreak: 'break-word' }}>{onvifError}</span>
                                                </div>
                                            )}

                                            {onvifDeviceInfo && (
                                                <div className="d-flex flex-wrap gap-2 mb-3">
                                                    {onvifDeviceInfo.manufacturer && (
                                                        <span className="badge bg-soft-primary text-primary fs-11">{onvifDeviceInfo.manufacturer}</span>
                                                    )}
                                                    {onvifDeviceInfo.model && (
                                                        <span className="badge bg-soft-info text-info fs-11">{onvifDeviceInfo.model}</span>
                                                    )}
                                                    {onvifDeviceInfo.firmware && (
                                                        <span className="badge bg-soft-warning text-warning fs-11">FW {onvifDeviceInfo.firmware}</span>
                                                    )}
                                                </div>
                                            )}

                                            {(snapshotLoading || snapshotImg) && (
                                                <div className="mb-3">
                                                    <div className="fs-11 fw-semibold text-muted mb-1 d-flex align-items-center gap-1">
                                                        <FiCamera size={11} /> Stream Preview
                                                        {snapshotLoading && <span className="spinner-border spinner-border-sm ms-1" style={{ width: 10, height: 10 }} />}
                                                    </div>
                                                    {snapshotImg && (
                                                        <img src={snapshotImg} alt="Camera stream preview" className="rounded"
                                                            style={{ width: '100%', maxHeight: 140, objectFit: 'cover', border: '1px solid var(--bs-border-color)' }} />
                                                    )}
                                                    {snapshotLoading && !snapshotImg && (
                                                        <div className="rounded d-flex align-items-center justify-content-center bg-soft-secondary" style={{ height: 90 }}>
                                                            <span className="fs-11 text-muted">Capturing frame…</span>
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            {onvifStreams.length > 0 && (
                                                <div className="mb-2">
                                                    <div className="d-flex align-items-center gap-2 mb-2">
                                                        <FiCheck size={13} className="text-success" />
                                                        <span className="fw-semibold fs-12 text-dark">Streams auto-assigned by resolution</span>
                                                    </div>
                                                    <div className="row g-2 mb-3">
                                                        <div className="col-md-6">
                                                            <div className="p-2 rounded border border-primary bg-soft-primary">
                                                                <div className="fs-11 text-primary fw-semibold mb-1">LIVE URL (Sub-stream)</div>
                                                                {onvifStreams.find(s => s.rtsp_url === form.rtsp_url_sub)
                                                                    ? <div className="fs-12 fw-semibold text-dark">
                                                                        {onvifStreams.find(s => s.rtsp_url === form.rtsp_url_sub).profile_name}
                                                                        <span className="ms-1 text-muted fw-normal">{onvifStreams.find(s => s.rtsp_url === form.rtsp_url_sub).resolution || ''}</span>
                                                                      </div>
                                                                    : <div className="fs-11 text-muted">Not assigned (only 1 stream found)</div>
                                                                }
                                                            </div>
                                                        </div>
                                                        <div className="col-md-6">
                                                            <div className="p-2 rounded border border-success bg-soft-success">
                                                                <div className="fs-11 text-success fw-semibold mb-1">RECORD URL (Main stream)</div>
                                                                {onvifStreams.find(s => s.rtsp_url === form.rtsp_url)
                                                                    ? <div className="fs-12 fw-semibold text-dark">
                                                                        {onvifStreams.find(s => s.rtsp_url === form.rtsp_url).profile_name}
                                                                        <span className="ms-1 text-muted fw-normal">{onvifStreams.find(s => s.rtsp_url === form.rtsp_url).resolution || ''}</span>
                                                                      </div>
                                                                    : <div className="fs-11 text-muted">Not assigned</div>
                                                                }
                                                            </div>
                                                        </div>
                                                    </div>
                                                    {onvifStreams.length > 2 && (
                                                        <details className="mt-1">
                                                            <summary className="fs-11 text-muted" style={{ cursor: 'pointer' }}>
                                                                Override assignment ({onvifStreams.length} profiles found)
                                                            </summary>
                                                            <div className="row g-2 mt-2">
                                                                <div className="col-md-6">
                                                                    <div className="fs-11 text-muted mb-1">Set as Live URL:</div>
                                                                    <div className="d-flex flex-column gap-1">
                                                                        {onvifStreams.map((s, i) => (
                                                                            <button key={i} type="button"
                                                                                className={`btn btn-xs text-start${form.rtsp_url_sub === s.rtsp_url ? ' btn-primary' : ' btn-outline-secondary'}`}
                                                                                onClick={() => handleSelectStream(s, 'sub')}>
                                                                                {s.profile_name} {s.resolution ? `· ${s.resolution}` : ''}
                                                                            </button>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                                <div className="col-md-6">
                                                                    <div className="fs-11 text-muted mb-1">Set as Record URL:</div>
                                                                    <div className="d-flex flex-column gap-1">
                                                                        {onvifStreams.map((s, i) => (
                                                                            <button key={i} type="button"
                                                                                className={`btn btn-xs text-start${form.rtsp_url === s.rtsp_url ? ' btn-success' : ' btn-outline-secondary'}`}
                                                                                onClick={() => handleSelectStream(s, 'main')}>
                                                                                {s.profile_name} {s.resolution ? `· ${s.resolution}` : ''}
                                                                            </button>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </details>
                                                    )}
                                                </div>
                                            )}

                                            {/* PTZ is silently enabled for all ONVIF cameras — no user toggle needed */}
                                        </>
                                    )}
                                </div>
                                <hr className="border-dashed" />

                                {/* RTSP Connection */}
                                <div className="mb-2">
                                    <h6 className="fw-bold mb-3">RTSP Connection</h6>
                                    <div className="row g-3">
                                        <div className="col-12">
                                            <label className={LABEL} style={LABEL_STYLE}>
                                                LIVE URL <span className="text-danger"></span>
                                            </label>
                                            <div className="input-group">
                                                <div className="input-group-text"><FiVideo size={13} /></div>
                                                <input
                                                    type="text"
                                                    className={`form-control text-primary${errors.rtsp_url_sub ? ' is-invalid' : ''}`}
                                                    placeholder="rtsp://<host>:<port>/<path>"
                                                    style={{ fontSize: '0.875rem' }}
                                                    value={form.rtsp_url_sub}
                                                    onChange={set('rtsp_url_sub')}
                                                />
                                            </div>
                                            <div className="form-text text-muted fs-11">Low resolution URL for live viewing</div>
                                            {errors.rtsp_url_sub && <div className="mt-1"><FieldError field="rtsp_url_sub" /></div>}
                                        </div>
                                        <div className="col-12">
                                            <label className={LABEL} style={LABEL_STYLE}>
                                                RECORD URL <span className="text-danger">*</span>
                                            </label>
                                            <div className="input-group">
                                                <div className="input-group-text"><FiVideo size={13} /></div>
                                                <input
                                                    type="text"
                                                    className={`form-control text-success${errors.rtsp_url ? ' is-invalid' : ''}`}
                                                    placeholder="rtsp://<host>:<port>/<path>"
                                                    style={{ fontSize: '0.875rem' }}
                                                    value={form.rtsp_url}
                                                    onChange={set('rtsp_url')}
                                                />
                                            </div>
                                            <div className="form-text text-muted fs-11">High resolution URL for direct recording</div>
                                            {errors.rtsp_url && <div className="mt-1"><FieldError field="rtsp_url" /></div>}
                                        </div>
                                        {/* Transport only shown when ONVIF is OFF */}
                                        {!form.onvif_supported && (
                                            <div className="col-md-4">
                                                <label className={LABEL} style={LABEL_STYLE}>Transport <span className="text-danger">*</span></label>
                                                <div className="input-group">
                                                    <div className="input-group-text"><FiVideo size={15} /></div>
                                                    <select className="form-select" value={form.transport} onChange={set('transport')} style={{ fontSize: '0.875rem' }}>
                                                        <option value="tcp">TCP</option>
                                                        <option value="udp">UDP</option>
                                                    </select>
                                                </div>
                                            </div>
                                        )}
                                        {/* Username/password only when ONVIF is OFF */}
                                        {!form.onvif_supported && (
                                            <>
                                                <div className="col-md-4">
                                                    <label className={LABEL} style={LABEL_STYLE}>Username <span className="text-danger">*</span></label>
                                                    <div className="input-group">
                                                        <div className="input-group-text"><FiUser size={15} /></div>
                                                        <input
                                                            type="text"
                                                            className="form-control"
                                                            placeholder="Camera username"
                                                            style={{ fontSize: '0.875rem' }}
                                                            autoComplete="off"
                                                            value={form.username}
                                                            onChange={set('username')}
                                                        />
                                                    </div>
                                                </div>
                                                <div className="col-md-4">
                                                    <label className={LABEL} style={LABEL_STYLE}>Password <span className="text-danger">*</span></label>
                                                    <div className="input-group">
                                                        <div className="input-group-text"><FiKey size={15} /></div>
                                                        <input
                                                            type={showRtspPwd ? 'text' : 'password'}
                                                            className="form-control"
                                                            placeholder={isEdit && hasStoredPassword ? 'Leave blank to keep current' : 'Camera password'}
                                                            style={{ fontSize: '0.875rem' }}
                                                            autoComplete="new-password"
                                                            value={form.password}
                                                            onChange={set('password')}
                                                        />
                                                        <button type="button" className="input-group-text" style={{ cursor: 'pointer' }} onClick={() => setShowRtspPwd(v => !v)} tabIndex={-1}>
                                                            {showRtspPwd ? <FiEyeOff size={14} /> : <FiEye size={14} />}
                                                        </button>
                                                    </div>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </form>
                        )}

                        {/* ══ DISCOVER TAB ════════════════════════════════════════ */}
                        {!isEdit && activeTab === 'discover' ? (
                            <div>
                                <div className="d-flex flex-column flex-md-row align-items-center justify-content-center justify-content-md-between gap-3 mb-4">
                                    <div>
                                        <h6 className="fw-bold mb-1">Scan Local Network</h6>
                                        <span className="fs-12 text-muted">Discover ONVIF-compatible cameras on your network</span>
                                    </div>
                                    <button
                                        className="btn btn-success flex-shrink-0"
                                        style={{ height: 40, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}
                                        onClick={handleScan}
                                        disabled={scanning || importingIp !== null}
                                    >
                                        {scanning
                                            ? <><span className="spinner-border spinner-border-sm me-2" role="status" />Scanning…</>
                                            : <><FiSearch size={14} className="me-2" />Start Scan</>
                                        }
                                    </button>
                                </div>

                                {/* Credentials — required for auto-fetch on import */}
                                <div className="p-3 rounded mb-4" style={{ background: 'rgba(91,106,191,0.06)', border: '1px solid rgba(91,106,191,0.15)' }}>
                                    <div className="fs-12 fw-semibold mb-1 text-dark">
                                        Camera Credentials <span className="text-danger ms-1">*</span>
                                    </div>
                                    <div className="fs-11 text-muted mb-3">
                                        Used to authenticate the camera and retrieve device details
                                    </div>
                                    <div className="row g-2">
                                        <div className="col-md-4">
                                            <label className={LABEL} style={LABEL_STYLE}>Username <span className="text-danger">*</span></label>
                                            <div className="input-group">
                                                <div className="input-group-text"><FiUser size={15} /></div>
                                                <input
                                                    type="text"
                                                    className={`form-control${discoverCredsErrors.username ? ' is-invalid' : ''}`}
                                                    placeholder="Camera username"
                                                    style={{ fontSize: '0.875rem' }}
                                                    value={discoverCreds.username}
                                                    onChange={e => { setDiscoverCreds(p => ({ ...p, username: e.target.value })); setDiscoverCredsErrors(p => ({ ...p, username: null })) }}
                                                    autoComplete="off"
                                                />
                                            </div>
                                            {discoverCredsErrors.username && (
                                                <span className="field-error d-flex align-items-center gap-1 mt-1" style={{ fontSize: '0.72rem', color: '#ef4444' }}>
                                                    <FiAlertCircle size={11} />{discoverCredsErrors.username}
                                                </span>
                                            )}
                                        </div>
                                        <div className="col-md-4">
                                            <label className={LABEL} style={LABEL_STYLE}>Password <span className="text-danger">*</span></label>
                                            <div className="input-group">
                                                <div className="input-group-text"><FiKey size={15} /></div>
                                                <input
                                                    type={showDiscoverPwd ? 'text' : 'password'}
                                                    className={`form-control${discoverCredsErrors.password ? ' is-invalid' : ''}`}
                                                    placeholder="Camera password"
                                                    style={{ fontSize: '0.875rem' }}
                                                    value={discoverCreds.password}
                                                    onChange={e => { setDiscoverCreds(p => ({ ...p, password: e.target.value })); setDiscoverCredsErrors(p => ({ ...p, password: null })) }}
                                                    autoComplete="new-password"
                                                />
                                                <button type="button" className="input-group-text" style={{ cursor: 'pointer' }} onClick={() => setShowDiscoverPwd(v => !v)} tabIndex={-1}>
                                                    {showDiscoverPwd ? <FiEyeOff size={14} /> : <FiEye size={14} />}
                                                </button>
                                            </div>
                                            {discoverCredsErrors.password && (
                                                <span className="field-error d-flex align-items-center gap-1 mt-1" style={{ fontSize: '0.72rem', color: '#ef4444' }}>
                                                    <FiAlertCircle size={11} />{discoverCredsErrors.password}
                                                </span>
                                            )}
                                        </div>
                                        <div className="col-md-4">
                                            <label className={LABEL} style={LABEL_STYLE}>ONVIF Port</label>
                                            <div className="input-group">
                                                <div className="input-group-text"><FiHash size={15} /></div>
                                                <input
                                                    type="number"
                                                    className="form-control"
                                                    placeholder="e.g. 80"
                                                    style={{ fontSize: '0.875rem' }}
                                                    value={discoverCreds.port}
                                                    onChange={e => setDiscoverCreds(p => ({ ...p, port: e.target.value }))}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {discovered.length > 0 && (
                                    <div className="table-responsive">
                                        <table className="table table-hover" style={{ minWidth: 'max-content', width: '100%' }}>
                                            <colgroup>
                                                <col style={{ width: 130 }} />
                                                <col style={{ width: 150 }} />
                                                <col style={{ width: 150 }} />
                                                <col style={{ width: 90 }} />
                                                <col style={{ width: 130 }} />
                                            </colgroup>
                                            <thead>
                                                <tr>
                                                    <th className="text-nowrap">IP Address</th>
                                                    <th className="text-nowrap">Name / Hardware</th>
                                                    <th className="text-nowrap">Service URL</th>
                                                    <th className="text-nowrap" style={{ textAlign: 'center' }}>ONVIF</th>
                                                    <th className="text-nowrap">Action</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {discovered.map((device, i) => (
                                                    <tr key={i}>
                                                        <td className="fw-semibold text-truncate">{device.ip}</td>
                                                        <td className="text-truncate">{device.name || device.hardware || '—'}</td>
                                                        <td className="text-muted fs-12">
                                                            <div className="text-truncate" style={{ maxWidth: '100%' }}>{device.service_url || '—'}</div>
                                                        </td>
                                                        <td className="text-center">
                                                            {device.onvif === true ? (
                                                                <div className="badge bg-soft-success text-success">Yes</div>
                                                            ) : device.onvif === false ? (
                                                                <div className="badge bg-soft-danger text-danger">No</div>
                                                            ) : (
                                                                <div className="badge bg-gray-200 text-muted">Unknown</div>
                                                            )}
                                                        </td>
                                                        <td>
                                                            <button
                                                                className="btn btn-sm btn-success"
                                                                onClick={() => handleImport(device)}
                                                                disabled={importingIp !== null}
                                                            >
                                                                {importingIp === device.ip
                                                                    ? <><span className="spinner-border spinner-border-sm me-1" style={{ width: 10, height: 10 }} />Fetching…</>
                                                                    : <><FiWifi size={12} className="me-1" />Import + Fetch</>
                                                                }
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                                {scanning && discovered.length === 0 && (
                                    <div className="text-center text-muted py-5">
                                        <div className="mb-3">
                                            <span className="spinner-border" role="status" style={{ width: 34, height: 34 }} />
                                        </div>
                                        <p className="fs-13 fw-semibold mb-1">Scanning your network for ONVIF devices</p>
                                        <p className="fs-11 mb-0">Results will appear automatically in a few seconds</p>
                                    </div>
                                )}
                                {!scanning && discovered.length === 0 && (
                                    <div className="text-center text-muted py-5">
                                        <FiWifi size={32} className="mb-3 opacity-50" />
                                        <p className="fs-13">Start a scan to discover cameras on your network</p>
                                    </div>
                                )}
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>
            {/* ── Sidebar (manual tab only) ────────────────────────────────────── */}
            {activeTab === 'manual' && !loading && (
            <div className="col-xl-4">
                {/* Connection Summary */}
                <div className="card">
                    <div className="card-header">
                        <div>
                            <h5 className="mb-0">Connection Summary</h5>
                            <span className="fs-12 text-muted">Summary of camera configuration</span>
                        </div>
                    </div>
                    <div className="card-body p-0">
                        {[
                            { key: 'name',      icon: FiCamera,  label: 'Camera Name', value: (form.name || '').trim() || 'Not configured', valueClass: 'text-dark' },
                            { key: 'project',   icon: FiMapPin,  label: 'Project',     value: selectedSiteLabel, valueClass: 'text-dark' },
                            { key: 'vendor',    icon: FiPackage, label: 'Vendor',      value: (form.vendor || '').trim() || 'Not configured', valueClass: 'text-dark' },
                            { key: 'model',     icon: FiTag,     label: 'Model',       value: (form.model || '').trim() || 'Not configured', valueClass: 'text-dark' },
                            { key: 'serial',    icon: FiHash,    label: 'Serial Number', value: (form.serial_number || '').trim() || 'Not configured', valueClass: 'text-dark' },
                            { key: 'user',      icon: FiUser,   label: 'Username',    value: (form.username || '').trim() || 'Not configured', valueClass: 'text-dark' },
                            {
                                key: 'onvif',
                                icon: FiWifi,
                                label: 'ONVIF',
                                value: form.onvif_supported
                                    ? 'Enabled'
                                    : 'Disabled',
                                valueClass: 'text-dark',
                            },
                            ...(form.onvif_supported ? [{ key: 'onvif_port', icon: FiHash, label: 'ONVIF Port', value: onvifPortLabel, valueClass: 'text-dark' }] : []),
                            ...(!form.onvif_supported ? [{ key: 'transport', icon: FiVideo, label: 'Transport', value: (form.transport || 'tcp').toUpperCase(), valueClass: 'text-dark' }] : []),
                            { key: 'live',   icon: FiVideo, label: 'Live URL',   value: liveUrlSummary, mono: true, valueClass: 'text-primary' },
                            { key: 'record', icon: FiVideo, label: 'Record URL', value: recordUrlSummary, mono: true, valueClass: 'text-success' },
                        ].map(({ key, icon: Icon, label, value, mono, valueClass }, i, arr) => (
                            <div
                                key={key}
                                className={i < arr.length - 1 ? 'cam-summary-row' : ''}
                                style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '11px 16px' }}
                            >
                                <span className="cam-icon-wrap">
                                    <Icon size={13} strokeWidth={2} />
                                </span>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                                    <span className="fs-10 fw-bold text-muted text-uppercase" style={{ letterSpacing: '0.08em' }}>{label}</span>
                                    {mono
                                        ? <code className={`cam-summary-code fs-11 text-break mb-0 ${valueClass || ''}`}>{value}</code>
                                        : <span className={`cam-summary-val fs-12 text-break ${valueClass || ''}`}>{value}</span>
                                    }
                                </div>
                            </div>
                        ))}
                    </div>
                    {!isEdit && (
                        <div className="card-footer bg-transparent p-0 border-0 d-none d-md-block" style={{ paddingTop: 14 }}>
                            <button
                                type="button"
                                className="btn btn-danger w-100"
                                style={{ fontWeight: 600, transition: 'none', borderTopLeftRadius: 0, borderTopRightRadius: 0, borderBottomLeftRadius: 'var(--bs-card-border-radius)', borderBottomRightRadius: 'var(--bs-card-border-radius)' }}
                                onClick={() => { clearDraft(); navigate('/admin/cameras/list'); }}
                            >
                                Cancel
                            </button>
                        </div>
                    )}
                </div>
            </div>
            )}
            </>
            )}
        </>
    )
}

export default CameraAddContent
