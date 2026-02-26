import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import PageLoader from '@/components/shared/PageLoader'
import { FiBox, FiMoreVertical } from 'react-icons/fi'
import { apiGet, apiDelete, API_BASE } from '@/utils/api'
import PageHeader from '@/components/shared/pageHeader/PageHeader'
import BimViewer from '@/components/bim/BimViewer'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import topTostError from '@/utils/topTostError'
import getIcon from '@/utils/getIcon'

const MAX_MB = 150

export default function BimWorkspacePage() {
  const { projectId } = useParams()
  const pid = parseInt(projectId)

  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [myRole, setMyRole] = useState(null)

  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [deleting, setDeleting] = useState(false)
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false)
  const inputRef = useRef()

  const loadConfig = useCallback(() => {
    apiGet(`/projects/${pid}/bim/config`)
      .then(data => setConfig(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [pid])

  useEffect(() => {
    loadConfig()
    apiGet(`/projects/${pid}`)
      .then(data => setMyRole(data?.my_role))
      .catch(() => {})
  }, [pid, loadConfig])

  const isPm = myRole === 'project_manager'

  async function uploadFile(f) {
    if (!f || uploading) return
    if (!f.name.toLowerCase().endsWith('.glb') && !f.name.toLowerCase().endsWith('.gltf')) {
      topTostError('Only .glb or .gltf files are supported')
      return
    }
    if (f.size > MAX_MB * 1024 * 1024) {
      topTostError(`File exceeds ${MAX_MB} MB limit`)
      return
    }
    setFile(f)
    setProgress(0)
    setUploading(true)
    try {
      const token = window.sessionStorage.getItem('access_token')
      const form = new FormData()
      form.append('file', f)

      const xhr = new XMLHttpRequest()
      xhr.upload.addEventListener('progress', e => {
        if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100))
      })

      await new Promise((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText))
          else {
            try { reject(new Error(JSON.parse(xhr.responseText).detail || 'Upload failed')) }
            catch { reject(new Error('Upload failed')) }
          }
        }
        xhr.onerror = () => reject(new Error('Network error'))
        xhr.open('POST', `${API_BASE}/projects/${pid}/bim/model`)
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
        xhr.withCredentials = true
        xhr.send(form)
      })

      topTostError('3D model uploaded', 'success')
      setFile(null)
      setProgress(0)
      if (inputRef.current) inputRef.current.value = ''
      loadConfig()
    } catch (err) {
      topTostError(err.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function handleDeleteConfirmed() {
    setDeleting(true)
    try {
      await apiDelete(`/projects/${pid}/bim/model`)
      setConfig(c => ({ ...c, model_url: null, model_filename: null, model_size_bytes: null }))
      topTostError('3D model removed', 'success')
    } catch {
      topTostError('Failed to remove model')
    } finally {
      setDeleting(false)
    }
  }

  if (loading) return <PageLoader minHeight="60vh" />

  return (
    <>
      <PageHeader projectCrumbsKey="bim" projectCrumbsLeaf="BIM Model" hideMobileToggle>
        <div className="d-flex align-items-center gap-2 page-header-right-items-wrapper">
          {(!!config?.model_url && isPm) && (
            <div className="filter-dropdown">
              <a className="btn btn-icon btn-light-brand" data-bs-toggle="dropdown" data-bs-offset="0, 10" data-bs-auto-close="outside">
                <i className="lh-1"><FiMoreVertical /></i>
              </a>
              <div className="dropdown-menu dropdown-menu-end">
                <li>
                  <a href="#" className="dropdown-item text-danger" onClick={(e) => { e.preventDefault(); setConfirmRemoveOpen(true) }}>
                    <i className="me-3">{getIcon('feather-trash-2')}</i>
                    <span>Remove BIM 3D Model</span>
                  </a>
                </li>
              </div>
            </div>
          )}
        </div>
      </PageHeader>
      <div className="main-content">
        <style>{`
          .page-header .dropdown-item.text-danger { color: #ef4444 !important; }
          .page-header .dropdown-item.text-danger:hover,
          .page-header .dropdown-item.text-danger:focus,
          .page-header .dropdown-item.text-danger:active {
            color: #ef4444 !important;
            background-color: rgba(239, 68, 68, 0.1);
          }
          .page-header .dropdown-item svg { color: currentColor; }
          html.app-skin-dark .page-header .dropdown-item svg { color: currentColor !important; }
          .page-header .dropdown-item.text-danger svg,
          .page-header .dropdown-item.text-danger svg * {
            color: #ef4444 !important;
            stroke: #ef4444 !important;
          }
        `}</style>
        <ConfirmDialog
          open={confirmRemoveOpen}
          variant="danger"
          title="Remove 3D model"
          message="This action cannot be undone."
          confirmLabel="Confirm"
          loading={deleting}
          onClose={() => { if (!deleting) setConfirmRemoveOpen(false) }}
          onConfirm={() => handleDeleteConfirmed().finally(() => setConfirmRemoveOpen(false))}
        />

        <div className="d-flex align-items-center justify-content-between mb-2 flex-wrap gap-2">
          <label className="fs-12 fw-semibold text-muted text-uppercase letter-spacing-1 mb-0 d-block">
            BIM 3D Model
          </label>
        </div>

        {/* Upload area — shown when no model or PM wants to replace */}
        {(!config?.model_url && isPm) && (
          <div className="mb-4">
            <style>{`
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
              .cs-bim-icon{
                color: rgba(20,184,166,1);
              }
              html.app-skin-dark .cs-bim-icon{
                color: rgba(20,184,166,1) !important;
              }
            `}</style>
            <div className="alert alert-soft-teal-message d-flex align-items-center gap-3 p-4 rounded-3 border-2 border-dotted mb-0">
              <div className="cs-project-logo-frame" style={{ position: 'relative', flexShrink: 0 }}>
                <div
                  className="cs-project-logo-img d-flex align-items-center justify-content-center"
                >
                  <FiBox size={32} className="cs-bim-icon" />
                </div>
              </div>
              <div>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".glb,.gltf"
                  className="d-none"
                  onChange={e => uploadFile(e.target.files[0])}
                />
                <button
                  type="button"
                  className="btn btn-sm bg-soft-teal text-teal d-inline-flex align-items-center gap-1"
                  onClick={() => inputRef.current?.click()}
                  disabled={uploading}
                >
                  <i className="feather-upload me-1" />
                  {file ? 'Change Model' : 'Upload Model'}
                </button>
                {file ? (
                  <div className="mt-2">
                    <div className="fw-semibold fs-13">File selected</div>
                    <div className="fs-12 text-muted">{(file.size / (1024 * 1024)).toFixed(1)} MB</div>
                  </div>
                ) : (
                  <p className="fs-12 fw-medium mb-0 mt-2">.glb or .gltf (up to {MAX_MB} MB)</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* No model + not PM — show empty viewer */}
        {!config?.model_url && !isPm && (
          <BimViewer modelUrl={null} />
        )}

        {/* Viewer */}
        {config?.model_url && (
          <>
            <div style={{ height: 'calc(100vh - 240px)', minHeight: 450 }}>
              <BimViewer modelUrl={config.model_url} />
            </div>
          </>
        )}

      </div>
    </>
  )
}
