import React, { useEffect, useRef, useState } from 'react'
import { FiFilter, FiPlus, FiDownload } from 'react-icons/fi'
import Checkbox from '@/components/shared/Checkbox';
import { Link } from 'react-router-dom';
import DateRange from '../DateRange';

const filterItems = ["Role", "Team", "Email", "Member", "Recommendation"]


const PageHeaderDate = ({ range, onApplyRange, onExport, exporting, exportDisabled, exportDisabledTitle, liveMode, onLiveSelect, showLiveDot = true, liveDotPulse = true, liveDisplayVariant = 'text', hidePrefixWhenLive = false }) => {
  const [toggleDateRange, setToggleDateRange] = useState(false)
  const pickerRef = useRef(null)

  useEffect(() => {
    if (!toggleDateRange) return
    const onDown = (e) => {
      if (!pickerRef.current) return
      if (!pickerRef.current.contains(e.target)) setToggleDateRange(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [toggleDateRange])

  return (
    <>
      <div className="d-flex align-items-center gap-2 page-header-right-items-wrapper">
        <div
          className="position-relative date-picker-field"
          style={{ width: 'auto', flex: '0 0 auto' }}
          onClick={() => setToggleDateRange(!toggleDateRange)}
          ref={pickerRef}
        >
          <DateRange
            toggleDateRange={toggleDateRange}
            setToggleDateRange={setToggleDateRange}
            range={range}
            onApply={onApplyRange}
            prefix={<FiFilter size={14} />}
            liveMode={liveMode}
            onLiveSelect={onLiveSelect}
            showLiveDot={showLiveDot}
            liveDotPulse={liveDotPulse}
            liveDisplayVariant={liveDisplayVariant}
            hidePrefixWhenLive={hidePrefixWhenLive}
          />
        </div>
        <button
          type="button"
          className={`btn btn-primary d-inline-flex align-items-center gap-2${exportDisabled ? ' opacity-50 pe-none' : ''}`}
          onClick={exportDisabled ? undefined : onExport}
          disabled={!!exporting || !!exportDisabled}
          title={exportDisabled ? exportDisabledTitle : undefined}
          style={exportDisabled ? { pointerEvents: 'none' } : undefined}
        >
          {exporting
            ? <><div className="spinner-border spinner-border-sm" style={{ width: 14, height: 14 }} /> Generating…</>
            : <><FiDownload size={16} strokeWidth={1.8} /> Export Report</>
          }
        </button>
      </div>
    </>
  )
}

export default PageHeaderDate
