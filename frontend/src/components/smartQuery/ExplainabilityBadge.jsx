import React from 'react'

const CONFIDENCE_COLORS = {
  HIGH: 'success',
  MEDIUM: 'warning',
  LOW: 'danger',
}

const ExplainabilityBadge = ({ confidence, rowsReturned, durationMs, cached }) => {
  const color = CONFIDENCE_COLORS[confidence] || 'secondary'
  return (
    <div className="d-flex align-items-center gap-2 flex-wrap mt-2 mb-1">
      <span className={`badge badge-soft-${color} fs-10 fw-semibold px-2 py-1`}>
        Confidence: {confidence}
      </span>
      <span className="badge badge-soft-secondary fs-10 px-2 py-1">
        Based on: {rowsReturned} row{rowsReturned !== 1 ? 's' : ''}
      </span>
      <span className="badge badge-soft-secondary fs-10 px-2 py-1">
        {durationMs}ms
      </span>
      {cached && (
        <span className="badge badge-soft-info fs-10 px-2 py-1">Cached</span>
      )}
    </div>
  )
}

export default ExplainabilityBadge
