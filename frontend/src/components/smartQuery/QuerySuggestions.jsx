import React, { useEffect, useState } from 'react'
import { apiGet } from '@/utils/api'

/* Matches shadcn PromptSuggestions — label + 2-col card grid */
const QuerySuggestions = ({ projectId, onSelect }) => {
  const [suggestions, setSuggestions] = useState([])

  useEffect(() => {
    const url = projectId
      ? `/smart-query/suggestions?project_id=${projectId}`
      : '/smart-query/suggestions'
    apiGet(url).then(data => setSuggestions(data || [])).catch(() => {})
  }, [projectId])

  if (!suggestions.length) return null

  return (
    <div className="sq-prompt-suggestions">
      <p className="sq-prompt-suggestions-label">Try one of these queries!</p>
      <div className="sq-prompt-suggestions-grid">
        {suggestions.map((s, i) => (
          <button
            key={i}
            className="sq-prompt-card"
            onClick={() => onSelect(s.question)}
          >
            <span className="sq-prompt-card-label">{s.label}</span>
            <span className="sq-prompt-card-sub">{s.question}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export default QuerySuggestions
