import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const MarkdownRenderer = ({ children }) => {
  if (!children) return null

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // Paragraphs
        p: ({ children }) => (
          <p className="sq-md-p">{children}</p>
        ),
        // Headings
        h1: ({ children }) => <h1 className="sq-md-h1">{children}</h1>,
        h2: ({ children }) => <h2 className="sq-md-h2">{children}</h2>,
        h3: ({ children }) => <h3 className="sq-md-h3">{children}</h3>,
        // Bold / Italic
        strong: ({ children }) => <strong className="sq-md-strong">{children}</strong>,
        em: ({ children }) => <em>{children}</em>,
        // Code block
        code: ({ node, inline, className, children, ...props }) => {
          const lang = (className || '').replace('language-', '') || ''
          if (inline) {
            return <code className="sq-md-inline-code" {...props}>{children}</code>
          }
          return (
            <div className="sq-md-pre-wrap">
              {lang && <div className="sq-md-lang-label">{lang}</div>}
              <pre className="sq-md-pre"><code>{children}</code></pre>
            </div>
          )
        },
        pre: ({ children }) => <>{children}</>,
        // Lists
        ul: ({ children }) => <ul className="sq-md-ul">{children}</ul>,
        ol: ({ children }) => <ol className="sq-md-ol">{children}</ol>,
        li: ({ children }) => <li className="sq-md-li">{children}</li>,
        // Table (remark-gfm)
        table: ({ children }) => (
          <div className="sq-md-table-wrap">
            <table className="sq-md-table">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead>{children}</thead>,
        tbody: ({ children }) => <tbody>{children}</tbody>,
        tr: ({ children }) => <tr>{children}</tr>,
        th: ({ children }) => <th className="sq-md-th">{children}</th>,
        td: ({ children }) => <td className="sq-md-td">{children}</td>,
        // Horizontal rule
        hr: () => <hr className="sq-md-hr" />,
        // Blockquote
        blockquote: ({ children }) => (
          <blockquote className="sq-md-blockquote">{children}</blockquote>
        ),
        // Links
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="sq-md-link">
            {children}
          </a>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  )
}

export default MarkdownRenderer
