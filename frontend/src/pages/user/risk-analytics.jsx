import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { FiDownload } from 'react-icons/fi'
import PageHeader from '@/components/shared/pageHeader/PageHeader'
import RiskDashboard from '@/components/projectWorkspace/RiskDashboard'
import topTostError from '@/utils/topTostError'

export default function RiskAnalytics() {
    const { projectId } = useParams()
    const [downloading, setDownloading] = useState(false)

    async function handleExport() {
        if (downloading) return
        setDownloading(true)
        const token = window.sessionStorage.getItem('access_token')
        try {
            const res = await fetch(
                `http://localhost:8000/projects/${projectId}/reports/export`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    },
                    credentials: 'include',
                    body: JSON.stringify({
                        start_date:  '2000-01-01T00:00:00Z',
                        end_date:    new Date().toISOString(),
                        report_type: 'risk',
                    }),
                }
            )
            if (!res.ok) {
                let detail = 'Report generation failed.'
                try { const d = await res.json(); detail = d?.detail || detail } catch (_) {}
                throw new Error(detail)
            }
            const blob = await res.blob()
            const url  = window.URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = url
            link.download = `Risk_Analysis_Report_Project_${projectId}_Full.pdf`
            document.body.appendChild(link)
            link.click()
            document.body.removeChild(link)
            window.URL.revokeObjectURL(url)
            topTostError('Risk Analysis Report downloaded.', 'success')
        } catch (err) {
            topTostError(err.message || 'Failed to generate report.')
        } finally {
            setDownloading(false)
        }
    }

    return (
        <>
            <PageHeader
                projectCrumbsKey="reports"
                projectCrumbsLeaf="risk"
            >
                <div className="d-flex align-items-center gap-2 page-header-right-items-wrapper">
                    <button
                        className="btn btn-sm btn-primary d-flex align-items-center gap-2"
                        onClick={handleExport}
                        disabled={downloading}
                    >
                        {downloading
                            ? <><span className="spinner-border spinner-border-sm" style={{ width: 13, height: 13 }} /> Generating…</>
                            : <><FiDownload size={14} /> Export Report</>
                        }
                    </button>
                </div>
            </PageHeader>
            <div className="main-content">
                {projectId && <RiskDashboard projectId={parseInt(projectId)} />}
            </div>
        </>
    )
}
