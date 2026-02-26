import { useState, useEffect, useMemo } from 'react'
import { BsArrowLeft, BsArrowRight, BsDot } from 'react-icons/bs'
import PropTypes from 'prop-types'
import CardHeader from '@/components/shared/CardHeader'
import CardLoader from '@/components/shared/CardLoader'
import useCardTitleActions from '@/hooks/useCardTitleActions'

// Prettify snake_case event type → "Title Case"
const prettyEvent = (type) =>
    (type || 'Unknown Event')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())

// Get a readable sub-label from event metadata
const subLabel = (event) => {
    const d = event.details || {}
    return d.project_name || d.name || d.email || event.actor_name || `Event #${event.id}`
}

// Compute elapsed seconds from ISO timestamp
const elapsedSeconds = (isoStr) => {
    if (!isoStr) return 0
    return Math.max(0, Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000))
}

// Split seconds → [hours, minutes, seconds]
const toHMS = (totalSecs) => {
    const h = Math.floor(totalSecs / 3600)
    const m = Math.floor((totalSecs % 3600) / 60)
    const s = totalSecs % 60
    return [h, m, s]
}

// Pad a number to 2 digits, split into [tens, units]
const digits = (n) => {
    const s = String(Math.min(n, 99)).padStart(2, '0')
    return [s[0], s[1]]
}

const getPagerItems = (pageCount, current) => {
    if (pageCount <= 1) return [1]
    if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1)
    const items = new Set([1, 2, pageCount - 1, pageCount, current - 1, current, current + 1])
    const nums = Array.from(items).filter(n => n >= 1 && n <= pageCount).sort((a, b) => a - b)
    const out = []
    for (let i = 0; i < nums.length; i++) {
        const n = nums[i]
        const prev = nums[i - 1]
        if (i > 0 && n - prev > 1) out.push('dots')
        out.push(n)
    }
    return out
}

// ── Live countdown that ticks every second ────────────────────────────────────
const ElapsedCountdown = ({ createdAt }) => {
    const [secs, setSecs] = useState(() => elapsedSeconds(createdAt))

    useEffect(() => {
        const id = setInterval(() => setSecs(elapsedSeconds(createdAt)), 1000)
        return () => clearInterval(id)
    }, [createdAt])

    const [h, m, s] = toHMS(secs)
    const [h0, h1] = digits(h)
    const [m0, m1] = digits(m)
    const [s0, s1] = digits(s)

    return (
        <div className='countdown-container'>
            <div className='countdown'><span>{h0}</span><span>{h1}</span></div>
            <div className='seprator'>:</div>
            <div className='countdown'><span>{m0}</span><span>{m1}</span></div>
            <div className='seprator'>:</div>
            <div className='countdown'><span>{s0}</span><span>{s1}</span></div>
        </div>
    )
}

const Pager = ({ pageCount, pageIndex, onChange }) => {
    const safePage = Math.min(pageIndex, Math.max(0, pageCount - 1))
    const items = useMemo(() => getPagerItems(pageCount, safePage + 1), [pageCount, safePage])
    if (pageCount <= 1) return null
    return (
        <ul className="list-unstyled d-flex align-items-center gap-2 mb-0 pagination-common-style">
            <li className={!safePage ? 'opacity-50 pe-none' : ''}>
                <a href="#" onClick={(e) => { e.preventDefault(); if (safePage > 0) onChange(safePage - 1) }}>
                    <BsArrowLeft size={16} />
                </a>
            </li>
            {items.map((item, i) => (
                item === 'dots'
                    ? <li key={`dots-${i}`}><a href="#" onClick={(e) => e.preventDefault()}><BsDot size={16} /></a></li>
                    : <li key={`p-${item}`}>
                        <a
                            href="#"
                            className={item === safePage + 1 ? 'active' : ''}
                            onClick={(e) => { e.preventDefault(); onChange(Number(item) - 1) }}
                        >
                            {item}
                        </a>
                    </li>
            ))}
            <li className={safePage >= pageCount - 1 ? 'opacity-50 pe-none' : ''}>
                <a href="#" onClick={(e) => { e.preventDefault(); if (safePage < pageCount - 1) onChange(safePage + 1) }}>
                    <BsArrowRight size={16} />
                </a>
            </li>
        </ul>
    )
}

