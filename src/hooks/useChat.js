import { useState, useEffect, useRef, useCallback } from 'react';

const STORAGE_KEY = 'distillme-conversations';
const ACTIVE_KEY = 'distillme-active-conversation';
const LIVE_STORAGE_KEY = 'distillme-livestream-sessions';
const ACTIVE_LIVE_KEY = 'distillme-active-livestream';

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function loadConversations() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch { return []; }
}

function saveConversations(convos) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(convos));
}

function getActiveId() {
  return localStorage.getItem(ACTIVE_KEY) || null;
}

function setActiveId(id) {
  if (id) localStorage.setItem(ACTIVE_KEY, id);
  else localStorage.removeItem(ACTIVE_KEY);
}

function loadLiveSessions() {
  try {
    return JSON.parse(localStorage.getItem(LIVE_STORAGE_KEY) || '[]');
  } catch { return []; }
}

function saveLiveSessions(sessions) {
  localStorage.setItem(LIVE_STORAGE_KEY, JSON.stringify(sessions));
}

function getActiveLiveId() {
  return localStorage.getItem(ACTIVE_LIVE_KEY) || null;
}

function setActiveLiveId(id) {
  if (id) localStorage.setItem(ACTIVE_LIVE_KEY, id);
  else localStorage.removeItem(ACTIVE_LIVE_KEY);
}

