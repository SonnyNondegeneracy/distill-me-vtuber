import React, { useState, useEffect, useRef } from 'react';
import AvatarContainer from '../components/AvatarContainer.jsx';
import Subtitle from '../components/Subtitle.jsx';
import useTTS from '../hooks/useTTS.js';
import useLipSync from '../hooks/useLipSync.js';

/**
 * Overlay — OBS Browser Source mode.
 * Transparent background, shows avatar + subtitle only.
 * Listens to the same WebSocket for response events from the control panel.
 */
export default function Overlay() {
  const { speak, speaking, audioRef } = useTTS();
  const { mouthOpenness, connectAudio } = useLipSync();
  const [settings, setSettings] = useState(null);
  const [subtitleText, setSubtitleText] = useState('');
  const [mouthValue, setMouthValue] = useState(0);
  const wsRef = useRef(null);
  const audioConnected = useRef(false);

  // Load settings
  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(setSettings)
      .catch(console.error);
  }, []);

  // Connect to WebSocket for broadcast events
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    let fullText = '';

    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);

      switch (data.type) {
        case 'response_start':
          fullText = '';
          setSubtitleText('');
          break;

        case 'chunk':
          fullText += data.text;
          setSubtitleText(fullText);
          break;

        case 'response_done':
          fullText = data.fullText;
          setSubtitleText(fullText);
          // Trigger TTS
          const clean = fullText.replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '').trim();
          if (clean) speak(clean);
          break;
      }
    };

    ws.onclose = () => {
      setTimeout(() => window.location.reload(), 5000);
    };

    wsRef.current = ws;
    return () => ws.close();
  }, [speak]);

  // Connect lip sync after first speak
  useEffect(() => {
    if (speaking && audioRef.current && !audioConnected.current) {
      connectAudio(audioRef.current);
      audioConnected.current = true;
    }
  }, [speaking, audioRef, connectAudio]);

  // Update mouth at 60fps
  useEffect(() => {
    let raf;
    const tick = () => {
      setMouthValue(mouthOpenness);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Encode path segments for Chinese characters
  const vrmUrl = settings?.avatar?.modelPath
    ? '/api/assets/' + settings.avatar.modelPath
        .replace(/^\//, '')
        .split('/')
        .map(seg => encodeURIComponent(seg))
        .join('/')
    : null;

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      background: 'transparent',
      overflow: 'hidden',
      position: 'relative',
    }}>
      {/* Avatar centered-bottom */}
      <div style={{
        position: 'absolute',
        bottom: 100,
        left: '50%',
        transform: 'translateX(-50%)',
      }}>
        <AvatarContainer
          type={settings?.avatar?.type || 'vrm'}
          modelUrl={vrmUrl}
          mouthOpenness={mouthValue}
          width={600}
          height={800}
          transparent={true}
        />
      </div>

      {/* Subtitle at bottom */}
      <Subtitle
        text={subtitleText}
        fontSize={settings?.subtitle?.fontSize || 28}
      />
    </div>
  );
}
