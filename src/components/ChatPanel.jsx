import React, { useState, useRef, useEffect } from 'react';
import LivestreamMessages from './LivestreamMessages.jsx';

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
  },
  modeBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 0',
    borderBottom: '1px solid #333',
    marginBottom: 0,
  },
  modeBtn: (active) => ({
    padding: '6px 16px',
    fontSize: 12,
    fontWeight: active ? 600 : 400,
    border: '1px solid',
    borderColor: active ? '#5a5aaa' : '#444',
    borderRadius: 6,
    background: active ? '#2a2a5a' : 'transparent',
    color: active ? '#ccc' : '#666',
    cursor: 'pointer',
  }),
  messages: {
    flex: 1,
    overflowY: 'auto',
    padding: '12px 0',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  userMsg: {
    alignSelf: 'flex-end',
    background: '#4a4a8a',
    padding: '10px 16px',
    borderRadius: '16px 16px 4px 16px',
    maxWidth: '70%',
    fontSize: 16,
    lineHeight: 1.5,
  },
  assistantMsg: {
    alignSelf: 'flex-start',
    background: '#2a2a4a',
    padding: '10px 16px',
    borderRadius: '16px 16px 16px 4px',
    maxWidth: '70%',
    fontSize: 16,
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
  },
  systemMsg: {
    alignSelf: 'center',
    color: '#ff6b6b',
    fontSize: 16,
    padding: '6px 14px',
    background: '#2a1a1a',
    borderRadius: 8,
  },
  inputBar: {
    display: 'flex',
    gap: 8,
    padding: '12px 0',
    borderTop: '1px solid #333',
  },
  input: {
    flex: 1,
    padding: '12px 16px',
    background: '#2a2a4a',
    border: '1px solid #444',
    borderRadius: 8,
    color: '#e0e0e0',
    fontSize: 16,
    outline: 'none',
  },
  sendBtn: {
    padding: '12px 24px',
    background: '#5a5aaa',
    border: 'none',
    borderRadius: 8,
    color: '#fff',
    cursor: 'pointer',
    fontSize: 16,
  },
  status: {
    fontSize: 12,
    color: '#666',
    padding: '4px 0',
  },
  liveConfig: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  liveInput: {
    padding: '6px 10px',
    fontSize: 12,
    background: '#2a2a4a',
    border: '1px solid #444',
    borderRadius: 6,
    color: '#ccc',
    outline: 'none',
    width: 120,
  },
  liveLabel: {
    fontSize: 12,
    color: '#888',
  },
  liveBtn: (active) => ({
    padding: '6px 16px',
    fontSize: 16,
    fontWeight: 600,
    border: '1px solid',
    borderColor: active ? '#cc4444' : '#5a5aaa',
    borderRadius: 6,
    background: active ? '#4a2020' : 'transparent',
    color: active ? '#ff8888' : '#7a7aee',
    cursor: 'pointer',
  }),
};

