'use client';

import { useState, useEffect } from 'react';
import { api, formatCurrency } from '../lib/api';

const SUGGESTED_QUESTIONS = {
  basic: {
    label: '📊 Basic',
    questions: [
      'Top 10 closers this month',
      'Revenue by branch for this month',
      'Orders closed yesterday by branch',
      'Total revenue by title officer this month',
    ]
  },
  intermediate: {
    label: '📈 Intermediate',
    questions: [
      'Compare branch revenue this month vs prior month',
      'Sales reps with biggest revenue increase month over month',
      'Average revenue per order by branch for the last 3 months',
      'Title officers ranked by total orders this month',
    ]
  },
  complex: {
    label: '🔍 Complex',
    questions: [
      'Revenue trend by branch for the last 6 months',
      'Bill code breakdown by branch for this month',
      'Find reps whose revenue dropped more than 20% from last month',
      'Show orders with the highest revenue and their bill code details',
    ]
  }
};

export default function TessaChat({ month, year }) {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [responses, setResponses] = useState([]);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    loadHistory();
  }, []);

  async function loadHistory() {
    try {
      const h = await api('/api/tessa/history?limit=10');
      setHistory(h);
    } catch (e) { console.error(e); }
  }

  async function handleAsk(q) {
    const questionText = q || question;
    if (!questionText.trim() || loading) return;

    setLoading(true);
    setQuestion('');

    try {
      const result = await api('/api/tessa/ask', {
        method: 'POST',
        body: JSON.stringify({ question: questionText })
      });

      setResponses(prev => [{ question: questionText, ...result, timestamp: new Date() }, ...prev]);
      loadHistory();
    } catch (err) {
      setResponses(prev => [{ question: questionText, success: false, error: err.message, timestamp: new Date() }, ...prev]);
    } finally {
      setLoading(false);
    }
  }

  async function handleRerun(sql, originalQuestion) {
    setLoading(true);
    try {
      const result = await api('/api/tessa/rerun', {
        method: 'POST',
        body: JSON.stringify({ sql })
      });
      setResponses(prev => [{ question: `Re-run: ${originalQuestion}`, ...result, sql, timestamp: new Date() }, ...prev]);
    } catch (err) {
      setResponses(prev => [{ question: originalQuestion, success: false, error: err.message, timestamp: new Date() }, ...prev]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAsk();
    }
  }

  return (
    <div style={{ maxWidth: '900px' }}>
      {/* Suggested Questions */}
      {responses.length === 0 && (
        <div style={{ marginBottom: '20px' }}>
          {Object.entries(SUGGESTED_QUESTIONS).map(([key, cat]) => (
            <div key={key} style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#adb5bd', marginBottom: '8px' }}>
                {cat.label}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {cat.questions.map((q, i) => (
                  <div
                    key={i}
                    onClick={() => handleAsk(q)}
                    style={{
                      padding: '8px 14px', border: '1px solid #e9ecef', borderRadius: '6px',
                      fontSize: '13px', color: '#495057', cursor: 'pointer', transition: 'all 0.15s'
                    }}
                    onMouseEnter={(e) => { e.target.style.borderColor = '#f26b2b'; e.target.style.color = '#f26b2b'; }}
                    onMouseLeave={(e) => { e.target.style.borderColor = '#e9ecef'; e.target.style.color = '#495057'; }}
                  >
                    {q}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Input Area */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', background: 'white', padding: '12px', borderRadius: '8px', border: '1px solid #e9ecef' }}>
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask Tessa about your data..."
          disabled={loading}
          style={{
            flex: 1, padding: '10px 14px', border: '1px solid #dee2e6', borderRadius: '6px',
            fontSize: '14px', outline: 'none'
          }}
          onFocus={(e) => e.target.style.borderColor = '#f26b2b'}
          onBlur={(e) => e.target.style.borderColor = '#dee2e6'}
        />
        <button
          onClick={() => handleAsk()}
          disabled={loading || !question.trim()}
          className="btn-accent"
          style={{ padding: '10px 20px', opacity: loading || !question.trim() ? 0.5 : 1 }}
        >
          {loading ? 'Thinking...' : 'Ask'}
        </button>
        <button
          onClick={() => setShowHistory(!showHistory)}
          style={{
            padding: '10px 14px', background: 'none', border: '1px solid #dee2e6',
            borderRadius: '6px', fontSize: '12px', color: '#868e96', cursor: 'pointer'
          }}
        >
          History
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '20px', color: '#868e96', fontSize: '13px' }}>
          <div className="spinner" />
          Tessa is analyzing your data...
        </div>
      )}

      {/* History Panel */}
      {showHistory && history.length > 0 && (
        <div style={{ background: 'white', border: '1px solid #e9ecef', borderRadius: '8px', padding: '16px', marginBottom: '16px' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#868e96', textTransform: 'uppercase', marginBottom: '10px' }}>Recent Questions</div>
          {history.map(h => (
            <div
              key={h.id}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f1f3f5', fontSize: '13px' }}
            >
              <span style={{ color: '#495057' }}>{h.question}</span>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', color: '#adb5bd' }}>{new Date(h.asked_at).toLocaleDateString()}</span>
                {h.sql_generated && (
                  <button
                    onClick={() => handleRerun(h.sql_generated, h.question)}
                    style={{ fontSize: '11px', color: '#f26b2b', cursor: 'pointer', background: 'none', border: 'none', fontWeight: 600 }}
                  >
                    Re-run
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Responses */}
      {responses.map((r, i) => (
        <TessaResponse key={i} response={r} onRerun={handleRerun} />
      ))}
    </div>
  );
}

function TessaResponse({ response: r, onRerun }) {
  const [showSQL, setShowSQL] = useState(false);

  return (
    <div style={{ background: 'white', border: '1px solid #e9ecef', borderRadius: '8px', padding: '16px', marginBottom: '12px' }}>
      <div style={{ fontSize: '13px', fontWeight: 600, color: '#343a40', marginBottom: '8px' }}>
        {r.question}
      </div>

      {r.success === false && (
        <div style={{ color: '#c62828', fontSize: '13px' }}>Error: {r.error}</div>
      )}

      {r.explanation && (
        <div style={{ fontSize: '13px', color: '#495057', marginBottom: '10px', lineHeight: 1.6, whiteSpace: 'pre-line' }}>
          {r.explanation}
        </div>
      )}

      {r.data && r.data.length > 0 && (
        <>
          <div className="report-table-wrapper" style={{ overflowX: 'auto', marginBottom: '8px' }}>
            <table className="report-table">
              <thead>
                <tr>
                  {Object.keys(r.data[0]).map(col => (
                    <th key={col} className={typeof r.data[0][col] === 'string' ? 'text-left' : ''}>
                      {col.replace(/_/g, ' ')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.data.map((row, ri) => (
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

          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '11px', color: '#adb5bd' }}>
              {r.rowCount} rows • {r.duration_ms}ms
            </span>
            <button
              onClick={() => exportToCSV(r.data, r.question)}
              style={{ fontSize: '11px', color: '#868e96', cursor: 'pointer', background: 'none', border: '1px solid #dee2e6', borderRadius: '4px', padding: '4px 10px' }}
              onMouseEnter={(e) => { e.target.style.color = '#2e7d32'; e.target.style.borderColor = '#2e7d32'; }}
              onMouseLeave={(e) => { e.target.style.color = '#868e96'; e.target.style.borderColor = '#dee2e6'; }}
            >
              📥 Download Excel
            </button>
            {r.sql && (
              <button
                onClick={() => setShowSQL(!showSQL)}
                style={{ fontSize: '11px', color: '#868e96', cursor: 'pointer', background: 'none', border: '1px solid #dee2e6', borderRadius: '4px', padding: '4px 10px' }}
                onMouseEnter={(e) => { e.target.style.color = '#03374f'; e.target.style.borderColor = '#03374f'; }}
                onMouseLeave={(e) => { e.target.style.color = '#868e96'; e.target.style.borderColor = '#dee2e6'; }}
              >
                {showSQL ? '🔒 Hide Query' : '🔍 Show Query'}
              </button>
            )}
            {r.sql && (
              <button
                onClick={() => onRerun(r.sql, r.question)}
                style={{ fontSize: '11px', color: '#868e96', cursor: 'pointer', background: 'none', border: '1px solid #dee2e6', borderRadius: '4px', padding: '4px 10px' }}
                onMouseEnter={(e) => { e.target.style.color = '#f26b2b'; e.target.style.borderColor = '#f26b2b'; }}
                onMouseLeave={(e) => { e.target.style.color = '#868e96'; e.target.style.borderColor = '#dee2e6'; }}
              >
                🔄 Re-run
              </button>
            )}
          </div>
        </>
      )}

      {r.data && r.data.length === 0 && (
        <div style={{ fontSize: '13px', color: '#868e96' }}>No results found.</div>
      )}

      {/* SQL Query Transparency Panel */}
      {showSQL && r.sql && (
        <div style={{ marginTop: '10px', background: '#f8f9fa', border: '1px solid #e9ecef', borderRadius: '6px', padding: '12px', fontSize: '12px' }}>
          <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#adb5bd', marginBottom: '6px' }}>
            SQL Query Used
          </div>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#495057', fontFamily: 'monospace', lineHeight: 1.5 }}>
            {r.sql}
          </pre>
        </div>
      )}

      {/* Explanation-only responses (no data) also get Show Query if SQL exists */}
      {!r.data && r.sql && (
        <div style={{ marginTop: '8px' }}>
          <button
            onClick={() => setShowSQL(!showSQL)}
            style={{ fontSize: '11px', color: '#868e96', cursor: 'pointer', background: 'none', border: '1px solid #dee2e6', borderRadius: '4px', padding: '4px 10px' }}
          >
            {showSQL ? '🔒 Hide Query' : '🔍 Show Query'}
          </button>
          {showSQL && (
            <div style={{ marginTop: '8px', background: '#f8f9fa', border: '1px solid #e9ecef', borderRadius: '6px', padding: '12px', fontSize: '12px' }}>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#495057', fontFamily: 'monospace', lineHeight: 1.5 }}>
                {r.sql}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
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
  a.download = `tessa-${question.slice(0, 30).replace(/[^a-z0-9]/gi, '-')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
