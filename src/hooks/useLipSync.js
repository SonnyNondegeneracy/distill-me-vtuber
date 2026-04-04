import { useRef, useEffect, useCallback } from 'react';
import { LipSyncAnalyzer } from '../lib/lip-sync-analyzer.js';

/**
 * useLipSync — connects an Audio element to lip sync analysis.
 * Returns { mouthOpenness, connectAudio, analyzerRef }
 *
 * The mouthOpenness value updates every frame via requestAnimationFrame.
 * Pass it to AvatarVRM to drive the mouth blend shape.
 */
export default function useLipSync() {
  const analyzerRef = useRef(null);
  const mouthRef = useRef(0);
  const rafRef = useRef(null);

  useEffect(() => {
    analyzerRef.current = new LipSyncAnalyzer();

    const tick = () => {
      mouthRef.current = analyzerRef.current?.getMouthOpenness() || 0;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      analyzerRef.current?.dispose();
    };
  }, []);

  const connectAudio = useCallback((audioElement) => {
    analyzerRef.current?.connectAudio(audioElement);
  }, []);

  return {
    mouthRef: analyzerRef.current ? mouthRef : mouthRef,
    get mouthOpenness() { return mouthRef.current; },
    connectAudio,
    analyzerRef,
  };
}
