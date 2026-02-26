import React, { useContext } from 'react'
import { FiAlignLeft, FiSave } from 'react-icons/fi'
import { SidebarContext } from '../../../contentApi/sideBarToggleProvider'
import topTost from '@/utils/topTost'

const PageHeaderSetting = ({
    scope,
    showActions = true,
    showDemoReset = false,
    demoLabel = 'Demo Mode',
    resetLabel = 'Reset',
    onDemo,
    onReset,
    onCancel,
    onSave,
}) => {
    const { sidebarOpen, setSidebarOpen } = useContext(SidebarContext)
    const dispatchOrRun = (handler, type) => {
        if (typeof handler === 'function') {
            handler()
            return
        }
        if (scope) {
            window.dispatchEvent(new CustomEvent(`cs:settings:${scope}:${type}`))
            return
        }
        topTost()
    }
    return (
        <div className="content-area-header bg-white sticky-top">
            <div className="page-header-left">
                <a href="#" className="app-sidebar-open-trigger me-2" onClick={() => setSidebarOpen(true)}>
                    <FiAlignLeft className='fs-24' />
                </a>
            </div>
            {showActions ? (
                <div className="page-header-right ms-auto">
                    <div className="d-flex align-items-center gap-3 page-header-right-items-wrapper">
                        {showDemoReset ? (
                            <>
                                <button
                                    type="button"
                                    className="btn btn-light-success"
                                    onClick={() => dispatchOrRun(onDemo, 'demo')}
                                >
                                    {demoLabel}
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-light-danger"
                                    onClick={() => dispatchOrRun(onReset, 'reset')}
                                >
                                    {resetLabel}
                                </button>
                            </>
                        ) : null}
                        <button
                            type="button"
                            className="text-danger bg-transparent border-0 p-0"
                            onClick={() => dispatchOrRun(onCancel, 'cancel')}
                        >
                            Cancel
                        </button>
                        <button type="button" className="btn btn-primary" onClick={() => dispatchOrRun(onSave, 'save')}>
                            <FiSave size={16} className='me-2' />
                            <span>Save Changes</span>
                        </button>
                    </div>
                </div>
            ) : null}
        </div>

    )
}

export default PageHeaderSetting
