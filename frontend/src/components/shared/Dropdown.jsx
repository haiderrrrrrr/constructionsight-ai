import { cloneElement, useId, useMemo, useRef, useState } from 'react'

import { Link } from 'react-router-dom';
import Checkbox from './Checkbox';
import { FiMoreVertical } from 'react-icons/fi';

export const SelectDropdown = ({
    value,
    options = [],
    onChange,
    placeholder = "Select",
    disabled = false,
    invalid = false,
    leftAddon,
    enableSearch = false,
    searchPlaceholder = "Search…",
    noResultsText = "No results found",
    menuPosition = "start",
    fullWidth = true,
    menuMatchTriggerWidth = true,
    align = "start",
    centerLabel = false,
    centerItems = false,
    showCaret = true,
    direction = "down",
    dropdownDisplay = "dynamic",
    closeOnSelect = true,
    enableScroll = true,
    itemClassName = "",
    itemStyle,
    buttonClassName = "",
    menuClassName = "",
    buttonStyle,
    menuStyle,
    maxMenuHeight = 280,
    id,
}) => {
    const autoId = useId()
    const menuId = id || `select-dropdown-${autoId}`
    const buttonRef = useRef(null)
    const [query, setQuery] = useState('')
    const isDark = !!document?.documentElement?.classList?.contains?.('app-skin-dark')

    const selectedLabel = useMemo(() => {
        const v = value === undefined || value === null ? "" : String(value)
        const found = options.find(o => String(o?.value ?? "") === v)
        return found?.label ?? ""
    }, [options, value])

    const displayLabel = selectedLabel || placeholder
    const filteredOptions = useMemo(() => {
        if (!enableSearch) return options
        const q = String(query || '').trim().toLowerCase()
        if (!q) return options
        return options.filter(o => String(o?.label ?? o?.value ?? '').toLowerCase().includes(q))
    }, [enableSearch, options, query])

    const Wrapper = leftAddon ? 'div' : 'div'
    const widthClass = fullWidth ? 'w-100' : ''
    const rootDropdownClass = direction === "up" ? "dropdown dropup" : "dropdown"
    const displayClass = fullWidth ? '' : (leftAddon ? 'd-inline-flex' : 'd-inline-block')
    const wrapperClassName = leftAddon
        ? `${rootDropdownClass} input-group ${widthClass} ${displayClass}`.trim()
        : `${rootDropdownClass} ${widthClass} ${displayClass}`.trim()

    const alignClass = align === "center" ? "text-center" : align === "end" ? "text-end" : "text-start"
    const caretStyle = showCaret
        ? null
        : {
            backgroundImage: "none",
            paddingRight: "0.75rem",
        }
    const mergedButtonStyle = {
        ...(centerLabel ? { position: "relative" } : null),
        ...(caretStyle || {}),
        ...(buttonStyle || {}),
    }

    const hideDropdown = () => {
        const el = buttonRef.current
        if (!el) return
        try {
            const bsDropdown = window?.bootstrap?.Dropdown
            if (bsDropdown?.getOrCreateInstance) {
                bsDropdown.getOrCreateInstance(el).hide()
                return
            }
        } catch { }
        try {
            el.click()
        } catch { }
    }

    return (
        <Wrapper className={wrapperClassName}>
            {leftAddon ? <div className="input-group-text">{leftAddon}</div> : null}
            <button
                type="button"
                ref={buttonRef}
                className={`form-select ${alignClass}${invalid ? " is-invalid" : ""} ${buttonClassName}`}
                data-bs-toggle="dropdown"
                data-bs-auto-close={enableSearch ? "outside" : "true"}
                data-bs-display={dropdownDisplay === "static" ? "static" : undefined}
                aria-expanded="false"
                aria-controls={menuId}
                disabled={disabled}
                style={mergedButtonStyle}
            >
                {centerLabel ? (
                    <span
                        className={`d-block text-truncate${selectedLabel ? "" : " text-muted"}`}
                        style={{
                            position: "absolute",
                            left: "50%",
                            top: "50%",
                            transform: "translate(-50%, -50%)",
                            maxWidth: "calc(100% - 2.5rem)",
                            pointerEvents: "none",
                        }}
                    >
                        {displayLabel}
                    </span>
                ) : (
                    <span className={`d-block text-truncate${selectedLabel ? "" : " text-muted"}`}>{displayLabel}</span>
                )}
            </button>
            <ul
                id={menuId}
                className={`dropdown-menu ${menuPosition === "end" ? "dropdown-menu-end" : ""} ${menuClassName}`}
                style={{
                    width: "100%",
                    minWidth: menuMatchTriggerWidth ? "100%" : undefined,
                    ...(enableSearch ? { paddingTop: 0, paddingBottom: 0 } : null),
                    ...(enableScroll
                        ? { maxHeight: maxMenuHeight, overflowY: "auto" }
                        : { maxHeight: undefined, overflowY: "visible" }),
                    ...(menuStyle || {}),
                }}
            >
                <style>{`
                    .cs-select-search {
                        background-color: var(--bs-body-bg) !important;
                        border-color: var(--bs-border-color) !important;
                        color: var(--bs-body-color) !important;
                        box-shadow: none !important;
                    }
                    .cs-select-search::placeholder {
                        color: rgba(100, 116, 139, 0.9) !important;
                    }
                    html.app-skin-dark .cs-select-search {
                        background-color: #0e1729 !important;
                        border-color: rgba(255,255,255,0.14) !important;
                        color: rgba(255,255,255,0.86) !important;
                    }
                    html.app-skin-dark .cs-select-search::placeholder {
                        color: rgba(255,255,255,0.56) !important;
                    }
                `}</style>
                {enableSearch ? (
                    <li
                        className="px-2 py-2"
                        style={{
                            position: 'sticky',
                            top: 0,
                            zIndex: 2,
                            background: isDark ? '#0e1729' : 'var(--bs-dropdown-bg, var(--bs-body-bg))',
                            borderBottom: '1px solid var(--bs-dropdown-border-color, var(--bs-border-color))',
                            borderTopLeftRadius:  'inherit',
                            borderTopRightRadius: 'inherit',
                        }}
                    >
                        <input
                            type="text"
                            className="form-control form-control-sm cs-select-search"
                            placeholder={searchPlaceholder}
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                            onKeyUp={(e) => e.stopPropagation()}
                            onKeyPress={(e) => e.stopPropagation()}
                            style={{
                                caretColor: isDark ? 'rgba(255,255,255,0.86)' : 'var(--bs-body-color)',
                                cursor: 'text',
                                boxShadow: 'none',
                            }}
                        />
                    </li>
                ) : null}

                {filteredOptions.length === 0 ? (
                    <li>
                        <div
                            className="text-muted text-center py-2"
                            style={{ cursor: 'default', userSelect: 'none', pointerEvents: 'none', fontSize: 12 }}
                        >
                            {noResultsText}
                        </div>
                    </li>
                ) : filteredOptions.map((opt) => {
                    const v = String(opt?.value ?? "")
                    const isActive = String(value ?? "") === v
                    return (
                        <li key={v}>
                            <button
                                type="button"
                                className={`dropdown-item${isActive ? " active" : ""} ${itemClassName}`}
                                onClick={() => {
                                    setQuery('')
                                    onChange?.(v, opt)
                                    if (closeOnSelect) hideDropdown()
                                }}
                                style={itemStyle}
                            >
                                {centerItems ? (
                                    <span className="d-flex justify-content-center w-100">
                                        {opt?.label ?? v}
                                    </span>
                                ) : (
                                    opt?.label ?? v
                                )}
                            </button>
                        </li>
                    )
                })}
            </ul>
        </Wrapper>
    )
}

