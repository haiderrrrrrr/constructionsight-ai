import { useCallback, useEffect, useRef, useState } from 'react'
import { apiGet, apiPost } from '@/utils/api'
import QueryInput from './QueryInput'
import QueryMessage from './QueryMessage'
import QuerySuggestions from './QuerySuggestions'
import QueryHistorySidebar from './QueryHistorySidebar'
import topTostError from '@/utils/topTostError'
import PropTypes from 'prop-types'

const MODELS = [
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
  { id: 'deepseek-coder:6.7b', name: 'DeepSeek Coder 6.7B' },
  { id: 'qwen3:8b', name: 'Qwen3 8B' },
]

const makeConversationId = () => (
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)
)

/* ─────────────────────────────────────────────────────────────────────────────
   SmartQueryAssistant
   Layout mirrors shadcn chatbot-kit: Chat → MessageList → ChatMessage
                                             ↓ ChatForm → MessageInput
                                             ↓ PromptSuggestions
   All CSS uses Bootstrap CSS-variables so it works with your light/dark themes.
───────────────────────────────────────────────────────────────────────────── */

const SmartQueryAssistant = ({ projectId = null }) => {
  const [messages, setMessages] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [selectedModel, setSelectedModel] = useState(MODELS[0].id)
  const messagesEndRef = useRef(null)
  const abortRef = useRef(null)
  const loadingIdRef = useRef(null)
  // Generate a stable UUID once per component mount — ties all turns together as one conversation
  const conversationIdRef = useRef(
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36)
  )
  const [activeConversationId, setActiveConversationId] = useState(conversationIdRef.current)
  const [conversationRefreshKey, setConversationRefreshKey] = useState(0)
  const didAutoLoadRef = useRef(false)

  useEffect(() => {
    apiGet('/smart-query/status')
      .then(data => {
        const modelFromServer = data?.model
        if (modelFromServer && MODELS.some(m => m.id === modelFromServer)) {
          setSelectedModel(modelFromServer)
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [messages])

  const sendQuestion = useCallback(async (question) => {
    if (isLoading) return
    setMessages(prev => [...prev, { id: Date.now(), role: 'user', content: question }])
    const loadingId = Date.now() + 1
    loadingIdRef.current = loadingId
    setMessages(prev => [...prev, { id: loadingId, role: 'assistant', content: {}, isLoading: true }])
    setIsLoading(true)
    try {
      if (abortRef.current) abortRef.current.abort()
      const controller = new AbortController()
      abortRef.current = controller
      const body = { question, mode: 'auto', model: selectedModel, conversation_id: activeConversationId }
      if (projectId) body.project_id = projectId
      const data = await apiPost('/smart-query/ask', body, { signal: controller.signal })
      setMessages(prev => prev.map(m =>
        m.id === loadingId ? { id: loadingId, role: 'assistant', content: data, isLoading: false } : m
      ))
      setConversationRefreshKey(k => k + 1)
    } catch (err) {
      if (err?.name === 'AbortError') {
        setMessages(prev => prev.filter(m => m.id !== loadingId))
        return
      }
      const errMsg = err?.response?.data?.detail || 'An error occurred. Please try again.'
      setMessages(prev => prev.map(m =>
        m.id === loadingId ? {
          id: loadingId, role: 'assistant', isLoading: false,
          content: { error_message: errMsg, answer: '', insights: [], evidence: [], follow_up_suggestions: [], confidence: 'LOW', rows_returned: 0, duration_ms: 0, cached: false }
        } : m
      ))
    } finally {
      abortRef.current = null
      loadingIdRef.current = null
      setIsLoading(false)
    }
  }, [activeConversationId, isLoading, projectId, selectedModel])

  const stopGenerating = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setIsLoading(false)
    const loadingId = loadingIdRef.current
    if (loadingId) setMessages(prev => prev.filter(m => m.id !== loadingId))
    loadingIdRef.current = null
  }, [])

  const onSuggestionClick = useCallback((q) => sendQuestion(q), [sendQuestion])

  const startNewConversation = useCallback(() => {
    const id = makeConversationId()
    conversationIdRef.current = id
    setActiveConversationId(id)
    setMessages([])
  }, [])

  const loadConversation = useCallback(async (id) => {
    try {
      const rows = await apiGet(`/smart-query/conversations/${id}`)
      const loaded = []
      ;(rows || []).forEach(item => {
        loaded.push({ id: `${item.id}-user`, role: 'user', content: item.question })
        loaded.push({
          id: `${item.id}-assistant`,
          role: 'assistant',
          content: {
            answer: item.answer || '',
            insights: item.insights || [],
            evidence: item.evidence || [],
            follow_up_suggestions: [],
            chart: item.chart || null,
            sql_used: item.sql_used || null,
            duration_ms: item.duration_ms || 0,
            rows_returned: item.rows_returned || 0,
            confidence: 'MEDIUM',
            cached: item.cached || false,
            mode: item.mode || 'standard',
          },
          isLoading: false,
        })
      })
      conversationIdRef.current = id
      setActiveConversationId(id)
      setMessages(loaded)
    } catch {
      topTostError('Failed to load conversation')
    }
  }, [])

  const handleConversationsLoaded = useCallback((items) => {
    if (didAutoLoadRef.current || messages.length > 0 || !items?.length) return
    didAutoLoadRef.current = true
    loadConversation(items[0].conversation_id)
  }, [loadConversation, messages.length])

  return (
    <>
      {/* ── All scoped styles ──────────────────────────────────────────────── */}
      <style>{`

        /* ── Root / Chat shell ─────────────────────────────────────────────── */
        .sq-assistant-shell {
          display: grid;
          grid-template-columns: 280px minmax(0, 1fr);
          height: calc(100vh - 64px);
          overflow: hidden;
          background: var(--bs-body-bg);
        }
        html.app-skin-dark .sq-assistant-shell {
          --bs-body-color: rgba(255,255,255,0.88);
          --bs-secondary-color: rgba(255,255,255,0.70);
          --bs-body-bg: #0b1220;
          --bs-tertiary-bg: #0f172a;
          --bs-border-color: #1b2436;
        }
        .sq-conversation-sidebar {
          height: 100%;
          border-right: 1px solid var(--bs-border-color);
          background: var(--bs-body-bg);
          display: flex;
          flex-direction: column;
        }
        html.app-skin-dark .sq-conversation-sidebar {
          background: #0f172a;
          border-right-color: #1b2436;
        }
        .sq-conversation-head {
          min-height: 58px;
          padding: 12px 20px;
          border-bottom: 1px solid var(--bs-border-color);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          flex-shrink: 0;
        }
        html.app-skin-dark .sq-conversation-head { border-bottom-color: #1b2436; }
        .sq-conversation-head-icon { color: var(--bs-secondary-color); }
        .sq-conversation-head-label { color: var(--bs-secondary-color); }
        .sq-new-chat-btn {
          width: 30px;
          height: 30px;
          border: 1px solid var(--bs-border-color);
          border-radius: 8px;
          background: var(--bs-body-bg);
          color: var(--bs-body-color);
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .sq-new-chat-btn:hover {
          color: rgba(var(--bs-primary-rgb), 1);
          border-color: rgba(var(--bs-primary-rgb), 0.45);
          background: rgba(var(--bs-primary-rgb), 0.06);
        }
        html.app-skin-dark .sq-new-chat-btn {
          background: var(--bs-tertiary-bg);
          border-color: var(--bs-border-color);
        }
        .sq-conversation-list {
          overflow-y: auto;
          min-height: 0;
          padding: 8px;
        }
        .sq-conversation-empty {
          padding: 18px 8px;
          text-align: center;
          color: var(--bs-secondary-color);
          font-size: 0.8rem;
        }
        .sq-conversation-item {
          width: 100%;
          border: 0;
          background: transparent;
          color: var(--bs-body-color);
          display: flex;
          align-items: flex-start;
          gap: 8px;
          text-align: left;
          border-radius: 8px;
          padding: 9px 8px;
          cursor: pointer;
        }
        .sq-conversation-item:hover,
        .sq-conversation-item.active {
          background: rgba(var(--bs-primary-rgb), 0.07);
        }
        html.app-skin-dark .sq-conversation-item:hover,
        html.app-skin-dark .sq-conversation-item.active {
          background: rgba(91, 141, 238, 0.13);
        }
        .sq-conversation-text {
          min-width: 0;
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .sq-conversation-title {
          font-size: 0.79rem;
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .sq-conversation-meta {
          font-size: 0.68rem;
          color: var(--bs-secondary-color);
        }
        .sq-conversation-delete {
          width: 24px;
          height: 24px;
          border-radius: 6px;
          color: var(--bs-secondary-color);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          opacity: 0;
        }
        .sq-conversation-item:hover .sq-conversation-delete { opacity: 1; }
        .sq-conversation-delete:hover {
          color: var(--bs-danger);
          background: rgba(var(--bs-danger-rgb), 0.08);
        }
        @media (max-width: 900px) {
          .sq-assistant-shell { grid-template-columns: 1fr; }
          .sq-conversation-sidebar { display: none; }
        }

        .sq-chat {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: var(--bs-body-bg);
          overflow: hidden;
        }
        /* ── Status bar ────────────────────────────────────────────────────── */
        .sq-statusbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 7px 20px;
          border-bottom: 1px solid var(--bs-border-color);
          flex-shrink: 0;
          min-height: 38px;
          background: var(--bs-body-bg);
        }
        html.app-skin-dark .sq-statusbar {
          background: var(--bs-body-bg);
          border-bottom-color: var(--bs-border-color);
        }
        .sq-statusbar-right {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 10px;
          flex: 1;
          min-width: 0;
        }
        .sq-model-select {
          width: 190px;
        }
        @media (max-width: 520px) {
          .sq-model-select { width: 150px; }
        }
        .sq-status-dot {
          width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
        }
        .sq-status-dot--online {
          background: #22c55e;
          box-shadow: 0 0 0 3px rgba(34,197,94,0.18);
        }
        .sq-status-dot--offline {
          background: #ef4444;
          box-shadow: 0 0 0 3px rgba(239,68,68,0.18);
        }
        .sq-statusbar-label {
          font-size: 11px; font-weight: 500;
          color: var(--bs-secondary-color);
        }
        .sq-statusbar-badge {
          font-size: 10px; padding: 2px 8px;
          border-radius: 999px;
          background: rgba(var(--bs-primary-rgb), 0.1);
          color: rgba(var(--bs-primary-rgb), 1);
          font-weight: 600;
        }

        /* ── MessageList (scroll container) ────────────────────────────────── */
        .sq-message-list {
          flex: 1;
          overflow-y: auto;
          overflow-x: hidden;
          padding: 28px 16px 12px;
        }
        .sq-message-list::-webkit-scrollbar { width: 4px; }
        .sq-message-list::-webkit-scrollbar-track { background: transparent; }
        .sq-message-list::-webkit-scrollbar-thumb {
          background: var(--bs-border-color); border-radius: 99px;
        }

        /* Centered column — max-width 740px like shadcn kit */
        .sq-message-list-inner {
          max-width: 1040px;
          margin: 0 auto;
          width: 100%;
        }

        /* ── Empty / Welcome state ──────────────────────────────────────────── */
        .sq-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 48px 16px 20px;
          text-align: center;
        }
        .sq-empty-icon {
          width: 64px; height: 64px;
          border-radius: 14px;
          background: rgba(var(--bs-primary-rgb), 0.08);
          border: 1px solid rgba(var(--bs-primary-rgb), 0.18);
          color: rgba(var(--bs-primary-rgb), 1);
          display: flex; align-items: center; justify-content: center;
          margin-bottom: 14px;
        }
        html.app-skin-dark .sq-empty-icon {
          background: rgba(91, 141, 238, 0.14);
          border-color: rgba(91, 141, 238, 0.26);
        }
        .sq-robot-icon {
          width: 30px;
          height: 30px;
          object-fit: contain;
          display: block;
        }
        .sq-msg-ai-avatar .sq-robot-icon {
          width: 20px;
          height: 20px;
        }
        .sq-empty-title {
          font-size: 17px; font-weight: 700;
          color: var(--bs-body-color);
          margin-bottom: 6px;
        }
        .sq-empty-sub {
          font-size: 13px; line-height: 1.65;
          color: var(--bs-secondary-color);
          max-width: 400px;
        }

        /* ── ChatMessage: user ──────────────────────────────────────────────── */
        .sq-msg { margin-bottom: 22px; display: flex; }
        .sq-msg-user { justify-content: flex-end; }
        .sq-msg-user-bubble {
          background: rgba(var(--bs-primary-rgb), 1);
          color: #fff;
          border-radius: 18px 18px 4px 18px;
          padding: 10px 16px;
          font-size: 0.875rem;
          line-height: 1.65;
          max-width: 82%;
          word-break: break-word;
          white-space: pre-wrap;
          box-shadow: 0 6px 18px rgba(2, 6, 23, 0.08);
        }
        html.app-skin-dark .sq-msg-user-bubble {
          box-shadow: none;
        }

        /* ── ChatMessage: assistant ─────────────────────────────────────────── */
        .sq-msg-ai { align-items: flex-start; gap: 11px; }
        .sq-msg-ai--typing { align-items: center; }
        .sq-msg-ai--typing .sq-msg-ai-avatar { margin-top: 0; }
        .sq-msg-ai-avatar {
          width: 36px; height: 36px; flex-shrink: 0;
          border-radius: 8px;
          background: rgba(var(--bs-primary-rgb), 0.08);
          border: 1px solid rgba(var(--bs-primary-rgb), 0.18);
          display: flex; align-items: center; justify-content: center;
          margin-top: 3px;
        }
        html.app-skin-dark .sq-msg-ai-avatar {
          background: #0f172a;
          border-color: #1b2436;
        }
        .sq-msg-ai-content {
          flex: 1; min-width: 0;
          font-size: 0.875rem;
          line-height: 1.7;
          color: var(--bs-body-color);
        }
        .sq-msg-ai-bubble {
          border: 1px solid var(--bs-border-color);
          background: var(--bs-body-bg);
          border-radius: 14px;
          padding: 12px 14px;
          box-shadow: 0 8px 24px rgba(2, 6, 23, 0.06);
        }
        html.app-skin-dark .sq-msg-ai-bubble {
          background: #0f172a;
          border-color: #1b2436;
          box-shadow: none;
        }
        .sq-msg-error {
          color: var(--bs-danger);
          font-size: 0.88rem;
        }
        .sq-msg-error-title {
          font-weight: 700;
          margin-bottom: 4px;
          color: var(--bs-body-color);
        }
        .sq-msg-error-sub {
          color: var(--bs-secondary-color);
          line-height: 1.55;
        }
        html.app-skin-dark .sq-msg-error-title { color: rgba(255,255,255,0.90); }
        html.app-skin-dark .sq-msg-error-sub { color: rgba(255,255,255,0.72); }

        .sq-msg-ai-bubble--typing {
          border: 0;
          background: transparent;
          box-shadow: none;
          padding: 0;
        }

        /* ── TypingIndicator (3 dots) ─────────────────────────────────────── */
        .sq-typing-indicator {
          display: flex; align-items: center; gap: 5px;
          padding: 6px 0;
        }
        html.app-skin-dark .sq-typing-indicator {
          padding: 8px 10px;
          border-radius: 12px;
          border: 1px solid #1b2436;
          background: rgba(15, 23, 42, 0.7);
        }
        .sq-typing-dot {
          width: 7px; height: 7px; border-radius: 50%;
          background: var(--bs-secondary-color);
          animation: sq-typing-bounce 1.2s infinite ease-in-out;
        }
        html.app-skin-dark .sq-typing-dot { background: rgba(255,255,255,0.72); }
        .sq-typing-dot:nth-child(2) { animation-delay: 0.18s; }
        .sq-typing-dot:nth-child(3) { animation-delay: 0.36s; }
        @keyframes sq-typing-bounce {
          0%, 80%, 100% { transform: scale(0.65); opacity: 0.45; }
          40%            { transform: scale(1);    opacity: 1; }
        }

        /* ── Markdown renderer ───────────────────────────────────────────────
           Matches shadcn MarkdownRenderer demo output exactly              */
        .sq-msg-markdown { margin-top: 2px; }
        .sq-md-p { margin: 0 0 10px; line-height: 1.7; }
        .sq-md-p:last-child { margin-bottom: 0; }
        .sq-md-strong { font-weight: 700; }
        .sq-md-h1 { font-size: 1.25rem; font-weight: 700; margin: 16px 0 8px; }
        .sq-md-h2 { font-size: 1.1rem;  font-weight: 700; margin: 14px 0 6px; }
        .sq-md-h3 { font-size: 0.97rem; font-weight: 700; margin: 12px 0 4px; }
        .sq-md-ul, .sq-md-ol { margin: 0 0 10px 0; padding-left: 22px; }
        .sq-md-li { margin-bottom: 4px; line-height: 1.65; }
        .sq-md-inline-code {
          font-family: 'SFMono-Regular', Consolas, 'Courier New', monospace;
          font-size: 0.82em;
          padding: 1px 5px;
          border-radius: 4px;
          background: rgba(var(--bs-primary-rgb), 0.08);
          border: 1px solid rgba(var(--bs-primary-rgb), 0.15);
          color: rgba(var(--bs-primary-rgb), 1);
        }
        html.app-skin-dark .sq-md-inline-code {
          background: rgba(var(--bs-primary-rgb), 0.14);
          border-color: rgba(var(--bs-primary-rgb), 0.22);
        }
        .sq-md-pre-wrap {
          margin: 10px 0;
          border-radius: 9px;
          overflow: hidden;
          border: 1px solid var(--bs-border-color);
        }
        .sq-md-lang-label {
          font-size: 11px; font-weight: 600; text-transform: uppercase;
          letter-spacing: 0.05em;
          padding: 5px 12px;
          background: var(--bs-tertiary-bg);
          border-bottom: 1px solid var(--bs-border-color);
          color: var(--bs-secondary-color);
        }
        .sq-md-pre {
          margin: 0; padding: 12px 14px;
          background: var(--bs-tertiary-bg);
          font-family: 'SFMono-Regular', Consolas, 'Courier New', monospace;
          font-size: 0.8rem;
          line-height: 1.6;
          color: var(--bs-body-color);
          overflow-x: auto;
          white-space: pre;
        }
        html.app-skin-dark .sq-md-pre { background: rgba(0,0,0,0.3); }
        .sq-md-table-wrap { overflow-x: auto; margin: 10px 0; }
        .sq-md-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
        .sq-md-th {
          text-align: left; font-weight: 700; font-size: 0.78rem;
          padding: 7px 12px;
          background: var(--bs-tertiary-bg);
          border-bottom: 2px solid var(--bs-border-color);
          color: var(--bs-secondary-color);
        }
        .sq-md-td {
          padding: 7px 12px;
          border-bottom: 1px solid var(--bs-border-color);
          color: var(--bs-body-color);
        }
        .sq-md-hr { border: 0; border-top: 1px solid var(--bs-border-color); margin: 14px 0; }
        .sq-md-blockquote {
          margin: 10px 0; padding: 8px 14px;
          border-left: 3px solid rgba(var(--bs-primary-rgb), 0.5);
          background: rgba(var(--bs-primary-rgb), 0.04);
          color: var(--bs-secondary-color);
          font-style: italic;
          border-radius: 0 6px 6px 0;
        }
        .sq-md-link {
          color: rgba(var(--bs-primary-rgb), 1);
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .sq-md-link:hover { opacity: 0.8; }

        .sq-history-item:hover {
          background: rgba(var(--bs-primary-rgb), 0.04);
        }
        html.app-skin-dark .sq-history-item:hover {
          background: rgba(91, 141, 238, 0.1);
        }

        /* ── Follow-up suggestion chips ─────────────────────────────────────── */
        .sq-msg-followups { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--bs-border-color); }
        .sq-msg-followups-label {
          font-size: 11px; font-weight: 600; text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--bs-secondary-color);
          margin-bottom: 8px;
        }
        .sq-msg-followups-chips { display: flex; flex-wrap: wrap; gap: 7px; }
        .sq-followup-chip {
          display: inline-flex; align-items: center;
          padding: 5px 13px;
          border-radius: 999px;
          font-size: 0.75rem; font-weight: 500;
          border: 1px solid var(--bs-border-color);
          background: var(--bs-body-bg);
          color: var(--bs-body-color);
          cursor: pointer;
          transition: border-color 0.14s, background 0.14s, color 0.14s;
        }
        .sq-followup-chip:hover {
          border-color: rgba(var(--bs-primary-rgb), 0.45);
          background: rgba(var(--bs-primary-rgb), 0.06);
          color: rgba(var(--bs-primary-rgb), 1);
        }
        html.app-skin-dark .sq-followup-chip {
          background: #0f172a;
          border-color: #1b2436;
        }
        html.app-skin-dark .sq-followup-chip:hover {
          background: rgba(91, 141, 238, 0.12);
          border-color: rgba(91, 141, 238, 0.35);
          color: rgba(91, 141, 238, 1);
        }

        /* ── Data panels (Evidence, SQL breakdown) ─────────────────────────── */
        .sq-panel {
          border: 1px solid var(--bs-border-color);
          border-radius: 9px;
          overflow: hidden;
          background: var(--bs-body-bg);
        }
        html.app-skin-dark .sq-panel {
          background: var(--bs-tertiary-bg);
          border-color: var(--bs-border-color);
        }
        .sq-panel-head {
          background: var(--bs-tertiary-bg);
          padding: 6px 12px;
          font-size: 11px; font-weight: 600; text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--bs-secondary-color);
          border-bottom: 1px solid var(--bs-border-color);
        }
        html.app-skin-dark .sq-panel-head {
          background: #0f172a;
          border-bottom-color: #1b2436;
        }
        .sq-code {
          font-family: 'SFMono-Regular', Consolas, monospace;
          font-size: 0.75rem;
          background: var(--bs-tertiary-bg);
          color: var(--bs-body-color);
        }
        html.app-skin-dark .sq-code { background: rgba(0,0,0,0.25); }

        /* ── PromptSuggestions ──────────────────────────────────────────────── */
        .sq-prompt-suggestions {
          max-width: 1040px;
          margin: 0 auto;
          padding: 0 0 12px;
        }
        .sq-prompt-suggestions-label {
          font-size: 12px; font-weight: 600;
          color: var(--bs-secondary-color);
          margin-bottom: 10px;
          text-align: center;
        }
        .sq-prompt-suggestions-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 8px;
        }
        .sq-prompt-card {
          display: flex; flex-direction: column; align-items: flex-start;
          gap: 3px;
          padding: 11px 14px;
          border: 1px solid var(--bs-border-color);
          border-radius: 10px;
          background: var(--bs-body-bg);
          cursor: pointer;
          text-align: left;
          transition: border-color 0.14s, background 0.14s;
        }
        .sq-prompt-card:hover {
          border-color: rgba(var(--bs-primary-rgb), 0.45);
          background: rgba(var(--bs-primary-rgb), 0.04);
        }
        html.app-skin-dark .sq-prompt-card {
          background: #0f172a;
          border-color: #1b2436;
        }
        html.app-skin-dark .sq-prompt-card:hover {
          background: rgba(91, 141, 238, 0.12);
          border-color: rgba(91, 141, 238, 0.35);
        }
        .sq-prompt-card-label {
          font-size: 0.8rem; font-weight: 600;
          color: var(--bs-body-color);
          line-height: 1.4;
        }
        .sq-prompt-card-sub {
          font-size: 0.72rem;
          color: var(--bs-secondary-color);
          line-height: 1.45;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        /* ── ChatForm / MessageInput (input area) ───────────────────────────── */
        .sq-input-area {
          flex-shrink: 0;
          padding: 12px 16px 40px;
          border-top: 1px solid var(--bs-border-color);
          background: var(--bs-body-bg);
        }
        html.app-skin-dark .sq-input-area {
          background: var(--bs-body-bg);
          border-top-color: var(--bs-border-color);
        }
        .sq-input-inner {
          max-width: 1040px;
          margin: 0 auto;
        }

        /* The unified rounded input box — key shadcn chatbot-kit look */
        .sq-input-box {
          border: 1px solid var(--bs-border-color);
          border-radius: 14px;
          background: var(--bs-body-bg);
          transition: border-color 0.15s, box-shadow 0.15s;
          overflow: hidden;
        }
        .sq-input-box:focus-within {
          border-color: rgba(var(--bs-primary-rgb), 0.55);
          box-shadow: 0 0 0 3px rgba(var(--bs-primary-rgb), 0.09);
        }
        html.app-skin-dark .sq-input-box {
          background: #0f172a;
          border-color: #1b2436;
        }
        html.app-skin-dark .sq-input-box:focus-within {
          border-color: rgba(91, 141, 238, 0.45);
          box-shadow: 0 0 0 3px rgba(91, 141, 238, 0.12);
        }
        .sq-input-box--loading { opacity: 0.75; }

        .sq-input-textarea {
          display: block;
          width: 100%;
          border: 0; outline: none; resize: none;
          padding: 13px 16px 6px;
          font-size: 0.875rem; line-height: 1.6;
          background: transparent;
          color: var(--bs-body-color);
          min-height: 46px;
          max-height: 160px;
          font-family: inherit;
        }
        .sq-input-textarea::placeholder { color: var(--bs-secondary-color); }
        .sq-input-textarea:disabled { cursor: not-allowed; }

        /* Bottom row inside the input box */
        .sq-input-row {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          padding: 5px 10px 8px 14px;
        }

        /* Enterprise mode badge */
        .sq-mode-toggle {
          display: flex; align-items: center; gap: 2px;
          background: var(--bs-tertiary-bg);
          border-radius: 8px;
          padding: 2px;
        }
        html.app-skin-dark .sq-mode-toggle {
          background: var(--bs-tertiary-bg);
          border: 1px solid var(--bs-border-color);
        }
        .sq-mode-btn {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 4px 10px;
          border-radius: 6px; border: 0;
          background: transparent;
          font-size: 0.71rem; font-weight: 600;
          color: var(--bs-secondary-color);
          cursor: pointer;
          transition: background 0.12s, color 0.12s;
        }
        .sq-mode-btn--active {
          background: rgba(var(--bs-primary-rgb), 1);
          color: #fff;
        }
        .sq-mode-btn--badge {
          cursor: default;
          user-select: none;
        }

        .sq-input-actions {
          display: flex; align-items: center; gap: 8px;
        }
        .sq-char-count {
          font-size: 11px;
          color: var(--bs-secondary-color);
          font-variant-numeric: tabular-nums;
        }
        .sq-char-count--warn { color: var(--bs-danger); }

        /* Send button */
        .sq-send-btn {
          width: 32px; height: 32px;
          border-radius: 8px; border: 0;
          background: rgba(var(--bs-primary-rgb), 1);
          color: #fff;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          transition: opacity 0.14s;
        }
        .sq-send-btn:disabled { opacity: 0.38; cursor: not-allowed; }
        .sq-send-btn:not(:disabled):hover { opacity: 0.85; }

        /* Stop button (shown while generating — matches shadcn stop prop) */
        .sq-stop-btn {
          width: 32px; height: 32px;
          border-radius: 8px; border: 0;
          background: var(--bs-tertiary-bg);
          border: 1px solid var(--bs-border-color);
          color: var(--bs-body-color);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          transition: background 0.13s;
        }
        .sq-stop-btn:hover { background: var(--bs-secondary-bg); }
        html.app-skin-dark .sq-stop-btn {
          background: #0f172a;
          border-color: #1b2436;
        }
        html.app-skin-dark .sq-stop-btn:hover {
          background: #121a2d;
        }

        .sq-input-hint { display: none; }

        html.app-skin-dark .sq-assistant-shell { color: rgba(255,255,255,0.88); }
        html.app-skin-dark .sq-assistant-shell .text-muted { color: rgba(255,255,255,0.70) !important; }
        html.app-skin-dark .sq-assistant-shell .text-secondary { color: rgba(255,255,255,0.70) !important; }
        html.app-skin-dark .sq-assistant-shell .text-body-secondary { color: rgba(255,255,255,0.70) !important; }
        html.app-skin-dark .sq-assistant-shell .table { color: rgba(255,255,255,0.86); }
        html.app-skin-dark .sq-assistant-shell .table td,
        html.app-skin-dark .sq-assistant-shell .table th { color: rgba(255,255,255,0.86); }
        html.app-skin-dark .sq-assistant-shell .badge-soft-secondary,
        html.app-skin-dark .sq-assistant-shell .bg-soft-secondary {
          color: rgba(255,255,255,0.84) !important;
        }
        html.app-skin-dark .sq-chat { color: rgba(255,255,255,0.88); }
        html.app-skin-dark .sq-msg-ai-content { color: rgba(255,255,255,0.90) !important; }
        html.app-skin-dark .sq-md-p,
        html.app-skin-dark .sq-md-li,
        html.app-skin-dark .sq-md-h1,
        html.app-skin-dark .sq-md-h2,
        html.app-skin-dark .sq-md-h3 { color: rgba(255,255,255,0.90) !important; }
        html.app-skin-dark .sq-md-th { color: rgba(255,255,255,0.74) !important; }
        html.app-skin-dark .sq-md-lang-label { color: rgba(255,255,255,0.66) !important; }
        html.app-skin-dark .sq-conversation-title { color: rgba(255,255,255,0.90); }
        html.app-skin-dark .sq-conversation-meta { color: rgba(255,255,255,0.62); }
        html.app-skin-dark .sq-statusbar-label { color: rgba(255,255,255,0.72); }
        html.app-skin-dark .sq-model-select {
          background: #0f172a;
          border-color: #1b2436;
          color: rgba(255,255,255,0.86);
        }
        html.app-skin-dark .sq-model-select option {
          background: #0f172a;
          color: rgba(255,255,255,0.86);
        }
      `}</style>

      {/* ── Chat shell ──────────────────────────────────────────────────────── */}
      <div className="sq-assistant-shell">
      <QueryHistorySidebar
        projectId={projectId}
        activeConversationId={activeConversationId}
        onNewConversation={startNewConversation}
        onSelectConversation={loadConversation}
        onConversationsLoaded={handleConversationsLoaded}
        refreshKey={conversationRefreshKey}
      />
      <div className="sq-chat">

        {/* Status bar */}
        <div className="sq-statusbar">
          <div className="sq-statusbar-right">
            <select
              className="form-select form-select-sm sq-model-select"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              aria-label="Select model"
              disabled={isLoading}
            >
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* MessageList */}
        <div className="sq-message-list">
          <div className="sq-message-list-inner">
            {messages.length === 0 ? (
              <EmptyState />
            ) : (
              messages.map(msg => (
                <QueryMessage
                  key={msg.id}
                  role={msg.role}
                  content={msg.content}
                  isLoading={msg.isLoading}
                  onSuggestionClick={onSuggestionClick}
                />
              ))
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* PromptSuggestions — visible only on empty state, above input */}
        {messages.length === 0 && (
          <div style={{ padding: '0 16px' }}>
            <QuerySuggestions projectId={projectId} onSelect={sendQuestion} />
          </div>
        )}

        {/* ChatForm + MessageInput */}
        <QueryInput
          onSubmit={sendQuestion}
          onCancel={stopGenerating}
          isLoading={isLoading}
        />

      </div>
      </div>
    </>
  )
}

const EmptyState = () => (
  <div className="sq-empty">
    <div className="sq-empty-icon">
      <img src="/images/icons/robot.png" alt="Robot" className="sq-robot-icon" />
    </div>
    <div className="sq-empty-title">Smart Query Assistant</div>
    <div className="sq-empty-sub">
      Ask questions about your project data in plain English —
      PPE violations, workforce activity, equipment usage, risk analytics, and more.
    </div>
  </div>
)

export default SmartQueryAssistant

SmartQueryAssistant.propTypes = {
  projectId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
}
