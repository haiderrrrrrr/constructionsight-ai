import React, { useEffect, useRef, useState } from 'react'
import { addDays, endOfMonth, format, isSameDay, startOfMonth } from "date-fns";
import 'react-date-range/dist/styles.css'; // main style file
import 'react-date-range/dist/theme/default.css'; // theme css file
import { DateRangePicker, DefinedRange } from 'react-date-range';

const DateRange = ({ toggleDateRange, setToggleDateRange, range, onApply, prefix, liveMode, onLiveSelect, showLiveDot = true, liveDotPulse = true, liveDisplayVariant = 'text', hidePrefixWhenLive = false }) => {
    const appliedRef = useRef({ startDate: range?.startDate, endDate: range?.endDate })
    const customSelectRef = useRef(false)
    const liveSelectRef   = useRef(false)
    const [state, setState] = useState(() => ([
        {
            startDate: range?.startDate || startOfMonth(new Date()),
            endDate: range?.endDate || endOfMonth(new Date()),
            key: "selection",
        },
    ]));
    const [showDatePicker, setShowDatePicker] = useState(false);

    const liveRange = onLiveSelect ? [{
        label: 'Live',
        range: () => {
            liveSelectRef.current = true
            onLiveSelect()
            setToggleDateRange(false)
            setShowDatePicker(false)
            return { startDate: new Date(), endDate: new Date() }
        },
        isSelected: () => !!liveMode,
    }] : []

    const predefinedRanges = [
        ...liveRange,
        {
            label: 'Today',
            range: () => ({
                startDate: new Date(),
                endDate: new Date(),
            }),
            isSelected: (range) => !liveMode && isSameDay(range.startDate, new Date()) && isSameDay(range.endDate, new Date())
        },
        {
            label: 'Yesterday',
            range: () => ({
                startDate: addDays(new Date(), -1),
                endDate: addDays(new Date(), -1),
            }),
            isSelected: (range) => isSameDay(range.startDate, addDays(new Date(), -1)) && isSameDay(range.endDate, addDays(new Date(), -1))
        },
        {
            label: 'Last 7 Days',
            range: () => ({
                startDate: addDays(new Date(), -7),
                endDate: new Date(),
            }),
            isSelected: (range) => isSameDay(range.startDate, addDays(new Date(), -7)) && isSameDay(range.endDate, new Date())
        },
        {
            label: 'Last 30 Days',
            range: () => ({
                startDate: addDays(new Date(), -30),
                endDate: new Date(),
            }),
            isSelected: (range) => isSameDay(range.startDate, addDays(new Date(), -30)) && isSameDay(range.endDate, new Date())
        },
        {
            label: 'Custom Range',
            range: () => {
                customSelectRef.current = true
                setShowDatePicker(true);
                return {
                    startDate: state[0].startDate,
                    endDate: state[0].endDate,
                };
            },
            isSelected: () => showDatePicker
        },
    ]

    useEffect(() => {
        document.querySelectorAll(".rdrMonthName")[0]?.classList?.add("rdrMonthNameFirst")
        document.querySelectorAll(".rdrMonthName")[1]?.classList?.add("rdrMonthNameSecond")
    }, [showDatePicker, toggleDateRange])

    useEffect(() => {
        if (toggleDateRange) {
            setShowDatePicker(false)
            const startDate = appliedRef.current.startDate || range?.startDate
            const endDate = appliedRef.current.endDate || range?.endDate
            if (startDate && endDate) {
                setState([{ startDate, endDate, key: "selection" }])
            }
        }
    }, [toggleDateRange])

    useEffect(() => {
        if (!range?.startDate || !range?.endDate) return
        appliedRef.current = { startDate: range.startDate, endDate: range.endDate }
        setState([
            {
                startDate: range.startDate,
                endDate: range.endDate,
                key: "selection",
            },
        ])
    }, [range?.startDate, range?.endDate])

    const handlePropagation = (event) => {
        event.stopPropagation();
    };

    const apply = () => {
        setToggleDateRange(false)
        setShowDatePicker(false)
        if (onApply) onApply({ startDate: state[0].startDate, endDate: state[0].endDate })
    }

    const cancel = () => {
        const startDate = appliedRef.current.startDate || range?.startDate
        const endDate = appliedRef.current.endDate || range?.endDate
        if (startDate && endDate) {
            setState([{ startDate, endDate, key: "selection" }])
        }
        setShowDatePicker(false)
        setToggleDateRange(false)
    }

    return (
        <>
            <style>{`@keyframes ppe-live-pulse{0%{box-shadow:0 0 0 0 rgba(40,167,69,0.6)}70%{box-shadow:0 0 0 5px rgba(40,167,69,0)}100%{box-shadow:0 0 0 0 rgba(40,167,69,0)}}`}</style>
            <span className="d-inline-flex align-items-center gap-2">
                {!(liveMode && hidePrefixWhenLive) && prefix}
                <span>
                    {liveMode ? (
                        liveDisplayVariant === 'pill'
                            ? (
                                <span
                                    className="badge bg-success d-inline-flex align-items-center"
                                    style={{ padding: '5px 10px', fontSize: 12, fontWeight: 700, letterSpacing: '0.08em' }}
                                >
                                    LIVE
                                </span>
                            )
                            : (
                                <span className="d-inline-flex align-items-center gap-1 fw-semibold">
                                    {showLiveDot && (
                                        <span style={{
                                            display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
                                            background: '#28a745', flexShrink: 0,
                                            animation: liveDotPulse ? 'ppe-live-pulse 1.4s ease-in-out infinite' : 'none',
                                        }} />
                                    )}
                                    Live
                                </span>
                            )
                    ) : `${format(state[0].startDate, "MMM dd,yy")} - ${format(state[0].endDate, "MMM dd,yy")}`}
                </span>
            </span>
            {
                toggleDateRange &&

                <div onClick={handlePropagation} className='bg-white date-range-labels' >
                    <DefinedRange
                        ranges={state}
                        onChange={item => {
                            if (liveSelectRef.current) { liveSelectRef.current = false; return }
                            setState([item.selection]);
                            if (customSelectRef.current) {
                                customSelectRef.current = false
                                setShowDatePicker(true)
                                return
                            }
                            setShowDatePicker(false)
                            setToggleDateRange(false)
                            if (onApply) onApply({ startDate: item.selection.startDate, endDate: item.selection.endDate })
                          }}
                        staticRanges={predefinedRanges}
                        inputRanges={[]}
                        className='range-dropdown'
                    />
                    {
                        showDatePicker && (
                            <div className='date-dropdown'>
                                <DateRangePicker
                                    onChange={item => {
                                        setState([item.selection]);
                                        // setShowDatePicker(false);
                                    }}
                                    showSelectionPreview={true}
                                    moveRangeOnFirstSelection={false}
                                    months={2}
                                    ranges={state}
                                    direction="horizontal"
                                    weekdayDisplayFormat='EEEEEE'
                                    showMonthAndYearPickers={false}
                                    staticRanges={predefinedRanges}
                                />
                                <div className='action-btns'>
                                    <span>{`${format(state[0].startDate, "MM/dd/yy")} - ${format(state[0].endDate, "MM/dd/yy")}`}</span>
                                    <button onClick={cancel} className='applyBtn btn btn-sm btn-danger'>Cancel</button>
                                    <button onClick={apply} className='applyBtn btn btn-sm btn-primary'>Apply</button>
                                </div>
                            </div>
                        )
                    }
                </div>
            }
        </>
    )
}

export default DateRange