export default function ChatPanel({
  chat, ttsEnabled = true, onToggleTTS, onUserAction, onResponseDone,
  subtitleDelay = 0, chatMode = 'full', identity = 'auto', onIdentityChange,
  chatAreaMode = 'chat', onChatAreaModeChange,
  livestreamMessages = [], playingSeq, spokenSeqs,
  livestreamConfig = {}, onLivestreamConfigChange, livestreamRunning = false,
  onLivestreamStart, onLivestreamStop, isViewingHistory = false,
}) {
  const { messages, connected, streaming, sendMessage } = chat;
  const [input, setInput] = useState('');
  const messagesEndRef = useRef(null);
  const lastDoneTextRef = useRef('');
  const [delayedMessages, setDelayedMessages] = useState(new Set());
  const [identities, setIdentities] = useState([{ value: 'auto', label: '自动' }]);

  // Fetch identities from server
  useEffect(() => {
    fetch('/api/identities')
      .then(r => r.json())
      .then(list => { if (list?.length) setIdentities(list); })
      .catch(() => {});
  }, []);

  // Notify parent when a new assistant message completes
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last?.role === 'assistant' && !last.streaming && last.content
        && last.content !== lastDoneTextRef.current) {
      lastDoneTextRef.current = last.content;

      if (subtitleDelay > 0) {
        const idx = messages.length - 1;
        setDelayedMessages(prev => new Set(prev).add(idx));
        setTimeout(() => {
          setDelayedMessages(prev => {
            const next = new Set(prev);
            next.delete(idx);
            return next;
          });
        }, subtitleDelay);
      }

      onResponseDone?.(last.content);
    }
  }, [messages, onResponseDone, subtitleDelay]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || streaming) return;
    onUserAction?.();
    const opts = { mode: chatMode };
    if (identity && identity !== 'auto') opts.identity = identity;
    sendMessage(text, opts);
    setInput('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const isLive = chatAreaMode === 'live';

  return (
    <div style={styles.container}>
      {/* Mode toggle bar */}
      <div style={styles.modeBar}>
        <button style={styles.modeBtn(!isLive)} onClick={() => onChatAreaModeChange?.('chat')}>
          对话
        </button>
        <button style={styles.modeBtn(isLive)} onClick={() => onChatAreaModeChange?.('live')}>
          直播
        </button>

        <div style={{ flex: 1 }} />

        {/* Status + TTS toggle + identity (shown in both modes) */}
        <span style={styles.status}>
          {connected ? '● 已连接' : '○ 未连接'}
          {streaming && ' — 思考中...'}
        </span>
        {onToggleTTS && (
          <span
            style={{ cursor: 'pointer', userSelect: 'none', fontSize: 16 }}
            onClick={onToggleTTS}
            title={ttsEnabled ? '语音开启' : '语音关闭'}
          >
            {ttsEnabled ? '\uD83D\uDD0A' : '\uD83D\uDD07'}
          </span>
        )}
        {!isLive && onIdentityChange && identities.length > 1 && (
          <span style={{ display: 'inline-flex', gap: 2 }}>
            {identities.map(id => (
              <button
                key={id.value}
                onClick={() => onIdentityChange(id.value)}
                style={{
                  padding: '2px 8px', fontSize: 12,
                  border: '1px solid',
                  borderColor: identity === id.value ? '#5a5aaa' : '#444',
                  borderRadius: 4,
                  background: identity === id.value ? '#3a3a6a' : 'transparent',
                  color: identity === id.value ? '#ccc' : '#666',
                  cursor: 'pointer',
                }}
              >
                {id.label}
              </button>
            ))}
          </span>
        )}
      </div>

      {/* Livestream config bar (always in live mode) */}
      {isLive && (
        <div style={{ ...styles.liveConfig, padding: '8px 0', borderBottom: '1px solid #2a2a3a' }}>
          <span style={styles.liveLabel}>平台</span>
          <select
            value={livestreamConfig.source || 'bilibili'}
            onChange={e => onLivestreamConfigChange?.({ ...livestreamConfig, source: e.target.value })}
            style={{ ...styles.liveInput, width: 80 }}
          >
            <option value="bilibili">Bilibili</option>
            <option value="youtube">YouTube</option>
            <option value="twitch">Twitch</option>
          </select>

          <span style={styles.liveLabel}>房间号</span>
          <input
            style={styles.liveInput}
            value={livestreamConfig.roomId || ''}
            onChange={e => onLivestreamConfigChange?.({ ...livestreamConfig, roomId: e.target.value })}
            placeholder="房间号"
          />

          <span style={styles.liveLabel}>并发</span>
          <input
            style={{ ...styles.liveInput, width: 50 }}
            type="number"
            min={1}
            max={10}
            value={livestreamConfig.maxConcurrency || 3}
            onChange={e => onLivestreamConfigChange?.({ ...livestreamConfig, maxConcurrency: parseInt(e.target.value) || 3 })}
          />

          <button
            style={styles.liveBtn(livestreamRunning)}
            onClick={livestreamRunning ? onLivestreamStop : onLivestreamStart}
          >
            {livestreamRunning ? '停止' : '开播'}
          </button>
        </div>
      )}

      {/* Content area */}
      {isLive ? (
        /* Livestream danmaku view */
        <LivestreamMessages
          messages={livestreamMessages}
          playingSeq={playingSeq}
          spokenSeqs={spokenSeqs}
          isHistory={isViewingHistory}
        />
      ) : (
        /* Chat messages view */
        <>
          <div style={styles.messages}>
            {messages.length === 0 && (
              <div style={{ color: '#555', textAlign: 'center', marginTop: 40, fontSize: 12 }}>
                发送消息开始与数字分身对话
              </div>
            )}
            {messages.map((m, i) => {
              if (delayedMessages.has(i)) return null;
              return (
                <div key={i} style={
                  m.role === 'user' ? styles.userMsg :
                  m.role === 'assistant' ? styles.assistantMsg :
                  styles.systemMsg
                }>
                  {m.content || (m.streaming ? '...' : '')}
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div style={styles.inputBar}>
            <input
              style={styles.input}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入消息..."
              disabled={!connected}
            />
            <button
              style={{ ...styles.sendBtn, opacity: streaming ? 0.5 : 1 }}
              onClick={handleSend}
              disabled={streaming || !connected}
            >
              发送
            </button>
          </div>
        </>
      )}
    </div>
  );
}
