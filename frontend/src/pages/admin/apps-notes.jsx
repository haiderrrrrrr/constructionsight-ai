import { useParams } from 'react-router-dom'
import NotesContent from '@/components/notes/NotesContent'

const AppsNotes = () => {
    const { projectId } = useParams()
    if (!projectId) {
        return (
            <div className="w-100 d-flex align-items-center justify-content-center py-5 text-muted">
                Open Notes from inside a project.
            </div>
        )
    }
    return <NotesContent projectId={projectId} />
}

export default AppsNotes
