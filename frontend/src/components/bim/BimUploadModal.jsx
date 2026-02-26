import { useRef, useState } from 'react'
import { API_BASE } from '@/utils/api'
import topTostError from '@/utils/topTostError'

const MAX_MB = 150

export default function BimUploadPanel({ projectId, onUploaded, onCancel }) {
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const inputRef = useRef()

  function pickFile(f) {
    if (!f) return
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
  }

  async function handleUpload() {
    if (!file) return
    setUploading(true)
    try {
      const token = window.sessionStorage.getItem('access_token')
      const form = new FormData()
      form.append('file', file)

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
        xhr.open('POST', `${API_BASE}/projects/${projectId}/bim/model`)
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
        xhr.withCredentials = true
        xhr.send(form)
      })

      topTostError('3D model uploaded successfully', 'success')
      setFile(null)
      setProgress(0)
      onUploaded()
    } catch (err) {
      topTostError(err.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="card mb-3">
      <div className="card-header d-flex align-items-center justify-content-between">
        <span className="fw-semibold fs-14">Upload 3D Model</span>
        {onCancel && (
          <button type="button" className="btn-close" onClick={onCancel} />
        )}
      </div>
      <div className="card-body">
        <p className="fs-12 text-muted mb-3">
          Upload a <strong>.glb</strong> or <strong>.gltf</strong> file (max {MAX_MB} MB).
          Export only structural elements from Revit for best performance.
        </p>

        {/* File input — same pattern as camera logo picker */}
        <input
          ref={inputRef}
          type="file"
          accept=".glb,.gltf"
          className="d-none"
          onChange={e => pickFile(e.target.files[0])}
        />

        <div className="d-flex align-items-center gap-3 mb-3">
          <button
            type="button"
            className="btn btn-sm bg-soft-teal text-teal d-inline-flex align-items-center gap-1"
            onClick={() => inputRef.current?.click()}
          >
            <i className="feather-upload me-1" />
            {file ? 'Change File' : 'Choose File'}
          </button>
          {file ? (
            <div>
              <div className="fw-semibold fs-13">{file.name}</div>
              <div className="fs-12 text-muted">{(file.size / (1024 * 1024)).toFixed(1)} MB</div>
            </div>
          ) : (
            <span className="fs-12 text-muted">No file chosen (.glb or .gltf)</span>
          )}
        </div>

        {uploading && (
          <div className="mb-3">
            <div className="progress" style={{ height: 6 }}>
              <div className="progress-bar progress-bar-striped progress-bar-animated" style={{ width: `${progress}%` }} />
            </div>
            <div className="fs-11 text-muted mt-1">{progress}%</div>
          </div>
        )}

        <div className="d-flex gap-2">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!file || uploading}
            onClick={handleUpload}
          >
            {uploading ? <><span className="spinner-border spinner-border-sm me-1" />Uploading…</> : 'Upload Model'}
          </button>
          {onCancel && (
            <button type="button" className="btn btn-light btn-sm" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
