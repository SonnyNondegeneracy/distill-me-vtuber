import React, { useState, useEffect, useRef } from 'react';

/**
 * Subtitle — Typewriter-style subtitle display.
 * Shows at the bottom center of the screen with a semi-transparent background.
 *
 * Props:
 *   text     — full text to display
 *   fontSize — font size in pixels
 */
export default function Subtitle({ text = '', fontSize = 28 }) {
  const [displayed, setDisplayed] = useState('');
  const prevTextRef = useRef('');
  const charIndexRef = useRef(0);
  const timerRef = useRef(null);

  useEffect(() => {
    // If text changed (new response), reset typewriter
    if (text !== prevTextRef.current) {
      // If text starts with previous text, continue from where we left off
      if (text.startsWith(prevTextRef.current) && prevTextRef.current.length > 0) {
        // Streaming — just update, show all available text
        setDisplayed(text);
      } else {
        // New text entirely — reset
        charIndexRef.current = 0;
        setDisplayed('');

        // Start typewriter for non-streaming case
        clearInterval(timerRef.current);
        if (text) {
          timerRef.current = setInterval(() => {
            charIndexRef.current++;
            if (charIndexRef.current >= text.length) {
              clearInterval(timerRef.current);
            }
            setDisplayed(text.slice(0, charIndexRef.current));
          }, 50);
        }
      }
      prevTextRef.current = text;
    }

    return () => clearInterval(timerRef.current);
  }, [text]);

  if (!displayed) return null;

  // Show only last ~100 chars to keep subtitle concise
  const truncated = displayed.length > 100
    ? '...' + displayed.slice(-100)
    : displayed;

  return (
    <div style={{
      position: 'absolute',
      bottom: 40,
      left: '50%',
      transform: 'translateX(-50%)',
      maxWidth: '80%',
      padding: '12px 24px',
      background: 'rgba(0, 0, 0, 0.6)',
      borderRadius: 12,
      color: '#fff',
      fontSize,
      lineHeight: 1.4,
      textAlign: 'center',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    }}>
      {truncated}
    </div>
  );
}