const Remainders = ({ title, events, loginEvents, fullWidth = false }) => {
    const { refreshKey, isRemoved, isExpanded, handleRefresh, handleExpand, handleDelete } = useCardTitleActions();

    const allEvents = Array.isArray(events) ? events : []
    const allLogins = Array.isArray(loginEvents) ? loginEvents : []
    const pageSize = 8
    const loginPageSize = 8
    const [pageIndex, setPageIndex] = useState(0)
    const [loginPageIndex, setLoginPageIndex] = useState(0)
    const pageCount = Math.max(1, Math.ceil(allEvents.length / pageSize))
    const loginPageCount = Math.max(1, Math.ceil(allLogins.length / loginPageSize))
    const safeIndex = Math.min(pageIndex, pageCount - 1)
    const safeLoginIndex = Math.min(loginPageIndex, loginPageCount - 1)
    const start = safeIndex * pageSize
    const loginStart = safeLoginIndex * loginPageSize
    const rows = allEvents.slice(start, start + pageSize)
    const loginRows = allLogins.slice(loginStart, loginStart + loginPageSize)

    useEffect(() => { setPageIndex(0) }, [allEvents.length])
    useEffect(() => { setLoginPageIndex(0) }, [allLogins.length])

    if (isRemoved) return null;

    return (
        <div className={fullWidth ? 'col-12' : 'col-xxl-8'}>
            <div className={`card stretch stretch-full ${isExpanded ? "card-expand" : ""} ${refreshKey ? "card-loading" : ""}`}>
                <CardHeader title={title} refresh={handleRefresh} remove={handleDelete} expanded={handleExpand} />

                <div className="card-body custom-card-action p-0">
                    <style>{`
                        .cs-activity-table thead th { white-space: nowrap; }
                        .cs-activity-table td { vertical-align: middle; }
                        .cs-evt-title { font-weight: 700; }
                        .cs-evt-sub { color: rgba(148,163,184,0.80); }
                        html.app-skin-dark .cs-evt-sub { color: rgba(148,163,184,0.78); }
                        .cs-pill-type { letter-spacing: 0.08em; font-weight: 800; font-size: 10px; }
                        .cs-pill-elapsed { font-weight: 800; font-size: 10px; }
                        .cs-compact-countdown .countdown span { width: 18px; height: 18px; line-height: 18px; }
                        .cs-compact-countdown .seprator { line-height: 18px; }
                    `}</style>
                    <div className="table-responsive">
                        <table className="table table-hover mb-0 cs-activity-table">
                            <thead>
                                <tr>
                                    <th scope="col">Event</th>
                                    <th scope="col">Name</th>
                                    <th scope="col">Type</th>
                                    <th scope="col">Elapsed</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.length > 0
                                    ? rows.map((event) => (
                                        <LiveEventRow key={event.id} event={event} />
                                    ))
                                    : (
                                        <tr>
                                            <td colSpan={4} className="text-center text-muted py-4">No activity yet.</td>
                                        </tr>
                                    )}
                            </tbody>
                        </table>
                    </div>
                    <div className="card-footer">
                        <Pager pageCount={pageCount} pageIndex={safeIndex} onChange={setPageIndex} />
                    </div>

                    <div className="border-top" />
                    <div className="p-4 pb-2">
                        <div className="d-flex align-items-center justify-content-between">
                            <div>
                                <h6 className="mb-0">Login Activity</h6>
                                <div className="fs-12 text-muted">All login / logout events</div>
                            </div>
                        </div>
                    </div>
                    <div className="table-responsive">
                        <table className="table table-hover mb-0 cs-activity-table">
                            <thead>
                                <tr>
                                    <th scope="col">Event</th>
                                    <th scope="col">User</th>
                                    <th scope="col">Elapsed</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loginRows.length > 0
                                    ? loginRows.map((e) => (
                                        <tr key={e.id}>
                                            <td className="cs-evt-title">{prettyEvent(e.event_type)}</td>
                                            <td className="cs-evt-sub">{subLabel(e)}</td>
                                            <td>
                                                <span className="badge bg-soft-primary text-primary cs-pill-elapsed">
                                                    <span className="cs-compact-countdown"><ElapsedCountdown createdAt={e.created_at} /></span>
                                                </span>
                                            </td>
                                        </tr>
                                    ))
                                    : (
                                        <tr>
                                            <td colSpan={3} className="text-center text-muted py-4">No login events yet.</td>
                                        </tr>
                                    )}
                            </tbody>
                        </table>
                    </div>
                    <div className="card-footer">
                        <Pager pageCount={loginPageCount} pageIndex={safeLoginIndex} onChange={setLoginPageIndex} />
                    </div>
                </div>
                <CardLoader refreshKey={refreshKey} />
            </div>
        </div>
    )
}

export default Remainders


const LiveEventRow = ({ event }) => {
    return (
        <tr>
            <td>
                <div className="hstack gap-2">
                    <span className="wd-10 ht-10 bg-gray-400 rounded-circle d-inline-block me-2 lh-base"></span>
                    <div className="border-3 border-start rounded ps-3">
                        <span className="cs-evt-title">{prettyEvent(event.event_type)}</span>
                    </div>
                </div>
            </td>
            <td className="cs-evt-sub">{subLabel(event)}</td>
            <td>
                <span className="badge bg-soft-warning text-warning cs-pill-type">{event.target_type || event.event_type?.split('_')[0] || 'system'}</span>
            </td>
            <td>
                <span className="badge bg-soft-primary text-primary cs-pill-elapsed">
                    <span className="cs-compact-countdown"><ElapsedCountdown createdAt={event.created_at} /></span>
                </span>
            </td>
        </tr>
    )
}

ElapsedCountdown.propTypes = { createdAt: PropTypes.string }

Pager.propTypes = {
    pageCount: PropTypes.number.isRequired,
    pageIndex: PropTypes.number.isRequired,
    onChange: PropTypes.func.isRequired,
}

Remainders.propTypes = {
    title: PropTypes.string,
    events: PropTypes.array,
    loginEvents: PropTypes.array,
    fullWidth: PropTypes.bool,
}

LiveEventRow.propTypes = {
    event: PropTypes.object.isRequired,
}
