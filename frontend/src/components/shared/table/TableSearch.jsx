import React from 'react'
import { FiSearch, FiX } from 'react-icons/fi'
import { SelectDropdown } from '@/components/shared/Dropdown'

const TableSearch = ({table, setGlobalFilter, globalFilter, isMobile = false}) => {
    return (
        <div className='row gy-2'>
            <style>{`
                .cs-table-search .input-group-text { background: transparent; border-color: var(--bs-border-color); }
                .cs-table-search .form-control { border-color: var(--bs-border-color); }
                .cs-table-search .form-control:focus { box-shadow: 0 0 0 .2rem rgba(13,110,253,0.18); }
                .cs-table-search .cs-search-input { padding-right: 38px; }
                .cs-table-search .cs-clear-btn {
                    position: absolute;
                    top: 50%;
                    right: 10px;
                    transform: translateY(-50%);
                    border: 0;
                    background: transparent;
                    color: var(--bs-danger);
                    padding: 0;
                    line-height: 0;
                    z-index: 3;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    width: 26px;
                    height: 26px;
                    border-radius: 999px;
                    opacity: 0.9;
                }
                .cs-table-search .cs-clear-btn svg { display: block; color: currentColor; stroke: currentColor; fill: currentColor; }
                .cs-table-search .cs-clear-btn:hover { color: var(--bs-danger); opacity: 1; background: rgba(var(--bs-danger-rgb), 0.10); }
                .cs-table-search .cs-clear-btn:focus { outline: none; box-shadow: none; }
                html.app-skin-dark .cs-table-search .input-group-text,
                html.app-skin-dark .cs-table-search .form-control {
                    background: rgba(255,255,255,0.06);
                    border-color: rgba(255,255,255,0.10);
                    color: rgba(255,255,255,0.90);
                }
                html.app-skin-dark .cs-table-search .form-control::placeholder { color: rgba(255,255,255,0.55); }
                html.app-skin-dark .cs-table-search .input-group-text svg { color: rgba(255,255,255,0.70); }
                html.app-skin-dark .cs-table-search .cs-clear-btn,
                html.app-skin-dark .cs-table-search .cs-clear-btn svg {
                    color: var(--bs-danger) !important;
                }
                html.app-skin-dark .cs-table-search .cs-clear-btn svg {
                    stroke: var(--bs-danger) !important;
                    fill: var(--bs-danger) !important;
                }
            `}</style>
            {!isMobile && <div className='col-sm-12 col-md-6 ps-0 m-0 pb-10'>
                <div className='dataTables_length d-flex justify-content-md-start justify-content-center'>
                    <label className='d-flex align-items-center gap-2 fs-13 text-muted fw-semibold'>
                        Rows per page
                        <SelectDropdown
                            value={table.getState().pagination.pageSize}
                            options={[10, 20, 30, 40, 50].map(pageSize => ({ value: String(pageSize), label: String(pageSize) }))}
                            onChange={(v) => table.setPageSize(Number(v))}
                            fullWidth={false}
                            align="center"
                            centerLabel={true}
                            centerItems={true}
                            showCaret={false}
                            direction="up"
                            buttonClassName="form-select-sm pe-4"
                            buttonStyle={{ height: 40, fontSize: '0.875rem', minWidth: 84 }}
                            enableScroll={false}
                            menuMatchTriggerWidth={true}
                            itemClassName="text-center py-2"
                        />
                    </label>
                </div>
            </div>}
            <div className={`col-sm-12 ${isMobile ? '' : 'col-md-6'} ps-0 m-0 pb-10`}>
                <div className='dataTables_filter d-flex justify-content-md-end justify-content-center'>
                    <div className="input-group input-group-sm cs-table-search" style={{ maxWidth: 360 }}>
                        <span className="input-group-text" style={{ height: 40 }}>
                            <FiSearch size={14} />
                        </span>
                        <div className="position-relative flex-grow-1">
                            <input
                                type="text"
                                value={globalFilter ?? ""}
                                onChange={(e) => setGlobalFilter(e.target.value)}
                                placeholder='Search...'
                                className="form-control cs-search-input"
                                style={{ height: 40, fontSize: '0.875rem' }}
                            />
                            {!!String(globalFilter || '').trim() && (
                                <button
                                    type="button"
                                    className="cs-clear-btn"
                                    onClick={() => setGlobalFilter('')}
                                    aria-label="Clear search"
                                >
                                    <FiX size={16} />
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default TableSearch
