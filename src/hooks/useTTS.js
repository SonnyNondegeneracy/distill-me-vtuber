import { useState, useRef, useCallback } from 'react';

/**
 * useTTS — fetches TTS audio from server and plays it.
 *
 * Safari requires audio.play() to originate from a user gesture.
 * Call unlock() on any user click to enable future playback.
 */
export default function useTTS() {
  const audioRef = useRef(null);
  const [speaking, setSpeaking] = useState(false);
  const abortRef = useRef(null);
  const unlockedRef = useRef(false);

  const getAudio = useCallback(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.crossOrigin = 'anonymous';
    }
    return audioRef.current;
  }, []);

  // Call this from a click handler to unlock Safari audio
  const unlock = useCallback(() => {
    if (unlockedRef.current) return;
    const audio = getAudio();
    // Play a silent buffer to unlock the audio context
    audio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
    audio.volume = 0;
    audio.play().then(() => {
      audio.pause();
      audio.volume = 1;
      audio.currentTime = 0;
      unlockedRef.current = true;
      console.log('Audio unlocked for Safari');
    }).catch(() => {});
  }, [getAudio]);

  const speak = useCallback(async (text, voiceParams = {}, onExpressions, onAudioReady) => {
    if (!text?.trim()) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setSpeaking(true);
      const body = { text, polish: voiceParams.polish ?? true };
      if (voiceParams.rate != null) body.rate = voiceParams.rate;
      if (voiceParams.pitch != null) body.pitch = voiceParams.pitch;
      if (voiceParams.volume != null) body.volume = voiceParams.volume;

      const resp = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const err = await resp.text();
        console.error('TTS error:', resp.status, err);
        setSpeaking(false);
        return;
      }

      // Read expression blend and action from response headers
      const exprHeader = resp.headers.get('X-TTS-Expressions');
      const actionHeader = resp.headers.get('X-TTS-Action');
      console.log('[useTTS] headers — expressions:', exprHeader, 'action:', actionHeader);
      if (onExpressions) {
        const expressions = exprHeader ? JSON.parse(exprHeader) : null;
        const action = actionHeader || null;
        if (expressions || action) {
          try { onExpressions(expressions, action); } catch (e) { console.error('[useTTS] onExpressions error:', e); }
        }
      }

      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const audio = getAudio();

      if (audio.src?.startsWith('blob:')) {
        URL.revokeObjectURL(audio.src);
      }

      audio.src = url;
      audio.volume = 1;

      const cleanup = () => {
        setSpeaking(false);
        URL.revokeObjectURL(url);
        audio.onended = null;
        audio.onerror = null;
        audio.ontimeupdate = null;
      };

      audio.onended = cleanup;
      audio.onerror = (e) => {
        console.error('Audio playback error:', e);
        cleanup();
      };
      // Safari fallback: onended sometimes doesn't fire
      audio.ontimeupdate = () => {
        if (audio.currentTime >= audio.duration - 0.1) {
          cleanup();
        }
      };

      // Notify caller audio is ready — used for lip sync connection
      onAudioReady?.(audio);

      await audio.play();
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('TTS error:', err);
      }
      setSpeaking(false);
    }
  }, [getAudio]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setSpeaking(false);
  }, []);

  return { speak, stop, speaking, audioRef, unlock };
}
