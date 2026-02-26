import React from 'react'

const SEVERITY_CLASSES = {
  success: 'badge-soft-success text-success',
  warning: 'badge-soft-warning text-warning',
  danger: 'badge-soft-danger text-danger',
  info: 'badge-soft-info text-info',
}

const InsightsList = ({ insights = [] }) => {
  if (!insights.length) return null
  return (
    <div className="mt-3">
      <div className="fs-11 fw-semibold text-muted text-uppercase mb-2 letter-spacing-1">
        Key Insights
      </div>
      <div className="d-flex flex-column gap-2">
        {insights.map((item, i) => {
          const cls = SEVERITY_CLASSES[item.severity] || SEVERITY_CLASSES.info
          return (
            <div key={i} className={`d-flex align-items-start gap-2 px-3 py-2 rounded-3 ${cls}`}
              style={{ fontSize: '0.82rem' }}>
              <span className="flex-shrink-0" style={{ fontSize: '0.9rem' }}>{item.icon || '•'}</span>
              <span>{item.text}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default InsightsList
