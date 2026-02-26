import SelectDropdown from '@/components/shared/SelectDropdown';
import React, { useEffect, useRef, useState } from 'react'
import { FiSearch, FiX } from 'react-icons/fi';

const ALL_CATEGORIES = { "label": "All Categories", "value": "all", "icon": "feather-grid" }

const options = [
    ALL_CATEGORIES,
    { "label": "Getting Started", "value": "Getting Started", "icon": "feather-airplay" },
    { "label": "Camera", "value": "Camera Management", "icon": "feather-camera" },
    { "label": "Project", "value": "Project Management", "icon": "feather-briefcase" },
    { "label": "Live Monitoring", "value": "Live Monitoring", "icon": "feather-map-pin" },
    { "label": "Team & Roles", "value": "Team & Roles", "icon": "feather-users" },
    { "label": "Troubleshooting", "value": "Troubleshooting", "icon": "feather-help-circle" },
]

const HelpBanner = () => {
    const [selectedOption, setSelectedOption] = useState(ALL_CATEGORIES);
    const [query, setQuery] = useState('');
    const inputRef = useRef(null)

    useEffect(() => {
        const handler = () => {
            setQuery('')
            setSelectedOption(ALL_CATEGORIES)
        }
        window.addEventListener('cs:help-search-clear', handler)
        return () => window.removeEventListener('cs:help-search-clear', handler)
    }, [])

    const handleSearch = (e) => {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('cs:help-search', {
            detail: { query: query.trim(), category: selectedOption?.value || 'all' }
        }))
    }

    const handleClear = () => {
        setQuery('')
        window.dispatchEvent(new CustomEvent('cs:help-search', { detail: { query: '', category: selectedOption?.value || 'all' } }))
        inputRef.current?.focus?.()
    }

    return (
        <div className="row g-0 align-items-center border-bottom help-center-content-header">
            <div className="col-lg-8 offset-lg-2 text-center">
                <h2 className="fw-bolder mb-2 text-dark">ConstructionSight AI Help Center</h2>
                <p className="text-muted">Find answers about camera management, projects, and site monitoring.</p>
                <form onSubmit={handleSearch} className="my-4 d-none d-sm-block search-form">
                    <style>{`
                        .cs-help-search-wrap { position: relative; flex: 1 1 auto; min-width: 0; }
                        .cs-help-search-wrap .form-control { padding-right: 40px; }
                        .help-center-content-header .select-dropdown.select-wd-md { width: 260px; min-width: 260px; flex: 0 0 auto; }
                        .help-center-content-header .select-dropdown.select-wd-md .select-box { width: 100%; }
                        .help-center-content-header .select-dropdown.select-wd-md .dropdown-list { width: 260px; min-width: 260px; }
                        .help-center-content-header .select-dropdown.select-wd-md .dropdown-list ul li { padding-left: 17px; padding-right: 17px; }
                        .cs-help-clear-btn {
                            position: absolute;
                            right: 10px;
                            top: 50%;
                            transform: translateY(-50%);
                            border: 0;
                            background: transparent;
                            padding: 0;
                            display: inline-flex;
                            align-items: center;
                            justify-content: center;
                            width: 26px;
                            height: 26px;
                            border-radius: 999px;
                            color: var(--bs-danger);
                            opacity: 0.9;
                        }
                        .cs-help-clear-btn:hover { opacity: 1; background: rgba(var(--bs-danger-rgb), 0.10); }
                        .cs-help-clear-btn:focus { outline: none; box-shadow: none; }
                        .cs-help-clear-btn svg { color: var(--bs-danger) !important; stroke: var(--bs-danger) !important; fill: var(--bs-danger) !important; }
                        html.app-skin-dark .cs-help-clear-btn svg { color: var(--bs-danger) !important; stroke: var(--bs-danger) !important; fill: var(--bs-danger) !important; }
                    `}</style>
                    <div className="input-group" style={{ height: '44px' }}>
                        <div style={{ display: 'flex', alignItems: 'stretch' }}>
                            <SelectDropdown
                                options={options}
                                selectedOption={selectedOption}
                                defaultSelect="all"
                                onSelectOption={(option) => setSelectedOption(option)}
                                className={"select-wd-md"}
                                hideSearch={true}
                                staticArrow={true}
                            />
                        </div>
                        <div className="cs-help-search-wrap">
                            <input
                                type="text"
                                className="form-control flex-grow-1"
                                style={{ height: '44px' }}
                                placeholder="Search articles and guides..."
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                ref={inputRef}
                            />
                            {query.trim().length > 0 ? (
                                <button type="button" className="cs-help-clear-btn" onClick={handleClear} title="Clear">
                                    <FiX size={16} />
                                </button>
                            ) : null}
                        </div>
                        <button type="submit" className="btn btn-primary" style={{ height: '44px' }}>
                            <FiSearch size={16} />
                            <span className="ms-2">Search</span>
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}

export default HelpBanner
