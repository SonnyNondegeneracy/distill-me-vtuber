import React, { useState } from 'react';

/**
 * ConversationSidebar — vertical sidebar showing conversation and livestream history.
 */
export default function ConversationSidebar({
  conversations, activeConvoId, onNew, onSwitch, onDelete,
  liveSessions = [], activeLiveSessionId, onSwitchLive, onDeleteLive,
  chatAreaMode, onChatAreaModeChange,
}) {
  const [collapsed, setCollapsed] = useState(true);

  const totalCount = conversations.length + liveSessions.length;

  if (collapsed) {
    return (
      <div
        onClick={() => setCollapsed(false)}
        style={{
          width: 36,
          flexShrink: 0,
          background: '#151528',
          borderLeft: '1px solid #333',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          writingMode: 'vertical-rl',
          fontSize: 12,
          color: '#777',
          userSelect: 'none',
          letterSpacing: 2,
        }}
      >
        记录 ({totalCount})
      </div>
    );
  }

  return (
    <div style={{
      width: 220,
      flexShrink: 0,
      background: '#151528',
      borderLeft: '1px solid #333',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '10px 10px 8px',
        borderBottom: '1px solid #2a2a3a',
      }}>
        <span style={{ fontSize: 12, color: '#aaa', fontWeight: 600 }}>历史记录</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={onNew}
            style={{
              padding: '4px 10px', fontSize: 12,
              border: '1px solid #5a5aaa', borderRadius: 4,
              background: 'transparent', color: '#5a5aaa',
              cursor: 'pointer', fontWeight: 600,
            }}
            title="新会话"
          >+</button>
          <button
            onClick={() => setCollapsed(true)}
            style={{
              padding: '4px 10px', fontSize: 12,
              border: '1px solid #444', borderRadius: 4,
              background: 'transparent', color: '#777',
              cursor: 'pointer',
            }}
            title="收起"
          >&gt;</button>
        </div>
      </div>

      {/* Scrollable list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
        {/* 会话记录 */}
        <div style={{ padding: '4px 10px', fontSize: 12, color: '#666', fontWeight: 600 }}>
          会话 ({conversations.length})
        </div>
        {conversations.length === 0 && (
          <div style={{ padding: '8px 10px', fontSize: 12, color: '#444' }}>
            发送消息自动创建
          </div>
        )}
        {conversations.map(c => {
          const active = chatAreaMode === 'chat' && activeConvoId === c.id;
          return (
            <div
              key={c.id}
              onClick={() => { onSwitch(c.id); onChatAreaModeChange?.('chat'); }}
              style={{
                padding: '8px 10px',
                fontSize: 12,
                color: active ? '#e0e0e0' : '#777',
                background: active ? '#2a2a5a' : 'transparent',
                borderRight: active ? '3px solid #7a7aee' : '3px solid transparent',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 6,
                fontWeight: active ? 600 : 400,
                transition: 'all 0.15s',
              }}
            >
              <span style={{
                flex: 1, overflow: 'hidden', textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {c.title || '新会话'}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}
                style={{
                  padding: '2px 6px', fontSize: 12, border: 'none',
                  background: 'transparent', color: active ? '#888' : '#555',
                  cursor: 'pointer', flexShrink: 0, opacity: 0.7,
                  borderRadius: 3,
                }}
                title="删除"
              >x</button>
            </div>
          );
        })}

        {/* 直播记录 */}
        <div style={{ padding: '4px 10px', fontSize: 12, color: '#666', fontWeight: 600, marginTop: 8 }}>
          直播 ({liveSessions.length})
        </div>
        {liveSessions.length === 0 && (
          <div style={{ padding: '8px 10px', fontSize: 12, color: '#444' }}>
            开播后自动记录
          </div>
        )}
        {liveSessions.map(s => {
          const active = chatAreaMode === 'live' && activeLiveSessionId === s.id;
          return (
            <div
              key={s.id}
              onClick={() => { onSwitchLive?.(s.id); onChatAreaModeChange?.('live'); }}
              style={{
                padding: '8px 10px',
                fontSize: 12,
                color: active ? '#e0e0e0' : '#777',
                background: active ? '#2a3a2a' : 'transparent',
                borderRight: active ? '3px solid #7aee7a' : '3px solid transparent',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 6,
                fontWeight: active ? 600 : 400,
                transition: 'all 0.15s',
              }}
            >
              <span style={{
                flex: 1, overflow: 'hidden', textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {s.title}
                <span style={{ color: '#555', marginLeft: 4 }}>{s.messages?.length || 0}条</span>
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); onDeleteLive?.(s.id); }}
                style={{
                  padding: '2px 6px', fontSize: 12, border: 'none',
                  background: 'transparent', color: active ? '#888' : '#555',
                  cursor: 'pointer', flexShrink: 0, opacity: 0.7,
                  borderRadius: 3,
                }}
                title="删除"
              >x</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
