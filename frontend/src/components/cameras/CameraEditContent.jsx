import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import PageLoader from '@/components/shared/PageLoader'
import { FiCamera, FiWifi, FiVideo, FiCheckCircle } from 'react-icons/fi'
import { apiGet } from '@/utils/api'
import { parseApiError } from '@/utils/errorHandler'
import topTostError from '@/utils/topTostError'
import { validateCameraIdentity } from '@/utils/cameraValidation'
import TabCameraIdentity from './wizard/TabCameraIdentity'
import TabCameraConnection from './wizard/TabCameraConnection'
import TabCameraOnvif from './wizard/TabCameraOnvif'
import TabCameraCompleted from './wizard/TabCameraCompleted'

const CameraEditContent = ({ cameraId }) => {
    const navigate = useNavigate()
    const [currentIndex, setCurrentIndex] = useState(0)
    const [maxReached, setMaxReached] = useState(0)
    const [cameraLoaded, setCameraLoaded] = useState(false)
    const [completed, setCompleted] = useState(false)

    const [formData, setFormData] = useState({
        name: '', site_id: '', vendor: '', model: '', serial_number: '',
        rtsp_url: '', rtsp_url_sub: '', username: '', password: '',
        onvif_supported: true, onvif_host: '', onvif_port: '80', transport: 'tcp',
        logo_file: null, logo_preview: null, logo_url: null, logo_public_id: null,
        has_stored_password: false,
    })

    const [initialFormData, setInitialFormData] = useState(null)
    const [sites, setSites] = useState([])
    const [errors, setErrors] = useState({})

    const prevOnvifHost = useRef('')

    // When ONVIF host IP changes, auto-replace the IP in RTSP URLs
    useEffect(() => {
        const oldHost = prevOnvifHost.current
        const newHost = formData.onvif_host.trim()
        if (!oldHost || !newHost || oldHost === newHost) {
            prevOnvifHost.current = newHost
            return
        }
        const replaceHost = (url) => {
            if (!url) return url
            try {
                const parsed = new URL(url)
                if (parsed.hostname === oldHost) {
                    parsed.hostname = newHost
                    return parsed.toString()
                }
            } catch { /* not a valid URL, skip */ }
            return url
        }
        setFormData(p => ({
            ...p,
            rtsp_url: replaceHost(p.rtsp_url),
            rtsp_url_sub: replaceHost(p.rtsp_url_sub),
        }))
        prevOnvifHost.current = newHost
    }, [formData.onvif_host])

    // Check if form has changed (dirty state)
    const isDirty = initialFormData && JSON.stringify(formData) !== JSON.stringify(initialFormData)

    // Warn on unsaved changes when navigating
    useEffect(() => {
        const handleBeforeUnload = (e) => {
            if (isDirty && !completed) {
                e.preventDefault()
                e.returnValue = 'You have unsaved changes. Are you sure you want to leave?'
                return 'You have unsaved changes. Are you sure you want to leave?'
            }
        }
        window.addEventListener('beforeunload', handleBeforeUnload)
        return () => window.removeEventListener('beforeunload', handleBeforeUnload)
    }, [isDirty, completed])

    useEffect(() => {
        if (!cameraId) {
            setCameraLoaded(true)
            return
        }
        Promise.all([
            apiGet('/admin/sites').catch(() => []),
            apiGet(`/admin/cameras/${cameraId}`).catch(() => null),
            apiGet(`/admin/cameras/${cameraId}/credentials`).catch(() => null),
        ])
            .then(([sitesData, cam, creds]) => {
                setSites(Array.isArray(sitesData) ? sitesData : [])
                if (cam) {
                    // Prevent editing archived cameras
                    if (cam.archived_at) {
                        topTostError('Cannot edit archived cameras. Restore the camera first to make changes.')
                        setTimeout(() => navigate('/admin/cameras/list'), 1500)
                        setCameraLoaded(true)
                        return
                    }
                    setFormData(p => ({
                        ...p, name: cam.name || '', site_id: String(cam.site_id || ''),
                        vendor: cam.vendor || '', model: cam.model || '', serial_number: cam.serial_number || '',
                        onvif_supported: cam.onvif_supported ?? true, logo_url: cam.logo_url || null,
                        logo_public_id: cam.logo_public_id || null,
                    }))
                } else {
                    topTostError('Camera not found')
                }
                if (creds) {
                    setFormData(p => {
                        const updated = {
                            ...p, rtsp_url: creds.rtsp_url || '', rtsp_url_sub: creds.rtsp_url_sub || '',
                            username: creds.username || '', onvif_host: creds.onvif_host || '',
                            onvif_port: String(creds.onvif_port || cam?.onvif_port || 80),
                            transport: creds.transport_preference || 'tcp', has_stored_password: !!creds.has_password,
                        }
                        // Set initial form data for dirty checking
                        setInitialFormData(updated)
                        prevOnvifHost.current = updated.onvif_host
                        return updated
                    })
                } else {
                    setFormData(p => {
                        setInitialFormData(p)
                        return p
                    })
                }
                setCameraLoaded(true)
            })
            .catch(err => {
                topTostError(parseApiError(err, 'Failed to load camera'))
                setCameraLoaded(true)
            })
    }, [cameraId])

    const STEPS = [
        { key: 'identity', name: 'Identity', Icon: FiCamera },
        { key: 'connection', name: 'Connection', Icon: FiWifi },
        { key: 'onvif', name: 'ONVIF', Icon: FiVideo },
        { key: 'completed', name: 'Completed', Icon: FiCheckCircle },
    ]

    const currentStep = STEPS[currentIndex]

    const handleNext = () => {
        if (currentIndex >= STEPS.length - 1) return
        if (currentStep.key === 'identity') {
            const identityErrors = validateCameraIdentity(formData)
            if (!formData.site_id) identityErrors.site_id = 'Required'
            if (Object.keys(identityErrors).length > 0) {
                setErrors(identityErrors)
                return
            }
            setErrors({})
        }
        if (currentIndex >= maxReached) setMaxReached(currentIndex + 1)
        setCurrentIndex(currentIndex + 1)
    }

    const handlePrev = () => {
        if (currentIndex > 0) setCurrentIndex(currentIndex - 1)
    }

    const renderTab = () => {
        const props = { formData, setFormData, sites, errors, setErrors, cameraId }
        switch (currentStep.key) {
            case 'identity': return <TabCameraIdentity {...props} />
            case 'connection': return <TabCameraConnection {...props} />
            case 'onvif': return <TabCameraOnvif {...props} />
            case 'completed': return <TabCameraCompleted {...props} completed={completed} setCompleted={setCompleted} />
            default: return null
        }
    }

    if (!cameraLoaded) return <PageLoader />

    return (
        <div className="col-12">
            <div className="card">
                <div className="card-header border-bottom d-flex gap-2 p-3">
                    {STEPS.map((s, i) => {
                        const Icon = s.Icon
                        const isCurrent = i === currentIndex
                        const isComplete = i < currentIndex
                        return (
                            <button key={s.key} className={`btn btn-sm ${isCurrent ? 'btn-primary' : 'btn-light'}`}
                                onClick={() => { if (i <= maxReached) setCurrentIndex(i) }}
                                disabled={i > maxReached} style={{ borderBottom: isCurrent ? '2px solid var(--bs-primary)' : isComplete ? '2px solid var(--bs-success)' : 'none', opacity: i > maxReached ? 0.4 : 1 }}>
                                <Icon size={16} className="me-1" />{s.name}
                            </button>
                        )
                    })}
                </div>
                <div className="card-body p-4">{renderTab()}</div>
                {!completed && (
                    <div className="card-footer border-top d-flex justify-content-between p-3">
                        <button className="btn btn-light" onClick={handlePrev} disabled={currentIndex === 0}>Previous</button>
                        <button className="btn btn-primary" onClick={handleNext} disabled={currentIndex >= STEPS.length - 1}>Next</button>
                    </div>
                )}
            </div>
        </div>
    )
}

export default CameraEditContent