const Dropdown = ({
    triggerPosition,
    triggerClass = "avatar-sm",
    triggerIcon,
    triggerText,
    dropdownItems = [],
    dropdownPosition = "dropdown-menu-end",
    dropdownAutoClose,
    dropdownParentStyle,
    dataBsToggle = "modal",
    tooltipTitle,
    dropdownMenuStyle,
    iconStrokeWidth = 1.7,
    isItemIcon = true,
    isAvatar = true,
    onClick,
    active,
    id
}) => {

    return (
        <>
            <div className={`filter-dropdown ${dropdownParentStyle}`}>
                {/* Dropdown Trigger */}
                {
                    tooltipTitle ?
                        <span className="d-flex c-pounter" data-bs-toggle="dropdown" data-bs-offset={triggerPosition} data-bs-auto-close={dropdownAutoClose}>
                            {
                                isAvatar ?
                                    <div className={`avatar-text ${triggerClass}`} data-bs-toggle="tooltip" data-bs-trigger="hover" title={tooltipTitle} >
                                        {triggerIcon || <FiMoreVertical />} {triggerText}
                                    </div>
                                    :
                                    <div className={`${triggerClass}`} data-bs-toggle="tooltip" data-bs-trigger="hover" title={tooltipTitle}>
                                        {triggerIcon || <FiMoreVertical />} {triggerText}
                                    </div>
                            }
                        </span>
                        :
                        isAvatar ?
                            <Link to="#" className={`avatar-text ${triggerClass}`} data-bs-toggle="dropdown" data-bs-offset={triggerPosition} data-bs-auto-close={dropdownAutoClose} >
                                {triggerIcon || <FiMoreVertical />} {triggerText}
                            </Link>
                            :
                            <Link to="#" className={`${triggerClass}`} data-bs-toggle="dropdown" data-bs-offset={triggerPosition} data-bs-auto-close={dropdownAutoClose} >
                                {triggerIcon || <FiMoreVertical />} {triggerText}
                            </Link>
                }


                {/* Dropdown Menu */}
                <ul className={`dropdown-menu ${dropdownMenuStyle} ${dropdownPosition}`}>
                    {dropdownItems.map((item, index) => {
                        if (item.type === "divider") {
                            return <li className="dropdown-divider" key={index}></li>;
                        }
                        return (
                            <li key={index} className={`${item.checkbox ? "dropdown-item" : ""}`}>
                                {
                                    item.checkbox ?
                                        <Checkbox checked={item.checked} id={item.id} name={item.label} className={""} />
                                        :
                                        item.link ? (
                                            <Link
                                                to={item.link}
                                                target={item.target}
                                                className={`${active === item.label ? "active" : ""} dropdown-item`}
                                                data-bs-toggle={dataBsToggle}
                                                data-bs-target={item.modalTarget}
                                                onClick={() => onClick?.(item.label, id)}
                                            >
                                                {
                                                    isItemIcon ?
                                                        item.icon && cloneElement(item.icon, { className: "me-3", size: 16, strokeWidth: iconStrokeWidth })
                                                        :
                                                        <span className={`wd-7 ht-7 rounded-circle me-3 ${item.color}`}></span>
                                                }
                                                <span>{item.label}</span>
                                            </Link>
                                        ) : (
                                            <button
                                                type="button"
                                                className={`${active === item.label ? "active" : ""} dropdown-item`}
                                                data-bs-toggle={dataBsToggle}
                                                data-bs-target={item.modalTarget}
                                                onClick={() => onClick?.(item.label, id)}
                                            >
                                                {
                                                    isItemIcon ?
                                                        item.icon && cloneElement(item.icon, { className: "me-3", size: 16, strokeWidth: iconStrokeWidth })
                                                        :
                                                        <span className={`wd-7 ht-7 rounded-circle me-3 ${item.color}`}></span>
                                                }
                                                <span>{item.label}</span>
                                            </button>
                                        )
                                }
                            </li>
                        );
                    })}
                </ul>
            </div>
        </>
    )
}

export default Dropdown
