import React, { useEffect, useMemo, useState, useCallback } from 'react'
import TableSearch from './TableSearch'
import TablePagination from './TablePagination'
import { FaSort, FaSortDown, FaSortUp } from 'react-icons/fa'
import { FiSearch } from 'react-icons/fi'
import { flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import { Dropdown } from 'bootstrap'

const normalizeText = (v) => String(v ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const expandSearchValues = (v) => {
    if (v === null || v === undefined) return []
    if (typeof v === 'number' || typeof v === 'boolean') return [String(v)]
    if (typeof v !== 'string') return []
    const raw = v.trim()
    if (!raw) return []

    const out = [raw]
    const lower = raw.toLowerCase()

    if (raw.includes('_')) {
        out.push(raw.replace(/_/g, ' '))
        out.push(raw.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))
    }

    if (lower === 'cancelled') out.push('canceled')
    if (lower === 'canceled') out.push('cancelled')
    const parsed = Date.parse(raw)
    if (!Number.isNaN(parsed)) {
        const d = new Date(parsed)
        if (!Number.isNaN(d.getTime())) {
            const yyyy = String(d.getFullYear())
            const mm = String(d.getMonth() + 1).padStart(2, '0')
            const dd = String(d.getDate()).padStart(2, '0')
            out.push(`${mm}/${dd}/${yyyy}`)
            out.push(`${d.getMonth() + 1}/${d.getDate()}/${yyyy}`)
            out.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }))
            out.push(d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }))
            out.push(`${yyyy}${mm}${dd}`)
        }
    }

    return [...new Set(out)]
}

const getValueByPath = (obj, path) => {
    const parts = String(path || '').split('.')
    let cur = obj
    for (let i = 0; i < parts.length; i += 1) {
        if (cur == null) return undefined
        cur = cur[parts[i]]
    }
    return cur
}

