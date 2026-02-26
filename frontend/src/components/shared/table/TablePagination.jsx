import React from 'react'
import { BsArrowLeft, BsArrowRight, BsDot } from 'react-icons/bs'

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

const TablePagination = ({ table }) => {
    const pageInfo = table.getState().pagination
    const totalRows = table.getFilteredRowModel().rows.length
    const startRow = totalRows === 0 ? 0 : pageInfo.pageIndex * pageInfo.pageSize + 1
    const endRow = totalRows === 0 ? 0 : Math.min(totalRows, (pageInfo.pageIndex + 1) * pageInfo.pageSize)
    const canPrev = table.getCanPreviousPage()
    const canNext = table.getCanNextPage()
    const pageCount = table.getPageCount()
    const currentPage = Math.min(pageInfo.pageIndex + 1, Math.max(1, pageCount))
    const pagerItems = getPagerItems(pageCount, currentPage)

    return (
        <div className="row gy-2">
            <div className="col-sm-12 col-md-5 p-0">
                <div className="dataTables_info text-lg-start text-center fs-14 fw-semibold text-muted" role="status" aria-live="polite" style={{ paddingTop: 2 }}>
                    Showing {endRow} of {totalRows} entries
                </div>
            </div>
            <div className="col-sm-12 col-md-7 p-0">
                <div className="dataTables_paginate paging_simple_numbers">
                    <ul className="list-unstyled d-flex align-items-center gap-2 mb-0 pagination-common-style justify-content-md-end justify-content-center">
                        <li className={!canPrev ? 'opacity-50 pe-none' : ''}>
                            <a
                                href="#"
                                onClick={(e) => {
                                    e.preventDefault()
                                    if (canPrev) table.previousPage()
                                }}
                                aria-label="Previous page"
                            >
                                <BsArrowLeft size={16} />
                            </a>
                        </li>
                        {pagerItems.map((item, idx) => (
                            item === 'dots'
                                ? (
                                    <li key={`dots-${idx}`}>
                                        <a href="#" onClick={(e) => e.preventDefault()} aria-hidden="true">
                                            <BsDot size={16} />
                                        </a>
                                    </li>
                                )
                                : (
                                    <li key={`p-${item}`}>
                                        <a
                                            href="#"
                                            className={item === currentPage ? 'active' : ''}
                                            onClick={(e) => {
                                                e.preventDefault()
                                                table.setPageIndex(Number(item) - 1)
                                            }}
                                            aria-current={item === currentPage ? 'page' : undefined}
                                        >
                                            {item}
                                        </a>
                                    </li>
                                )
                        ))}
                        <li className={!canNext ? 'opacity-50 pe-none' : ''}>
                            <a
                                href="#"
                                onClick={(e) => {
                                    e.preventDefault()
                                    if (canNext) table.nextPage()
                                }}
                                aria-label="Next page"
                            >
                                <BsArrowRight size={16} />
                            </a>
                        </li>
                    </ul>
                </div>
            </div>
        </div>
    )
}

export default TablePagination
