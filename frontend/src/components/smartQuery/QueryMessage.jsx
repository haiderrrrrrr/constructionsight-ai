import PropTypes from 'prop-types'
import ChartRenderer from './ChartRenderer'
import EvidencePanel from './EvidencePanel'
import InsightsList from './InsightsList'
import QueryBreakdownPanel from './QueryBreakdownPanel'
import MarkdownRenderer from './MarkdownRenderer'
import TypingIndicator from './TypingIndicator'

const assistantDataShape = PropTypes.shape({
  error_message: PropTypes.string,
  rows_returned: PropTypes.number,
  duration_ms: PropTypes.number,
  cached: PropTypes.bool,
  answer: PropTypes.string,
  insights: PropTypes.array,
  chart: PropTypes.object,
  evidence: PropTypes.array,
  sql_used: PropTypes.string,
  follow_up_suggestions: PropTypes.array,
  _onSuggestionClick: PropTypes.func,
})

const formatError = (msg) => {
  const base = String(msg || '').trim()
  if (!base) return 'Please try again and include a zone, date range, and metric.'
  return base
}

const errorTitle = (msg) => {
  const base = String(msg || '').toLowerCase()
  if (base.includes('no data') || base.includes('no matching records')) return 'No matching data'
  if (base.includes('temporarily unavailable')) return 'AI engine unavailable'
  if (base.includes('valid query') || base.includes('database') || base.includes('sql')) return 'Query could not run'
  return 'Something went wrong'
}

/* ── User message ─────────────────────────────────────────── */
const UserMessage = ({ content }) => (
  <div className="sq-msg sq-msg-user">
    <div className="sq-msg-user-bubble">{content}</div>
  </div>
)

/* ── Assistant message ────────────────────────────────────── */
const AssistantMessage = ({ data, isLoading }) => (
  <div className={`sq-msg sq-msg-ai${isLoading ? ' sq-msg-ai--typing' : ''}`}>
    <div className="sq-msg-ai-avatar" aria-label="AI">
      <img src="/images/icons/robot.png" alt="Robot" className="sq-robot-icon" />
    </div>
    <div className="sq-msg-ai-content">
      <div className={`sq-msg-ai-bubble${isLoading ? ' sq-msg-ai-bubble--typing' : ''}`}>
        {isLoading ? (
          <TypingIndicator />
        ) : data.error_message ? (
          <div className="sq-msg-error">
            <div className="sq-msg-error-title">{errorTitle(data.error_message)}</div>
            <div className="sq-msg-error-sub">{formatError(data.error_message)}</div>
          </div>
        ) : (
          <>
            <div className="sq-msg-markdown">
              <MarkdownRenderer>{data.answer}</MarkdownRenderer>
            </div>
            <InsightsList insights={data.insights} />
            {data.chart && <ChartRenderer chart={data.chart} />}
            <EvidencePanel evidence={data.evidence} />
            <QueryBreakdownPanel
              sqlUsed={data.sql_used}
              durationMs={data.duration_ms}
              rowsReturned={data.rows_returned}
              cached={data.cached}
            />
            {data.follow_up_suggestions?.length > 0 && (
              <div className="sq-msg-followups">
                <div className="sq-msg-followups-label">You might also ask:</div>
                <div className="sq-msg-followups-chips">
                  {data.follow_up_suggestions.map((s, i) => (
                    <button
                      key={i}
                      className="sq-followup-chip"
                      onClick={() => data._onSuggestionClick?.(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  </div>
)

const QueryMessage = ({ role, content, isLoading, onSuggestionClick }) => {
  if (role === 'user') return <UserMessage content={content} />
  const data = typeof content === 'object'
    ? { ...content, _onSuggestionClick: onSuggestionClick }
    : {}
  return <AssistantMessage data={data} isLoading={isLoading} />
}

export default QueryMessage

UserMessage.propTypes = {
  content: PropTypes.string,
}

AssistantMessage.propTypes = {
  data: assistantDataShape,
  isLoading: PropTypes.bool,
}

QueryMessage.propTypes = {
  role: PropTypes.string,
  content: PropTypes.oneOfType([PropTypes.string, PropTypes.object]),
  isLoading: PropTypes.bool,
  onSuggestionClick: PropTypes.func,
}
