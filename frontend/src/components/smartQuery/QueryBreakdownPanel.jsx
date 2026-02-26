import React, { useState } from 'react'
import { FiCode, FiChevronDown, FiChevronUp } from 'react-icons/fi'

const QueryBreakdownPanel = ({ sqlUsed, durationMs, rowsReturned, cached }) => {
  const [open, setOpen] = useState(false)
  if (!sqlUsed) return null

  return (
    <div className="mt-2">
      <button
        type="button"
        className="d-flex align-items-center gap-1 border-0 bg-transparent p-0"
        style={{ fontSize: '0.76rem', color: 'var(--bs-secondary-color)' }}
        onClick={() => setOpen(v => !v)}
      >
        <FiCode size={12} />
        <span className="fw-semibold">Query breakdown</span>
        {open ? <FiChevronUp size={11} /> : <FiChevronDown size={11} />}
      </button>
      {open && (
        <div className="mt-2 sq-panel overflow-hidden">
          <div className="sq-panel-head d-flex gap-4">
            <span>Time: <strong>{durationMs}ms</strong></span>
            <span>Rows: <strong>{rowsReturned}</strong></span>
            {cached && <span style={{ color: 'var(--bs-info)', fontWeight: 600 }}>cache hit</span>}
          </div>
          <pre
            className="p-3 mb-0 sq-code overflow-auto"
            style={{ fontFamily: 'monospace', fontSize: '0.72rem', maxHeight: 200, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
          >
            {sqlUsed}
          </pre>
        </div>
      )}
    </div>
  )
}

export default QueryBreakdownPanel
