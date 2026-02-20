'use client';

import { useState, useEffect, useRef } from 'react';
import { api, formatCurrency } from '../lib/api';

const SUGGESTED_QUESTIONS = [
  { cat: 'Quick', questions: ['Top 10 closers this month', 'Revenue by branch this month', 'Orders closed yesterday'] },
  { cat: 'Compare', questions: ['Branch revenue this month vs prior', 'Reps with biggest revenue increase', 'Average revenue per order by branch'] },
  { cat: 'Deep', questions: ['Revenue trend by branch last 6 months', 'Bill code breakdown by branch', 'Reps trending down over 3 months'] },
];

export default function TessaChat({ month, year }) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState([]);
  const [sidePanel, setSidePanel] = useState(null);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    loadHistory();
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function loadHistory() {
    try {
      const h = await api('/api/tessa/history?limit=20');
      setHistory(h);
    } catch (e) { console.error(e); }
  }

  async function handleSend(text) {
    const q = text || input.trim();
    if (!q || loading) return;
    setInput('');
    setSidePanel(null);

    // Build conversation history from current messages (snapshot before adding new ones).
    // Pair user + assistant turns — send only sql/explanation/rowCount, not raw row data.
    const history = [];
    for (let i = 0; i + 1 < messages.length; i += 2) {
      const u = messages[i];
      const a = messages[i + 1];
      if (u?.role === 'user' && a?.role === 'assistant') {
        history.push({
          question: u.content,
          sql: a.sql || null,
          explanation: a.content || '',
          rowCount: a.rowCount || 0
        });
      }
    }

    const userMsg = { role: 'user', content: q, timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const result = await api('/api/tessa/ask', {
        method: 'POST',
        body: JSON.stringify({ question: q, history })
      });

      const assistantMsg = {
        role: 'assistant',
        content: result.explanation || 'Here are the results:',
        data: result.data,
        sql: result.sql,
        rowCount: result.rowCount,
        duration_ms: result.duration_ms,
        success: result.success,
        error: result.error,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, assistantMsg]);
      loadHistory();
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Sorry, I ran into an error: ${err.message}`,
        success: false,
        timestamp: new Date()
      }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  async function handleRerun(sql, question) {
    setLoading(true);
    const userMsg = { role: 'user', content: `Re-run: ${question}`, timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);

    try {
      const result = await api('/api/tessa/rerun', {
        method: 'POST',
        body: JSON.stringify({ sql })
      });
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Here are the refreshed results:',
        data: result.data,
        sql,
        rowCount: result.rowCount,
        duration_ms: result.duration_ms,
        success: true,
        timestamp: new Date()
      }]);
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Re-run failed: ${err.message}`,
        success: false,
        timestamp: new Date()
      }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const hasMessages = messages.length > 0;

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 57px)', overflow: 'hidden', margin: '0 -24px' }}>
      {/* Main Chat Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

        {/* Messages or Welcome */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
          {!hasMessages ? (
            <WelcomeScreen onAsk={handleSend} />
          ) : (
            <div style={{ maxWidth: '800px', margin: '0 auto' }}>
              {messages.map((msg, i) => (
                <MessageBubble
                  key={i}
                  message={msg}
                  onShowSQL={(sql) => setSidePanel(sql)}
                  onExport={(data, q) => exportToCSV(data, q)}
                  onRerun={handleRerun}
                />
              ))}
              {loading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '16px 0' }}>
                  <TessaAvatar />
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <span className="dot-pulse" />
                    <span className="dot-pulse" style={{ animationDelay: '0.2s' }} />
                    <span className="dot-pulse" style={{ animationDelay: '0.4s' }} />
                  </div>
                  <span style={{ fontSize: '13px', color: '#adb5bd' }}>Analyzing...</span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input Area */}
        <div style={{
          borderTop: '1px solid #e9ecef',
          padding: '16px 24px',
          background: 'white'
        }}>
          <div style={{
            maxWidth: '800px', margin: '0 auto',
            display: 'flex', gap: '10px', alignItems: 'flex-end'
          }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask Tessa about your data..."
                disabled={loading}
                rows={1}
                style={{
                  width: '100%',
                  padding: '14px 16px',
                  border: '2px solid #e9ecef',
                  borderRadius: '12px',
                  fontSize: '15px',
                  outline: 'none',
                  resize: 'none',
                  lineHeight: '1.4',
                  fontFamily: 'inherit',
                  transition: 'border-color 0.15s',
                  minHeight: '50px',
                  maxHeight: '120px'
                }}
                onFocus={(e) => e.target.style.borderColor = '#f26b2b'}
                onBlur={(e) => e.target.style.borderColor = '#e9ecef'}
                onInput={(e) => {
                  e.target.style.height = 'auto';
                  e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                }}
              />
            </div>
            <button
              onClick={() => handleSend()}
              disabled={loading || !input.trim()}
              style={{
                width: '44px', height: '44px',
                borderRadius: '10px',
                background: loading || !input.trim() ? '#e9ecef' : '#f26b2b',
                border: 'none',
                color: 'white',
                fontSize: '18px',
                cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
                transition: 'background 0.15s'
              }}
            >
              ↑
            </button>
            <button
              onClick={() => setShowHistory(!showHistory)}
              style={{
                width: '44px', height: '44px',
                borderRadius: '10px',
                background: showHistory ? '#f1f3f5' : 'white',
                border: '1px solid #e9ecef',
                color: '#868e96',
                fontSize: '14px',
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0
              }}
              title="Question history"
            >
              ↻
            </button>
          </div>
        </div>
      </div>

      {/* Side Panel */}
      {(sidePanel || showHistory) && (
        <div style={{
          width: '380px',
          borderLeft: '1px solid #e9ecef',
          background: '#f8f9fa',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          flexShrink: 0
        }}>
          <div style={{
            padding: '14px 16px',
            borderBottom: '1px solid #e9ecef',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'white'
          }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#343a40' }}>
              {sidePanel ? '🔍 Query Details' : '↻ Recent Questions'}
            </span>
            <button
              onClick={() => { setSidePanel(null); setShowHistory(false); }}
              style={{ background: 'none', border: 'none', fontSize: '16px', color: '#868e96', cursor: 'pointer' }}
            >
              ✕
            </button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
            {sidePanel && (
              <div>
                <div style={{
                  fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.06em', color: '#adb5bd', marginBottom: '8px'
                }}>
                  SQL Query
                </div>
                <pre style={{
                  background: '#1e1e2e',
                  color: '#cdd6f4',
                  padding: '14px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  fontFamily: "'SF Mono', 'Fira Code', monospace",
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  overflowX: 'auto'
                }}>
                  {sidePanel}
                </pre>
                <div style={{ marginTop: '12px', fontSize: '11px', color: '#868e96', lineHeight: 1.5 }}>
                  This is the exact query Tessa ran against your database. Only SELECT queries are allowed — Tessa cannot modify your data.
                </div>
              </div>
            )}

            {showHistory && !sidePanel && (
              <div>
                {history.length === 0 && (
                  <div style={{ textAlign: 'center', color: '#adb5bd', fontSize: '13px', padding: '24px 0' }}>
                    No questions yet
                  </div>
                )}
                {history.map(h => (
                  <div
                    key={h.id}
                    style={{
                      padding: '10px 12px',
                      background: 'white',
                      border: '1px solid #e9ecef',
                      borderRadius: '8px',
                      marginBottom: '8px',
                      cursor: 'pointer',
                      transition: 'border-color 0.15s'
                    }}
                    onClick={() => handleSend(h.question)}
                    onMouseEnter={(e) => e.currentTarget.style.borderColor = '#f26b2b'}
                    onMouseLeave={(e) => e.currentTarget.style.borderColor = '#e9ecef'}
                  >
                    <div style={{ fontSize: '13px', color: '#343a40', marginBottom: '4px' }}>{h.question}</div>
                    <div style={{ fontSize: '11px', color: '#adb5bd', display: 'flex', gap: '8px' }}>
                      <span>{new Date(h.asked_at).toLocaleDateString()}</span>
                      {h.duration_ms && <span>• {h.duration_ms}ms</span>}
                      {h.row_count > 0 && <span>• {h.row_count} rows</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <style jsx>{`
        .dot-pulse {
          width: 6px;
          height: 6px;
          background: #f26b2b;
          border-radius: 50%;
          animation: pulse 1s ease-in-out infinite;
        }
        @keyframes pulse {
          0%, 100% { opacity: 0.3; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

function TessaAvatar() {
  return (
    <div style={{
      width: '32px', height: '32px',
      borderRadius: '50%',
      background: 'linear-gradient(135deg, #f26b2b, #e05a1a)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '14px', fontWeight: 700, color: 'white',
      flexShrink: 0
    }}>
      T
    </div>
  );
}

function UserAvatar() {
  return (
    <div style={{
      width: '32px', height: '32px',
      borderRadius: '50%',
      background: '#03374f',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '14px', fontWeight: 700, color: 'white',
      flexShrink: 0
    }}>
      U
    </div>
  );
}

function WelcomeScreen({ onAsk }) {
  return (
    <div style={{ maxWidth: '700px', margin: '0 auto', paddingTop: '60px' }}>
      <div style={{ textAlign: 'center', marginBottom: '40px' }}>
        <div style={{
          width: '64px', height: '64px', borderRadius: '50%',
          background: 'linear-gradient(135deg, #f26b2b, #e05a1a)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '28px', fontWeight: 700, color: 'white',
          margin: '0 auto 16px'
        }}>
          T
        </div>
        <h2 style={{ fontSize: '22px', fontWeight: 700, color: '#343a40', margin: '0 0 6px' }}>
          Ask Tessa
        </h2>
        <p style={{ fontSize: '14px', color: '#868e96', margin: 0 }}>
          Your AI data analyst. Ask anything about revenue, orders, reps, or branches.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
        {SUGGESTED_QUESTIONS.map((group) => (
          <div key={group.cat}>
            <div style={{
              fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.08em', color: '#adb5bd', marginBottom: '8px',
              paddingLeft: '4px'
            }}>
              {group.cat}
            </div>
            {group.questions.map((q, i) => (
              <div
                key={i}
                onClick={() => onAsk(q)}
                style={{
                  padding: '10px 14px',
                  background: 'white',
                  border: '1px solid #e9ecef',
                  borderRadius: '8px',
                  fontSize: '13px',
                  color: '#495057',
                  cursor: 'pointer',
                  marginBottom: '6px',
                  transition: 'all 0.15s',
                  lineHeight: 1.4
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#f26b2b';
                  e.currentTarget.style.color = '#f26b2b';
                  e.currentTarget.style.background = 'rgba(242,107,43,0.03)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = '#e9ecef';
                  e.currentTarget.style.color = '#495057';
                  e.currentTarget.style.background = 'white';
                }}
              >
                {q}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ message, onShowSQL, onExport, onRerun }) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div style={{
        display: 'flex', gap: '12px', marginBottom: '20px',
        flexDirection: 'row-reverse'
      }}>
        <UserAvatar />
        <div style={{
          background: '#03374f',
          color: 'white',
          padding: '12px 16px',
          borderRadius: '16px 16px 4px 16px',
          maxWidth: '70%',
          fontSize: '14px',
          lineHeight: 1.5
        }}>
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', alignItems: 'flex-start' }}>
      <TessaAvatar />
      <div style={{ flex: 1, minWidth: 0 }}>
        {message.content && (
          <div style={{
            fontSize: '14px', color: '#343a40', lineHeight: 1.6,
            marginBottom: message.data ? '12px' : '0',
            whiteSpace: 'pre-line'
          }}>
            {message.success === false && !message.data ? (
              <span style={{ color: '#c62828' }}>{message.content}</span>
            ) : message.content}
          </div>
        )}

        {message.data && message.data.length > 0 && (
          <div style={{
            background: 'white',
            border: '1px solid #e9ecef',
            borderRadius: '10px',
            overflow: 'hidden',
            marginBottom: '8px'
          }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="report-table" style={{ margin: 0 }}>
                <thead>
                  <tr>
                    {Object.keys(message.data[0]).map(col => (
                      <th key={col} className={typeof message.data[0][col] === 'string' ? 'text-left' : ''}>
                        {col.replace(/_/g, ' ')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {message.data.slice(0, 50).map((row, ri) => (
                    <tr key={ri}>
                      {Object.entries(row).map(([col, val], ci) => (
                        <td key={ci} className={typeof val === 'string' ? 'text-left' : ''}>
                          {typeof val === 'number'
                            ? (col.includes('rev') || col.includes('revenue') || col.includes('amount') || col.includes('total')
                              ? formatCurrency(val)
                              : val.toLocaleString())
                            : val ?? ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {message.data.length > 50 && (
              <div style={{ padding: '6px 12px', background: '#f8f9fa', fontSize: '11px', color: '#868e96' }}>
                Showing 50 of {message.data.length} rows
              </div>
            )}
          </div>
        )}

        {message.data && message.data.length === 0 && (
          <div style={{
            padding: '12px 16px', background: '#f8f9fa', borderRadius: '8px',
            fontSize: '13px', color: '#868e96'
          }}>
            No results found.
          </div>
        )}

        {(message.data || message.sql) && (
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            {message.rowCount != null && (
              <span style={{ fontSize: '11px', color: '#adb5bd', marginRight: '4px' }}>
                {message.rowCount} rows • {message.duration_ms}ms
              </span>
            )}
            {message.data && message.data.length > 0 && (
              <ActionButton label="📥 Export" onClick={() => onExport(message.data, 'tessa-export')} />
            )}
            {message.sql && (
              <ActionButton label="🔍 View Query" onClick={() => onShowSQL(message.sql)} />
            )}
            {message.sql && (
              <ActionButton label="🔄 Re-run" onClick={() => onRerun(message.sql, message.content)} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ActionButton({ label, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 10px',
        background: 'white',
        border: '1px solid #e9ecef',
        borderRadius: '6px',
        fontSize: '11px',
        color: '#868e96',
        cursor: 'pointer',
        transition: 'all 0.15s',
        fontWeight: 500
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = '#f26b2b';
        e.currentTarget.style.color = '#f26b2b';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = '#e9ecef';
        e.currentTarget.style.color = '#868e96';
      }}
    >
      {label}
    </button>
  );
}

function exportToCSV(data, question) {
  if (!data || data.length === 0) return;
  const headers = Object.keys(data[0]);
  const csvContent = [
    headers.join(','),
    ...data.map(row => headers.map(h => {
      const val = row[h];
      if (val === null || val === undefined) return '';
      if (typeof val === 'string' && val.includes(',')) return `"${val}"`;
      return val;
    }).join(','))
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tessa-${(question || 'export').slice(0, 30).replace(/[^a-z0-9]/gi, '-')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
