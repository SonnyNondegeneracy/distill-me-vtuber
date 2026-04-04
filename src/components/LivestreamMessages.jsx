import React, { useRef, useEffect } from 'react';

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    flex: 1,
    overflowY: 'auto',
    padding: '12px 0',
  },
  // User danmaku — right side (same as ChatPanel.userMsg)
  danmaku: {
    alignSelf: 'flex-end',
    background: '#4a4a8a',
    padding: '10px 16px',
    borderRadius: '16px 16px 4px 16px',
    maxWidth: '70%',
    fontSize: 16,
    lineHeight: 1.5,
  },
  danmakuUser: {
    fontSize: 12,
    color: '#b0b0e0',
    marginBottom: 2,
    textAlign: 'right',
  },
  // VTuber reply — left side (same as ChatPanel.assistantMsg)
  reply: {
    alignSelf: 'flex-start',
    background: '#2a2a4a',
    padding: '10px 16px',
    borderRadius: '16px 16px 16px 4px',
    maxWidth: '70%',
    fontSize: 16,
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
  },
  replyPlaying: {
    borderLeft: '3px solid #7aee7a',
    background: '#1e2e1e',
  },
  tags: {
    display: 'flex',
    gap: 4,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  tag: {
    fontSize: 12,
    padding: '1px 6px',
    borderRadius: 4,
    background: '#2a2a4a',
    color: '#8888cc',
  },
  empty: {
    color: '#555',
    textAlign: 'center',
    padding: '40px 0',
    fontSize: 12,
  },
};

export default function LivestreamMessages({ messages = [], playingSeq, spokenSeqs = new Set(), isHistory = false }) {
  const listRef = useRef(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages.length, spokenSeqs, playingSeq]);

  if (messages.length === 0) {
    return (
      <div style={styles.container}>
        <div style={styles.empty}>
          等待直播弹幕...
          <br />
          <span style={{ fontSize: 12, color: '#444' }}>
            点击"开播"后弹幕和AI回复会显示在这里
          </span>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.list} ref={listRef}>
        {messages.map((msg) => {
          const isPlaying = playingSeq === msg.seq;

          return (
            <React.Fragment key={`${msg.seq}-${msg.skipped ? 's' : 'r'}`}>
              {/* User danmaku bubble — right */}
              <div style={styles.danmaku}>
                <div style={styles.danmakuUser}>
                  {msg.source && <span style={{ marginRight: 4, opacity: 0.6 }}>{msg.source}</span>}
                  {msg.user}
                </div>
                {msg.text}
              </div>

              {/* VTuber reply bubble — left (only when speaking/spoken, or viewing history) */}
              {!msg.skipped && msg.responseText && (isHistory || spokenSeqs.has(msg.seq)) && (
                <div style={{ ...styles.reply, ...(isPlaying ? styles.replyPlaying : {}) }}>
                  {msg.responseText}
                  {(msg.expressions || msg.action || msg.emotion) && (
                    <div style={styles.tags}>
                      {msg.emotion && <span style={styles.tag}>{msg.emotion}</span>}
                      {msg.action && (
                        <span style={{ ...styles.tag, background: '#2a3a2a', color: '#88cc88' }}>{msg.action}</span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
