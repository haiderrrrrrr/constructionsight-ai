import { useCallback, useEffect, useState } from 'react'
import { FiMessageSquare, FiPlus, FiTrash2 } from 'react-icons/fi'
import { apiDelete, apiGet } from '@/utils/api'
import topTostError from '@/utils/topTostError'
import PropTypes from 'prop-types'

const QueryHistorySidebar = ({
  projectId,
  activeConversationId,
  onNewConversation,
  onSelectConversation,
  onConversationsLoaded,
  refreshKey,
}) => {
  const [conversations, setConversations] = useState([])

  const load = useCallback(() => {
    const url = projectId
      ? `/smart-query/conversations?project_id=${projectId}`
      : '/smart-query/conversations'
    apiGet(url)
      .then(data => {
        const items = data || []
        setConversations(items)
        onConversationsLoaded?.(items)
      })
      .catch(() => {})
  }, [onConversationsLoaded, projectId])

  useEffect(() => { load() }, [load, refreshKey])

  const deleteConversation = async (conversationId, e) => {
    e.stopPropagation()
    try {
      const url = projectId
        ? `/smart-query/conversations/${conversationId}?project_id=${projectId}`
        : `/smart-query/conversations/${conversationId}`
      await apiDelete(url)
      setConversations(items => items.filter(x => x.conversation_id !== conversationId))
      if (activeConversationId === conversationId) onNewConversation?.()
    } catch {
      topTostError('Failed to delete conversation')
    }
  }

  return (
    <aside className="sq-conversation-sidebar">
      <div className="sq-conversation-head">
        <div className="d-flex align-items-center gap-2">
          <FiMessageSquare size={18} className="sq-conversation-head-icon" />
          <span className="fs-12 fw-semibold sq-conversation-head-label text-uppercase">Conversations</span>
        </div>
        <button
          type="button"
          className="sq-new-chat-btn"
          onClick={onNewConversation}
          title="Start conversation"
          aria-label="Start conversation"
        >
          <FiPlus size={15} />
        </button>
      </div>

      <div className="sq-conversation-list">
        {conversations.length === 0 ? (
          <div className="sq-conversation-empty">No conversations yet.</div>
        ) : (
          conversations.map(item => (
            <button
              key={item.conversation_id}
              type="button"
              className={`sq-conversation-item ${activeConversationId === item.conversation_id ? 'active' : ''}`}
              onClick={() => onSelectConversation?.(item.conversation_id)}
            >
              <span className="sq-conversation-text">
                <span className="sq-conversation-title">{item.first_question || 'New conversation'}</span>
                <span className="sq-conversation-meta">
                  {item.turn_count} turn{item.turn_count === 1 ? '' : 's'} • {new Date(item.last_asked).toLocaleDateString()}
                </span>
              </span>
              <span
                role="button"
                tabIndex={0}
                className="sq-conversation-delete"
                onClick={(e) => deleteConversation(item.conversation_id, e)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') deleteConversation(item.conversation_id, e)
                }}
                title="Delete conversation"
                aria-label="Delete conversation"
              >
                <FiTrash2 size={12} />
              </span>
            </button>
          ))
        )}
      </div>
    </aside>
  )
}

export default QueryHistorySidebar

QueryHistorySidebar.propTypes = {
  projectId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  activeConversationId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  onNewConversation: PropTypes.func,
  onSelectConversation: PropTypes.func,
  onConversationsLoaded: PropTypes.func,
  refreshKey: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
}
