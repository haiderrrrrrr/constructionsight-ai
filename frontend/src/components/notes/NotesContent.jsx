import React, { useEffect, useState, useCallback } from 'react'
import { FiEdit2, FiInbox, FiStar, FiTrash2 } from 'react-icons/fi';
import PageLoader from '@/components/shared/PageLoader'
import { Link } from 'react-router-dom';
import { BsArrowLeft, BsArrowRight, BsCircleFill, BsStarFill } from 'react-icons/bs';
import NotesHeader from './NotesHeader';
import PerfectScrollbar from "react-perfect-scrollbar";
import Footer from '@/components/shared/Footer';
import NotesSidebar from './NotesSidebar';
import AddsNote from './AddsNote';
import { apiGet, apiPatch, apiDelete } from '@/utils/api';
import { onBroadcast } from '@/utils/broadcast';
import topTostError from '@/utils/topTostError';
import ConfirmDialog from '@/components/shared/ConfirmDialog';

const NotesContent = ({ projectId }) => {
    const [allNotes, setAllNotes]       = useState([])
    const [data, setData]               = useState([])
    const [sidebarOpen, setSidebarOpen] = useState(false)
    const [selectTab, setSelectTab]     = useState("alls")
    const [selectCategory, setSelectCategory] = useState({ id: "", name: "" })
    const [loading, setLoading]         = useState(false)
    const [page, setPage]               = useState(0)
    const [hasMore, setHasMore]         = useState(true)
    const [confirm, setConfirm]         = useState(null)
    const [acting, setActing]           = useState(false)

    const PAGE_SIZE = 12

    const loadNotes = useCallback(() => {
        if (!projectId) return
        setLoading(true)
        apiGet(`/projects/${projectId}/notes?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`)
            .then(notes => {
                setAllNotes(notes)
                setHasMore(Array.isArray(notes) && notes.length === PAGE_SIZE)
            })
            .catch(() => topTostError('Failed to load notes'))
            .finally(() => setLoading(false))
    }, [projectId, page])

    useEffect(() => {
        loadNotes()
    }, [loadNotes])

    // Broadcast listener for note changes (add/delete/update)
    useEffect(() => {
        const handler = () => loadNotes()
        window.addEventListener('cs:project-notes-refresh', handler)
        const unsub = onBroadcast('cs:project-notes-refresh', handler)
        return () => {
            window.removeEventListener('cs:project-notes-refresh', handler)
            unsub()
        }
    }, [loadNotes])

    // Visibility change listener
    useEffect(() => {
        const handler = () => { if (!document.hidden) loadNotes() }
        document.addEventListener('visibilitychange', handler)
        return () => document.removeEventListener('visibilitychange', handler)
    }, [loadNotes])

    useEffect(() => {
        setPage(0)
    }, [selectTab])

    useEffect(() => {
        if (selectTab === 'alls') setData(allNotes)
        else setData(allNotes.filter(n => n.category === selectTab))
    }, [selectTab, allNotes])

    const filteredCategory = []
    data?.forEach(({ category }) => {
        if (!filteredCategory.includes(category)) {
            filteredCategory.push(category)
        }
    })

    const handleNoteAdded = (note) => {
        setAllNotes(prev => [note, ...prev].slice(0, PAGE_SIZE))
    }

    const handleDeleteNote = async (id) => {
        const note = allNotes.find(n => n.id === id)
        if (!note) return
        setConfirm({
            variant: 'delete',
            title: 'Delete Note',
            message: `"${note.title}" will be permanently deleted. This cannot be undone.`,
            onConfirm: async () => {
                try {
                    setActing(true)
                    await apiDelete(`/projects/${projectId}/notes/${id}`)
                    setAllNotes(prev => prev.filter(n => n.id !== id))
                    setConfirm(null)
                    window.dispatchEvent(new Event('cs:project-notes-refresh'))
                } catch {
                    topTostError('Failed to delete note')
                } finally {
                    setActing(false)
                }
            },
        })
    }

    const handleFavourite = async (id) => {
        const note = allNotes.find(n => n.id === id)
        if (!note) return
        const next = !note.is_favourite
        setAllNotes(prev => prev.map(n => n.id === id ? { ...n, is_favourite: next } : n))
        try {
            await apiPatch(`/projects/${projectId}/notes/${id}`, { is_favourite: next })
        } catch {
            setAllNotes(prev => prev.map(n => n.id === id ? { ...n, is_favourite: !next } : n))
            topTostError('Failed to update note')
        }
    }

    const handleCategoryChange = async (e, name, id) => {
        e.preventDefault()
        setSelectCategory({ id, name })
        try {
            await apiPatch(`/projects/${projectId}/notes/${id}`, { category: name })
            setAllNotes(prev => prev.map(n => n.id === id ? { ...n, category: name } : n))
        } catch {
            setSelectCategory({ id: "", name: "" })
            topTostError('Failed to update category')
        }
    }

    return (
        <>
            <NotesSidebar selectTab={selectTab} setSelectTab={setSelectTab} sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />
            <AddsNote projectId={projectId} onNoteAdded={handleNoteAdded} onNoteUpdated={(note) => {
                setAllNotes(prev => prev.map(n => n.id === note.id ? note : n))
            }} />
            <div className="content-area">
                <PerfectScrollbar>
                    <style>{`
                        .notes-fav-gold svg { color: #ffa21d !important; }
                        .notes-fav-gold svg * { stroke: #ffa21d !important; fill: #ffa21d !important; }
                        .notes-del-red { color: #ef4444 !important; }
                        .notes-del-red svg { color: #ef4444 !important; }
                        .notes-del-red svg * { stroke: #ef4444 !important; fill: none !important; }
                    `}</style>
                    <NotesHeader
                        onPrev={() => setPage(p => Math.max(0, p - 1))}
                        onNext={() => setPage(p => p + 1)}
                        prevDisabled={page === 0 || loading}
                        nextDisabled={!hasMore || loading}
                    />
                    <div className="content-area-body pb-0">
                        {loading ? (
                            <PageLoader />
                        ) : (
                            <div className="row note-has-grid" id="note-full-container">
                                {data?.map(({ category, content, created_at, id, title, is_favourite }) => (
                                    <NoteCard
                                        key={id}
                                        id={id}
                                        title={title}
                                        date={new Date(created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}
                                        content={content || ''}
                                        category={category}
                                        handleFavourite={handleFavourite}
                                        handleDeleteNote={handleDeleteNote}
                                        filteredCategory={filteredCategory}
                                        isFavourite={is_favourite}
                                        onCategory={handleCategoryChange}
                                        selectCategory={selectCategory}
                                    />
                                ))}
                                {!loading && data.length === 0 && (
                                    <div className="col-12">
                                        <div className="py-5 text-center text-muted">
                                            <hr className="my-4 opacity-25" />
                                            <div
                                                className="d-inline-flex align-items-center justify-content-center rounded-circle mb-3"
                                                style={{ width: 56, height: 56, background: 'rgba(var(--bs-primary-rgb), 0.12)', color: 'var(--bs-primary)' }}
                                            >
                                                <FiInbox size={18} />
                                            </div>
                                            <div className="fw-bold fs-16" style={{ color: 'var(--bs-heading-color)' }}>
                                                {allNotes.length === 0 && page === 0
                                                    ? 'No notes yet'
                                                    : (selectTab !== 'alls' ? 'No notes in this category' : 'No notes found')}
                                            </div>
                                            <div className="fs-13 text-muted mt-1">
                                                {allNotes.length === 0 && page === 0
                                                    ? 'Notes will appear here once they are created'
                                                    : (page > 0 ? 'Try going back to the previous page' : 'Try switching tabs or creating a new note')}
                                            </div>
                                            <hr className="my-4 opacity-25" />
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    <Footer />
                </PerfectScrollbar>
            </div>
            <ConfirmDialog
                open={!!confirm}
                variant={confirm?.variant}
                title={confirm?.title}
                message={confirm?.message}
                loading={acting}
                onClose={() => { if (!acting) setConfirm(null) }}
                onConfirm={async () => {
                    if (!confirm?.onConfirm) return
                    try { setActing(true); await confirm.onConfirm() }
                    finally { setActing(false) }
                }}
            />
        </>
    )
}

export default NotesContent


const NoteCard = ({ title, date, content, category, handleFavourite, handleDeleteNote, filteredCategory, id, isFavourite, onCategory, selectCategory }) => {
    return (
        <div className="col-xxl-4 col-xl-6 col-lg-4 col-sm-6 single-note-item all-category">
            <div className="card card-body mb-4 stretch stretch-full">
                <span className={`side-stick bg-${getColor(selectCategory.id == id ? selectCategory.name : category)}`}></span>
                <h5 className="note-title text-truncate w-75 mb-1 d-flex align-items-center" data-noteheading={title}>
                    {title}
                    <i className="point ms-2 fs-7">
                        {(() => {
                            const col = getColorVar(selectCategory.id == id ? selectCategory.name : category)
                            return <BsCircleFill style={{ color: col, fill: col, stroke: col }} />
                        })()}
                    </i>
                </h5>
                <p className="fs-11 text-muted note-date">{date}</p>
                <div className="note-content flex-grow-1">
                    <p className="text-muted note-inner-content text-truncate-3-line" data-notecontent={content}>
                        {content}
                    </p>
                </div>
                <div className="d-flex align-items-center gap-1">
                    <span
                        className={`avatar-text avatar-sm ${isFavourite ? 'notes-fav-gold' : ''}`}
                        onClick={() => handleFavourite(id)}
                    >
                        {isFavourite ? <BsStarFill /> : <FiStar />}
                    </span>
                    <span
                        className="avatar-text avatar-sm"
                        onClick={() => {
                            const ev = new CustomEvent('cs:open-edit-note', { detail: { id, title, content, category } })
                            window.dispatchEvent(ev)
                        }}
                        title="Edit"
                    >
                        <FiEdit2 />
                    </span>
                    <span className="avatar-text avatar-sm notes-del-red" onClick={() => handleDeleteNote(id)}>
                        <FiTrash2 />
                    </span>
                    <div className="ms-auto"></div>
                </div>
            </div>
        </div>
    );
};

const getCategoryLabel = (name) => {
    const labels = {
        tasks: 'Tasks', work: 'Work', team: 'Team', archive: 'Archive',
        urgent: 'Urgent', personal: 'Personal', client: 'Client', important: 'Important',
    }
    return labels[name] || name
}

const getColor = (name) => {
    switch (name) {
        case 'tasks':     return "danger"
        case 'work':      return "primary"
        case 'team':      return "info"
        case 'archive':   return "dark"
        case 'urgent':    return "danger"
        case 'personal':  return "primary"
        case 'client':    return "warning"
        case 'important': return "success"
        default:          return null
    }
}

const getColorVar = (name) => {
    switch (getColor(name)) {
        case 'danger':  return 'var(--bs-danger)'
        case 'primary': return 'var(--bs-primary)'
        case 'info':    return 'var(--bs-info)'
        case 'dark':    return 'var(--bs-dark)'
        case 'warning': return 'var(--bs-warning)'
        case 'success': return 'var(--bs-success)'
        default:        return 'var(--bs-secondary)'
    }
}
