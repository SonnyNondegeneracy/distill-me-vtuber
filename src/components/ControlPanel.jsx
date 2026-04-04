import React, { useState, useEffect, useRef } from 'react';
import ChatPanel from './ChatPanel.jsx';
import ConversationSidebar from './ConversationSidebar.jsx';
import AvatarContainer from './AvatarContainer.jsx';
import ModelControls from './ModelControls.jsx';
import VoiceControls from './VoiceControls.jsx';
import Settings from './Settings.jsx';
import DistillPanel from './DistillPanel.jsx';
import useTTS from '../hooks/useTTS.js';
import useLipSync from '../hooks/useLipSync.js';
import useChat from '../hooks/useChat.js';

const TABS = [
  { id: 'voice', label: '语音' },
  { id: 'model', label: '模型' },
  { id: 'distill', label: '蒸馏' },
  { id: 'settings', label: '设置' },
];

const tabBarStyle = {
  display: 'flex',
  gap: 0,
  borderBottom: '1px solid #333',
  marginBottom: 10,
};

function TabButton({ active, label, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: '8px 0',
        fontSize: 12,
        fontWeight: active ? 600 : 400,
        color: active ? '#ccc' : '#666',
        background: active ? '#1a1a2e' : 'transparent',
        border: 'none',
        borderBottom: active ? '2px solid #5a5aaa' : '2px solid transparent',
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}
    >
      {label} {active ? '\u25BE' : ''}
    </button>
  );
}


