import React, { useState } from 'react'
import { FiChevronDown, FiChevronUp } from 'react-icons/fi'

const EvidencePanel = ({ evidence = [] }) => {
  const [open, setOpen] = useState(false)
  if (!evidence.length) return null

  return (
    <div className="mt-3">
      <div className="sq-panel">
        <button
          type="button"
          className="sq-panel-head w-100 d-flex align-items-center justify-content-between border-0"
          onClick={() => setOpen(v => !v)}
        >
          <span>Evidence ({evidence.length} data point{evidence.length !== 1 ? 's' : ''})</span>
          {open ? <FiChevronUp size={13} /> : <FiChevronDown size={13} />}
        </button>
        {open ? (
          <div className="p-0">
            <table className="table table-sm mb-0" style={{ fontSize: '0.8rem' }}>
              <tbody>
                {evidence.map((item, i) => (
                  <tr key={i}>
                    <td className="text-muted fw-semibold" style={{ width: '45%' }}>{item.label}</td>
                    <td className="fw-medium">{item.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default EvidencePanel