export default function useChat() {
  const [conversations, setConversations] = useState(() => loadConversations());
  const [activeConvoId, setActiveConvoId] = useState(() => getActiveId());
  const [messages, setMessages] = useState([]);
  const [connected, setConnected] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [livestreamMessages, setLivestreamMessages] = useState([]);
  const wsRef = useRef(null);
  const currentResponseRef = useRef('');
  const activeConvoIdRef = useRef(activeConvoId);

  // Livestream session state
  const [liveSessions, setLiveSessions] = useState(() => loadLiveSessions());
  const [activeLiveSessionId, setActiveLiveSessionId] = useState(null);
  const activeLiveSessionIdRef = useRef(null);
  const liveRecordingRef = useRef(false); // true = currently recording a live session

  // Keep refs in sync
  activeConvoIdRef.current = activeConvoId;
  activeLiveSessionIdRef.current = activeLiveSessionId;

  // Load messages for active conversation
  useEffect(() => {
    if (activeConvoId) {
      const convo = conversations.find(c => c.id === activeConvoId);
      setMessages(convo?.messages || []);
    } else {
      setMessages([]);
    }
  }, [activeConvoId]);

  // Save messages to conversation whenever they change (debounced by streaming state)
  useEffect(() => {
    if (streaming) return; // don't save while streaming
    if (!activeConvoIdRef.current) return;
    const id = activeConvoIdRef.current;
    setConversations(prev => {
      const next = prev.map(c =>
        c.id === id ? { ...c, messages, updatedAt: Date.now() } : c
      );
      saveConversations(next);
      return next;
    });
  }, [messages, streaming]);

  // Persist livestream message to current session (auto-create if needed)
  const persistLiveMessage = useCallback((data) => {
    // Auto-create session if none active
    if (!activeLiveSessionIdRef.current || !liveRecordingRef.current) {
      const id = generateId();
      const now = new Date();
      const title = `直播 ${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const session = { id, title, messages: [], createdAt: Date.now(), updatedAt: Date.now() };
      setLiveSessions(prev => {
        const next = [session, ...prev];
        saveLiveSessions(next);
        return next;
      });
      setActiveLiveSessionId(id);
      setActiveLiveId(id);
      activeLiveSessionIdRef.current = id;
      liveRecordingRef.current = true;
    }

    const sessionId = activeLiveSessionIdRef.current;

    const msg = {
      seq: data.seq,
      user: data.user,
      source: data.source,
      text: data.text,
      responseText: data.responseText || null,
      skipped: data.skipped || false,
      timestamp: Date.now(),
    };

    setLiveSessions(prev => {
      const next = prev.map(s =>
        s.id === sessionId
          ? { ...s, messages: [...s.messages, msg], updatedAt: Date.now() }
          : s
      );
      saveLiveSessions(next);
      return next;
    });
  }, []);

  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      setTimeout(connect, 3000);
    };

    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);

      switch (data.type) {
        case 'memory':
          break;

        case 'chunk':
          currentResponseRef.current += data.text;
          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (last && last.role === 'assistant' && last.streaming) {
              return [...prev.slice(0, -1), { ...last, content: currentResponseRef.current }];
            }
            return prev;
          });
          break;

        case 'done':
          currentResponseRef.current = '';
          setStreaming(false);
          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (last && last.role === 'assistant') {
              return [...prev.slice(0, -1), { ...last, content: data.fullText, streaming: false }];
            }
            return prev;
          });
          break;

        case 'error':
          setStreaming(false);
          setMessages(prev => [...prev, { role: 'system', content: `Error: ${data.message}` }]);
          break;

        case 'livestream_ready': {
          const enriched = { ...data, receivedAt: Date.now() };
          setLivestreamMessages(prev => [...prev.slice(-99), enriched]);
          persistLiveMessage(data);
          break;
        }

        case 'livestream_skipped': {
          const enriched = { ...data, skipped: true, receivedAt: Date.now() };
          setLivestreamMessages(prev => [...prev.slice(-99), enriched]);
          persistLiveMessage({ ...data, skipped: true });
          break;
        }
      }
    };

    wsRef.current = ws;
  }, [persistLiveMessage]);

  useEffect(() => {
    connect();
    return () => wsRef.current?.close();
  }, [connect]);

  const sendMessage = useCallback((text, opts = {}) => {
    if (!wsRef.current || wsRef.current.readyState !== 1) return;

    // Auto-create conversation if none active
    if (!activeConvoIdRef.current) {
      const id = generateId();
      const title = text.slice(0, 30) + (text.length > 30 ? '...' : '');
      const convo = { id, title, messages: [], createdAt: Date.now(), updatedAt: Date.now() };
      setConversations(prev => {
        const next = [convo, ...prev];
        saveConversations(next);
        return next;
      });
      setActiveConvoId(id);
      setActiveId(id);
      activeConvoIdRef.current = id;
    }

    setMessages(prev => [
      ...prev,
      { role: 'user', content: text },
      { role: 'assistant', content: '', streaming: true },
    ]);
    setStreaming(true);
    currentResponseRef.current = '';

    const payload = { type: 'chat', message: text, mode: opts.mode || 'full' };
    if (opts.identity) payload.identity = opts.identity;
    wsRef.current.send(JSON.stringify(payload));
  }, []);

  // Conversation management
  const newConversation = useCallback(() => {
    setActiveConvoId(null);
    setActiveId(null);
    setMessages([]);
  }, []);

  const switchConversation = useCallback((id) => {
    const convo = conversations.find(c => c.id === id);
    if (convo) {
      setActiveConvoId(id);
      setActiveId(id);
      setMessages(convo.messages || []);
    }
  }, [conversations]);

  const deleteConversation = useCallback((id) => {
    setConversations(prev => {
      const next = prev.filter(c => c.id !== id);
      saveConversations(next);
      return next;
    });
    if (activeConvoId === id) {
      setActiveConvoId(null);
      setActiveId(null);
      setMessages([]);
    }
  }, [activeConvoId]);

  const renameConversation = useCallback((id, title) => {
    setConversations(prev => {
      const next = prev.map(c => c.id === id ? { ...c, title } : c);
      saveConversations(next);
      return next;
    });
  }, []);

  // Livestream session management
  const startLiveSession = useCallback(() => {
    const id = generateId();
    const now = new Date();
    const title = `直播 ${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const session = { id, title, messages: [], createdAt: Date.now(), updatedAt: Date.now() };
    setLiveSessions(prev => {
      const next = [session, ...prev];
      saveLiveSessions(next);
      return next;
    });
    setActiveLiveSessionId(id);
    setActiveLiveId(id);
    activeLiveSessionIdRef.current = id;
    liveRecordingRef.current = true;
    setLivestreamMessages([]);
  }, []);

  const endLiveSession = useCallback(() => {
    liveRecordingRef.current = false;
  }, []);

  const switchLiveSession = useCallback((id) => {
    // Read directly from localStorage to avoid stale closure issues
    const sessions = loadLiveSessions();
    const session = sessions.find(s => s.id === id);
    if (session) {
      setActiveLiveSessionId(id);
      setActiveLiveId(id);
      setLiveSessions(sessions); // sync state with localStorage
      // Load historical messages into livestreamMessages for display
      const historical = session.messages.map(m => ({
        ...m,
        receivedAt: m.timestamp,
      }));
      setLivestreamMessages(historical);
      liveRecordingRef.current = false; // viewing history, not recording
    }
  }, []);

  const deleteLiveSession = useCallback((id) => {
    setLiveSessions(prev => {
      const next = prev.filter(s => s.id !== id);
      saveLiveSessions(next);
      return next;
    });
    if (activeLiveSessionId === id) {
      setActiveLiveSessionId(null);
      setActiveLiveId(null);
      setLivestreamMessages([]);
    }
  }, [activeLiveSessionId]);

  return {
    messages,
    connected,
    streaming,
    sendMessage,
    livestreamMessages,
    conversations,
    activeConvoId,
    newConversation,
    switchConversation,
    deleteConversation,
    renameConversation,
    // Livestream sessions
    liveSessions,
    activeLiveSessionId,
    startLiveSession,
    endLiveSession,
    switchLiveSession,
    deleteLiveSession,
  };
}