export default function ControlPanel() {
  const { speak, stop: stopTTS, speaking, audioRef, unlock } = useTTS();
  const { mouthRef: lipSyncMouthRef, connectAudio } = useLipSync();
  const chat = useChat();
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [settings, setSettings] = useState(null);
  const [activeTab, setActiveTab] = useState(null);

  // Model control state
  const [cameraOverrides, setCameraOverrides] = useState(null);
  const [poseOverrides, setPoseOverrides] = useState({ headYaw: 0, headPitch: 0, bodyYaw: 0, bodyLean: 0 });
  const [expressionOverride, setExpressionOverride] = useState(null);
  const [expressionBlend, setExpressionBlend] = useState(null);
  const [actionOverride, setActionOverride] = useState(null);
  const [idleConfig, setIdleConfig] = useState({ headSway: true, blinkInterval: 4 });
  const modelSaveTimerRef = useRef(null);

  // Voice control state
  const [voiceParams, setVoiceParams] = useState({ rate: 1, pitch: 1, volume: 50, delay: 0, ttsMode: 'full' });

  // Identity state
  const [identity, setIdentity] = useState('auto');

  // Chat area mode: 'chat' or 'live'
  const [chatAreaMode, setChatAreaMode] = useState('chat');

  // Livestream state
  const [livestreamConfig, setLivestreamConfig] = useState({ source: 'bilibili', roomId: '', maxConcurrency: 3 });
  const [livestreamRunning, setLivestreamRunning] = useState(false);
  const [playingSeq, setPlayingSeq] = useState(null);
  const [spokenSeqs, setSpokenSeqs] = useState(new Set());

  // Auto-play queue for livestream
  const playQueueRef = useRef([]);
  const isPlayingRef = useRef(false);
  const lastEnqueuedSeqRef = useRef(-1);

  // Load settings
  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(s => {
        setSettings(s);
        if (s.model?.camera) setCameraOverrides(s.model.camera);
        if (s.model?.pose) setPoseOverrides(prev => ({ ...prev, ...s.model.pose }));
        if (s.model?.idle) setIdleConfig(prev => ({ ...prev, ...s.model.idle }));
        if (s.voice) setVoiceParams(prev => ({ ...prev, ...s.voice }));
        if (s.livestream) {
          setLivestreamConfig(prev => ({
            ...prev,
            source: s.livestream.source || prev.source,
            roomId: s.livestream.roomId || prev.roomId,
            maxConcurrency: s.livestream.maxConcurrency || prev.maxConcurrency,
          }));
        }
      })
      .catch(console.error);
    // Check livestream status
    fetch('/api/livestream/status').then(r => r.json())
      .then(d => setLivestreamRunning(d.running))
      .catch(() => {});
  }, []);

  // Reset expressions when speech ends
  useEffect(() => {
    if (!speaking) {
      setExpressionBlend(null);
      setActionOverride(null);
    }
  }, [speaking]);

  // Auto-save model settings (debounced)
  useEffect(() => {
    if (!cameraOverrides && !poseOverrides && !idleConfig) return;
    clearTimeout(modelSaveTimerRef.current);
    modelSaveTimerRef.current = setTimeout(() => {
      fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: {
            camera: cameraOverrides || { offsetY: 1.2, offsetX: 0, distance: 3 },
            pose: poseOverrides,
            idle: idleConfig,
          },
        }),
      }).catch(console.error);
    }, 500);
  }, [cameraOverrides, poseOverrides, idleConfig]);

  // Build VRM URL
  const vrmUrl = settings?.avatar?.modelPath
    ? '/api/assets/' + settings.avatar.modelPath
        .replace(/^\//, '')
        .split('/')
        .map(seg => encodeURIComponent(seg))
        .join('/')
    : null;

  const handleResponseDone = (text) => {
    if (!ttsEnabled || !text) return;
    const delay = voiceParams.delay || 0;
    const doSpeak = () => speak(
      text,
      voiceParams,
      (expressions, action) => {
        console.log('[ControlPanel] expressions:', expressions, 'action:', action);
        setExpressionBlend(expressions);
        if (action) {
          setActionOverride(action);
          setTimeout(() => setActionOverride(null), 4000);
        }
      },
      (audio) => {
        connectAudio(audio);
      },
    );
    if (delay > 0) {
      setTimeout(doSpeak, delay);
    } else {
      doSpeak();
    }
  };

  const playNext = () => {
    if (isPlayingRef.current || playQueueRef.current.length === 0) return;
    isPlayingRef.current = true;
    const msg = playQueueRef.current.shift();

    // Audio + expressions start immediately
    if (msg.expressions) setExpressionBlend(msg.expressions);
    if (msg.action) {
      setActionOverride(msg.action);
      setTimeout(() => setActionOverride(null), 4000);
    }
    setPlayingSeq(msg.seq);

    // Reply subtitle appears after at least 3s from danmaku arrival (decoupled from audio)
    const elapsed = Date.now() - (msg.receivedAt || 0);
    const subtitleDelay = Math.max(0, 3000 - elapsed);
    setTimeout(() => setSpokenSeqs(prev => new Set(prev).add(msg.seq)), subtitleDelay);

    if (msg.audioUrl && ttsEnabled) {
      if (!audioRef.current) {
        audioRef.current = new Audio();
        audioRef.current.crossOrigin = 'anonymous';
      }
      const audio = audioRef.current;
      audio.pause();
      connectAudio(audio);

      if (audio.src?.startsWith('blob:')) {
        URL.revokeObjectURL(audio.src);
      }

      fetch(msg.audioUrl)
        .then(r => r.blob())
        .then(blob => {
          const url = URL.createObjectURL(blob);
          audio.src = url;
          audio.volume = 1;
          audio.onended = () => {
            isPlayingRef.current = false;
            setPlayingSeq(null);
            setExpressionBlend(null);
            URL.revokeObjectURL(url);
            playNext();
          };
          audio.onerror = () => {
            isPlayingRef.current = false;
            setPlayingSeq(null);
            URL.revokeObjectURL(url);
            playNext();
          };
          audio.play().catch(() => {
            isPlayingRef.current = false;
            setPlayingSeq(null);
            URL.revokeObjectURL(url);
            playNext();
          });
        })
        .catch(() => {
          isPlayingRef.current = false;
          setPlayingSeq(null);
          playNext();
        });
    } else {
      setTimeout(() => {
        isPlayingRef.current = false;
        setPlayingSeq(null);
        setExpressionBlend(null);
        playNext();
      }, 2000);
    }
  };

  // Auto-enqueue new livestream_ready messages for playback
  useEffect(() => {
    const msgs = chat.livestreamMessages;
    if (msgs.length === 0) return;
    const latest = msgs[msgs.length - 1];
    if (latest.skipped || !latest.audioUrl) return;
    if (latest.seq <= lastEnqueuedSeqRef.current) return;
    lastEnqueuedSeqRef.current = latest.seq;
    playQueueRef.current.push(latest);
    playNext();
  }, [chat.livestreamMessages]);

  const handleLivestreamStart = async () => {
    try {
      // Save config first
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          livestream: {
            enabled: true,
            source: livestreamConfig.source,
            roomId: livestreamConfig.roomId,
            maxConcurrency: livestreamConfig.maxConcurrency,
            mode: voiceParams.ttsMode === 'fast' ? 'fast' : 'full',
          },
        }),
      });
      const resp = await fetch('/api/livestream/start', { method: 'POST' });
      const data = await resp.json();
      setLivestreamRunning(data.running);
      if (data.running) {
        chat.startLiveSession();
        // Reset play queue for new session
        playQueueRef.current = [];
        isPlayingRef.current = false;
        lastEnqueuedSeqRef.current = -1;
        setPlayingSeq(null);
        setSpokenSeqs(new Set());
      }
    } catch (err) {
      console.error('Livestream start error:', err);
    }
  };

  const handleLivestreamStop = async () => {
    try {
      await fetch('/api/livestream/stop', { method: 'POST' });
      setLivestreamRunning(false);
      chat.endLiveSession();
    } catch (err) {
      console.error('Livestream stop error:', err);
    }
  };

  const isLive = chatAreaMode === 'live';

  return (
    <div style={{
      display: 'flex',
      gap: 0,
      height: '100vh',
      padding: '20px 20px 20px 20px',
      boxSizing: 'border-box',
    }}>
      {/* Left: Avatar */}
      <div style={{ flexShrink: 0, marginRight: 10 }}>
        <AvatarContainer
          type={settings?.avatar?.type || 'vrm'}
          modelUrl={vrmUrl}
          mouthRef={lipSyncMouthRef}
          width={400}
          height={600}
          transparent={settings?.avatar?.transparent ?? false}
          cameraOverrides={cameraOverrides}
          poseOverrides={poseOverrides}
          expressionOverride={expressionBlend || expressionOverride}
          actionOverride={actionOverride}
          idleConfig={idleConfig}
        />
      </div>

      {/* Center: Header + Tabs + Chat */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', marginLeft: 10 }}>
        {/* Header */}
        <div style={{ marginBottom: 4 }}>
          <h1 style={{ fontSize: 28, margin: 0 }}>DistillMe <span style={{ color: '#7a7aee' }}>Live!</span></h1>
          <p style={{ color: '#888', fontSize: 16, marginBottom: 8, marginTop: 4 }}>
            定制AI控制台
          </p>
        </div>

        {/* Tab bar */}
        <div style={tabBarStyle}>
          {TABS.map(tab => (
            <TabButton
              key={tab.id}
              active={activeTab === tab.id}
              label={tab.label}
              onClick={() => setActiveTab(activeTab === tab.id ? null : tab.id)}
            />
          ))}
        </div>

        {/* Tab content */}
        {TABS.map(tab => (
          <div
            key={tab.id}
            style={{
              background: '#1a1a2e',
              border: '1px solid #333',
              borderRadius: '0 0 8px 8px',
              borderTop: 'none',
              padding: '12px',
              maxHeight: 300,
              overflowY: 'auto',
              marginBottom: 8,
              display: activeTab === tab.id ? 'block' : 'none',
            }}
          >
            {tab.id === 'voice' && <VoiceControls params={voiceParams} onParamsChange={setVoiceParams} />}
            {tab.id === 'model' && (
              <ModelControls
                camera={cameraOverrides || { offsetY: 1.2, offsetX: 0, distance: 3 }}
                onCameraChange={setCameraOverrides}
                pose={poseOverrides}
                onPoseChange={setPoseOverrides}
                expression={expressionOverride}
                onExpressionChange={setExpressionOverride}
                idle={idleConfig}
                onIdleChange={setIdleConfig}
              />
            )}
            {tab.id === 'distill' && <DistillPanel currentSlug={settings?.persona?.slug || ''} />}
            {tab.id === 'settings' && <Settings />}
          </div>
        ))}

        {/* Chat area — supports 对话 and 直播 modes */}
        <ChatPanel
          chat={chat}
          ttsEnabled={ttsEnabled}
          onToggleTTS={() => { setTtsEnabled(!ttsEnabled); if (ttsEnabled) stopTTS(); }}
          onUserAction={unlock}
          onResponseDone={handleResponseDone}
          subtitleDelay={voiceParams.delay < 0 ? Math.abs(voiceParams.delay) : 0}
          chatMode={voiceParams.ttsMode === 'fast' ? 'fast' : 'full'}
          identity={identity}
          onIdentityChange={setIdentity}
          chatAreaMode={chatAreaMode}
          onChatAreaModeChange={setChatAreaMode}
          livestreamMessages={chat.livestreamMessages}
          playingSeq={playingSeq}
          spokenSeqs={spokenSeqs}
          livestreamConfig={livestreamConfig}
          onLivestreamConfigChange={setLivestreamConfig}
          livestreamRunning={livestreamRunning}
          onLivestreamStart={handleLivestreamStart}
          onLivestreamStop={handleLivestreamStop}
          isViewingHistory={isLive && chat.activeLiveSessionId && !livestreamRunning}
        />
      </div>

      {/* Right: Conversation + Livestream sidebar */}
      <ConversationSidebar
        conversations={chat.conversations}
        activeConvoId={chat.activeConvoId}
        onNew={chat.newConversation}
        onSwitch={chat.switchConversation}
        onDelete={chat.deleteConversation}
        liveSessions={chat.liveSessions}
        activeLiveSessionId={chat.activeLiveSessionId}
        onSwitchLive={chat.switchLiveSession}
        onDeleteLive={chat.deleteLiveSession}
        chatAreaMode={chatAreaMode}
        onChatAreaModeChange={setChatAreaMode}
      />
    </div>
  );
}
