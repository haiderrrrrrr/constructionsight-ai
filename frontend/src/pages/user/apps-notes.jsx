import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import NotesContent from '@/components/notes/NotesContent'
import PageLoader from '@/components/shared/PageLoader'
import { apiGet } from '@/utils/api'

const AppsNotes = () => {
    const { projectId } = useParams()
    const navigate = useNavigate()
    const allowedRoles = ['project_manager', 'safety_officer', 'site_supervisor', 'data_analyst']
    const [myRole, setMyRole] = useState(() => {
        try {
            const raw = window.sessionStorage.getItem(`cs:projectMeta:${projectId}`)
            if (!raw) return null
            const parsed = JSON.parse(raw)
            return parsed?.my_role || null
        } catch {
            return null
        }
    })
    const [checking, setChecking] = useState(() => !!projectId && !myRole)
    if (!projectId) {
        return (
            <div className="w-100 d-flex align-items-center justify-content-center py-5 text-muted">
                Open Notes from inside a project.
            </div>
        )
    }

    useEffect(() => {
        if (!projectId) return
        if (myRole && allowedRoles.includes(myRole)) { setChecking(false); return }
        if (myRole && !allowedRoles.includes(myRole)) {
            navigate(`/projects/${projectId}/cameras`, { replace: true })
            return
        }
        setChecking(true)
        apiGet(`/projects/${projectId}`)
            .then((p) => {
                const role = p?.my_role || null
                setMyRole(role)
                try {
                    window.sessionStorage.setItem(
                        `cs:projectMeta:${projectId}`,
                        JSON.stringify({
                            name: p?.name,
                            my_role: p?.my_role,
                            status: p?.status,
                            my_email: p?.my_email,
                            my_user_id: p?.my_user_id,
                        })
                    )
                } catch {}
                if (role && !allowedRoles.includes(role)) {
                    navigate(`/projects/${projectId}/cameras`, { replace: true })
                }
            })
            .catch(() => navigate(`/projects/${projectId}/cameras`, { replace: true }))
            .finally(() => setChecking(false))
    }, [allowedRoles, myRole, navigate, projectId])

    if (checking) return <PageLoader minHeight="60vh" />
    if (myRole && !allowedRoles.includes(myRole)) return null
    return <NotesContent projectId={projectId} />
}

export default AppsNotes