const Table = ({ data, columns, searchKeys: searchKeysOverride, disableDefaultSorting = false, tableId = 'projectList', noCard = false }) => {
    // const [data] = useState([...fackData])
    const defaultSorting = useMemo(() => {
        if (disableDefaultSorting) return []
        const candidates = ['created_at', 'createdAt', 'updated_at', 'updatedAt', 'timestamp', 'date']
        for (const id of candidates) {
            const col = (columns || []).find(c =>
                (c?.accessorKey || c?.id) === id &&
                (c?.enableSorting !== false) &&
                (c?.columnDef?.enableSorting !== false)
            )
            if (col) return [{ id, desc: true }]
        }
        return []
    }, [columns, disableDefaultSorting])

    const searchKeys = useMemo(() => {
        if (Array.isArray(searchKeysOverride) && searchKeysOverride.length) return searchKeysOverride
        const cols = (columns || [])
        const getMeta = (c) => (c?.meta ?? c?.columnDef?.meta) || {}

        const fromMeta = cols
            .filter(c => getMeta(c)?.searchable === true)
            .map(c => c?.accessorKey)
            .filter(k => typeof k === 'string')
        if (fromMeta.length) return fromMeta

        const keys = cols
            .filter(c => getMeta(c)?.visible !== false)
            .map(c => c?.accessorKey)
            .filter(k => typeof k === 'string')
            .filter(k => !['id', 'actions'].includes(k))

        const preferred = keys.filter(k => /(name|site|status|vendor|model)/i.test(k))
        return (preferred.length ? preferred : keys).slice(0, 6)
    }, [columns, searchKeysOverride])

    const [sorting, setSorting] = useState(defaultSorting)
    const [globalFilter, setGlobalFilter] = useState('')
    const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768)

    const framedColumns = useMemo(() => {
        const cols = Array.isArray(columns) ? columns : []
        if (cols.some(c => (c?.id || c?.accessorKey) === '__gutter_left')) return cols
        const gutterLeft = {
            id: '__gutter_left',
            header: () => null,
            cell: () => null,
            enableSorting: false,
            meta: { headerClassName: 'cs-table-gutter', className: 'cs-table-gutter', visible: false },
        }
        const gutterRight = {
            id: '__gutter_right',
            header: () => null,
            cell: () => null,
            enableSorting: false,
            meta: { headerClassName: 'cs-table-gutter', className: 'cs-table-gutter', visible: false },
        }
        return [gutterLeft, ...cols, gutterRight]
    }, [columns])
    const [pagination, setPagination] = useState({
        pageIndex: 0,
        pageSize: 10,
    })

    useEffect(() => {
        const handler = () => setIsMobile(window.innerWidth < 768)
        window.addEventListener('resize', handler)
        return () => window.removeEventListener('resize', handler)
    }, [])

    const globalFilterFn = useCallback((row, _columnId, filterValue) => {
        const q = normalizeText(filterValue)
        if (!q) return true
        const tokens = q.split(' ').filter(Boolean)

        const values = (searchKeys || [])
            .map((key) => getValueByPath(row.original, key))
            .flatMap(expandSearchValues)
            .map(normalizeText)
            .filter(v => v !== '')

        if (values.length === 0) return false

        return tokens.every((t) => values.some(v => v.includes(t)))
    }, [searchKeys])

    useEffect(() => {
        if (defaultSorting.length === 0) return
        setSorting(prev => (prev && prev.length ? prev : defaultSorting))
    }, [defaultSorting])

    useEffect(() => {
        const ids = new Set((columns || []).map(c => c?.accessorKey || c?.id))
        setSorting(prev => {
            if (!prev || !prev.length) return defaultSorting
            const s = prev[0]
            if (!ids.has(s.id)) return defaultSorting
            return prev
        })
    }, [columns, defaultSorting])

    useEffect(() => {
        setPagination(prev => (prev.pageIndex === 0 ? prev : ({ ...prev, pageIndex: 0 })))
    }, [globalFilter])

    const effectivePagination = isMobile
        ? { pageIndex: 0, pageSize: 99999 }
        : pagination

    const table = useReactTable({
        data,
        columns: framedColumns,
        state: {
            sorting,
            globalFilter,
            pagination: effectivePagination,
        },
        onSortingChange: setSorting,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        onGlobalFilterChange: setGlobalFilter,
        globalFilterFn,
        getPaginationRowModel: getPaginationRowModel(),
        onPaginationChange: setPagination,
    })

    useEffect(() => {
        const pageCount = table.getPageCount()
        if (pageCount === 0) {
            if (table.getState().pagination.pageIndex !== 0) table.setPageIndex(0)
            return
        }
        const maxIndex = pageCount - 1
        if (table.getState().pagination.pageIndex > maxIndex) table.setPageIndex(maxIndex)
    }, [data, globalFilter, pagination.pageSize, pagination.pageIndex, table])

    useEffect(() => {
        const tableEl = document.getElementById(tableId)
        const root = tableEl?.closest?.('.function-table')
        if (!root) return

        const handleShow = (e) => {
            const toggle = e.relatedTarget
            if (!toggle || !root.contains(toggle)) return
            // Only apply to dropdowns inside table rows, not controls above
            if (!toggle.closest('tbody')) return
            requestAnimationFrame(() => {
                const instance = Dropdown.getInstance(toggle)
                if (!instance?._popper) return
                const rect = toggle.getBoundingClientRect()
                const spaceBelow = window.innerHeight - rect.bottom
                const flipUp = spaceBelow < 220
                // Respect existing menu alignment (end = right-aligned, else left-aligned)
                const menu = toggle.closest('.dropdown')?.querySelector('.dropdown-menu')
                const isEnd = menu?.classList?.contains('dropdown-menu-end')
                const placement = flipUp
                    ? (isEnd ? 'top-end' : 'top-start')
                    : (isEnd ? 'bottom-end' : 'bottom-start')
                instance._popper.setOptions({
                    placement,
                    strategy: 'fixed',
                    modifiers: [
                        { name: 'preventOverflow', options: { boundary: 'clippingParents', padding: 8 } },
                        { name: 'flip', enabled: false },
                    ],
                })
                instance._popper.update()
            })
        }

        root.addEventListener('show.bs.dropdown', handleShow)
        return () => root.removeEventListener('show.bs.dropdown', handleShow)
    }, [tableId])

    return (
        <div className="col-lg-12">
            <div className={`${noCard ? 'function-table-nocard' : 'card stretch stretch-full'} function-table`}>
                <div className={`${noCard ? '' : 'card-body'} p-0`}>
                    <style>{`
                        .function-table .cs-table-gutter {
                            width: 15px;
                            min-width: 15px;
                            padding: 0 !important;
                        }
                        .function-table table.dataTable tbody {
                            background-color: var(--bs-card-bg, transparent);
                        }
                        .function-table table.dataTable tbody tr > td {
                            border-bottom: 1px solid var(--bs-table-border-color);
                        }
                        .function-table .table-responsive {
                            -webkit-overflow-scrolling: touch;
                        }
                        .function-table .dataTables_wrapper .row.dt-row {
                            padding: 0 !important;
                        }
                    `}</style>
                    <div className="table-responsive">
                        <div className='dataTables_wrapper dt-bootstrap5 no-footer'>
                            <TableSearch table={table} setGlobalFilter={setGlobalFilter} globalFilter={globalFilter} isMobile={isMobile} />

                            <div className="row dt-row" style={isMobile ? { marginLeft: 0, marginRight: 0 } : {}}>
                                <div className="col-sm-12 px-0">
                                    <table
                                        className="table table-hover dataTable no-footer"
                                        id={tableId}
                                        style={isMobile
                                            ? { minWidth: 980, width: 'max-content' }
                                            : { minWidth: 'max-content', width: '100%' }
                                        }
                                    >
                                        <thead>
                                            {table.getHeaderGroups().map((headerGroup) => (
                                                <tr key={headerGroup.id} >
                                                    {
                                                        headerGroup.headers.map((header) => {
                                                            return (
                                                                <th key={header.id} className={header.column.columnDef.meta?.headerClassName}>
                                                                    {
                                                                        header.id === "id" ?
                                                                            <div className='d-flex gap-2'>
                                                                                {
                                                                                    flexRender(
                                                                                        header.column.columnDef.header,
                                                                                        header.getContext()
                                                                                    )

                                                                                }
                                                                                <ArrowToggle header={header} />
                                                                            </div>
                                                                            :
                                                                            <ArrowToggle header={header}>
                                                                                {
                                                                                    flexRender(
                                                                                        header.column.columnDef.header,
                                                                                        header.getContext()
                                                                                    )
                                                                                }
                                                                            </ArrowToggle>
                                                                    }
                                                                </th>
                                                            )
                                                        })
                                                    }
                                                </tr>
                                            ))}
                                        </thead>
                                        <tbody>
                                            {table.getRowModel().rows.length === 0 ? (
                                                <tr>
                                                    <td colSpan={table.getAllLeafColumns().length} className="text-center py-5">
                                                        <div className="d-flex flex-column align-items-center justify-content-center" style={{ minHeight: 180 }}>
                                                            <div
                                                                className="d-inline-flex align-items-center justify-content-center rounded-circle mb-3"
                                                                style={{ width: 56, height: 56, background: 'rgba(var(--bs-primary-rgb), 0.12)', color: 'var(--bs-primary)' }}
                                                            >
                                                                <FiSearch size={18} />
                                                            </div>
                                                            {String(globalFilter || '').trim() ? (
                                                                <>
                                                                    <div className="fw-bold fs-16" style={{ color: 'var(--bs-heading-color)' }}>
                                                                        No matching records
                                                                    </div>
                                                                    <div className="fs-13 text-muted mt-1">
                                                                        Try another keyword or clear the search
                                                                    </div>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <div className="fw-bold fs-16" style={{ color: 'var(--bs-heading-color)' }}>
                                                                        No records available
                                                                    </div>
                                                                    <div className="fs-13 text-muted mt-1">
                                                                        Records will appear here once they are created
                                                                    </div>
                                                                </>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            ) : (
                                                table.getRowModel().rows.map((row) => (
                                                    <tr key={row.id} className='single-item chat-single-item'>
                                                        {row.getVisibleCells().map((cell) => {
                                                            return (
                                                                <td key={cell.id} className={cell.column.columnDef.meta?.className}>
                                                                    {
                                                                        flexRender(
                                                                            cell.column.columnDef.cell,
                                                                            cell.getContext()
                                                                        )
                                                                    }
                                                                </td>
                                                            )
                                                        })}
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {!isMobile && <TablePagination table={table} />}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default Table

const ArrowToggle = ({ header, children }) => {
    const position = header.column.getIsSorted()
    const meta = header.column.columnDef?.meta || {}
    const leading = typeof meta.headerLeading === 'number' ? meta.headerLeading : 0
    const align = meta.headerAlign === 'end' ? 'end' : 'start'
    return (
        <div
            className='table-head'
            style={{
                cursor: header.column.getCanSort() ? "pointer" : "default",
                justifyContent: align === 'end' ? 'flex-end' : 'flex-start',
                gap: 8,
            }}
            onClick={header.column.getCanSort() ? header.column.getToggleSortingHandler() : undefined}
        >
            <span className="d-inline-flex align-items-center" style={{ minWidth: 0, paddingLeft: leading || undefined }}>
                <span style={{ minWidth: 0 }}>{children}</span>
            </span>
            {align !== 'end' ? (
                <>
                    {{
                        asc: <FaSortUp size={13} opacity={position === "asc" ? 1 : .125} />,
                        desc: <FaSortDown size={13} opacity={position === "desc" ? 1 : .125} />
                    }[position]}
                    {header.column.getCanSort() && !position ? (
                        <FaSort size={13} opacity={.125} />
                    ) : null}
                </>
            ) : null}
        </div>
    )
}
