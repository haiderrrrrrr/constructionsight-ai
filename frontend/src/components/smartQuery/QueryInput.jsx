import { useRef, useState } from 'react'
import { FiSend, FiSquare } from 'react-icons/fi'
import PropTypes from 'prop-types'

const QueryInput = ({ onSubmit, onCancel, isLoading }) => {
  const [text, setText] = useState('')
  const ref = useRef(null)

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const submit = () => {
    const q = text.trim()
    if (!q || isLoading) return
    onSubmit(q)
    setText('')
    if (ref.current) ref.current.style.height = 'auto'
  }

  const handleInput = (e) => {
    setText(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px'
  }

  const charLeft = 500 - text.length

  return (
    <div className="sq-input-area">
      <div className="sq-input-inner">
        <div className={`sq-input-box${isLoading ? ' sq-input-box--loading' : ''}`}>
          <textarea
            ref={ref}
            className="sq-input-textarea"
            placeholder={isLoading ? 'Generating response...' : 'Message Smart Query Assistant...'}
            value={text}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={isLoading}
            maxLength={500}
            autoComplete="off"
          />

          <div className="sq-input-row">
            <div className="sq-input-actions">
              <span className={`sq-char-count${charLeft < 50 ? ' sq-char-count--warn' : ''}`}>
                {charLeft}
              </span>
              {isLoading ? (
                <button
                  type="button"
                  className="sq-stop-btn"
                  title="Stop generating"
                  onClick={onCancel}
                >
                  <FiSquare size={12} />
                </button>
              ) : (
                <button
                  type="button"
                  className="sq-send-btn"
                  onClick={submit}
                  disabled={!text.trim()}
                  title="Send message (Enter)"
                >
                  <FiSend size={13} />
                </button>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}

export default QueryInput

QueryInput.propTypes = {
  onSubmit: PropTypes.func.isRequired,
  onCancel: PropTypes.func,
  isLoading: PropTypes.bool,
}
