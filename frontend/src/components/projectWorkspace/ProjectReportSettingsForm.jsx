import React, { useEffect, useMemo, useState } from 'react'
import { FiSave } from 'react-icons/fi'
import PageLoader from '@/components/shared/PageLoader'
import { apiGet, apiPatch } from '@/utils/api'
import topTostError from '@/utils/topTostError'

const FREQUENCY_OPTIONS = [
    {
        value: 'daily',
        label: 'Daily',
    },
    {
        value: 'weekly',
        label: 'Weekly',
    },
    {
        value: 'monthly',
        label: 'Monthly',
    },
]

export default function ProjectReportSettingsForm({ projectId }) {
    const options = useMemo(() => FREQUENCY_OPTIONS, [])
    const [frequency, setFrequency] = useState('weekly')
    const [original, setOriginal] = useState('weekly')
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        if (!projectId) return
        setLoading(true)
        apiGet(`/projects/${projectId}/settings`)
            .then(data => {
                const freq = data?.report_frequency || 'weekly'
                setFrequency(freq)
                setOriginal(freq)
            })
            .catch(() => topTostError('Failed to load report settings.'))
            .finally(() => setLoading(false))
    }, [projectId])

    async function handleSave() {
        setSaving(true)
        try {
            await apiPatch(`/projects/${projectId}/settings`, { report_frequency: frequency })
            setOriginal(frequency)
            topTostError('Report settings saved successfully.', 'success')
        } catch {
            topTostError('Failed to save report settings.')
        } finally {
            setSaving(false)
        }
    }

    const isDirty = frequency !== original

    if (loading) return <PageLoader minHeight={150} />

    return (
        <div>
            <div className="mb-4">
                <h5 className="mb-2 fw-semibold">Reports Settings</h5>
                <p className="text-muted fs-13 mb-0">
                    Configure how often reports are generated for this project.
                </p>
            </div>

            <div className="mb-5">
                <label className="form-label">Report Frequency</label>
                <select className="form-select" value={frequency} onChange={e => setFrequency(e.target.value)}>
                    {options.map(opt => (
                        <option key={opt.value} value={opt.value}>
                            {opt.label}
                        </option>
                    ))}
                </select>
                <small className="form-text text-muted">Select daily, weekly, or monthly.</small>
            </div>

            <div className="d-flex align-items-center justify-content-end border-top pt-3">
                <div className="d-flex gap-2">
                    <button type="button" className="btn btn-outline-secondary" onClick={() => setFrequency(original)} disabled={saving}>
                        Cancel
                    </button>
                    <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving || !isDirty}>
                        <FiSave size={16} className="me-2" />
                        Save Changes
                    </button>
                </div>
            </div>
        </div>
    )
}
