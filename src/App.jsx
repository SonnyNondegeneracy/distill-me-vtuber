import React from 'react';
import ControlPanel from './components/ControlPanel.jsx';
import Overlay from './overlay/Overlay.jsx';

const params = new URLSearchParams(window.location.search);
const isOverlay = params.get('mode') === 'overlay';

export default function App() {
  if (isOverlay) {
    return <Overlay />;
  }

  return (
    <div style={{
      fontFamily: '-apple-system, "Segoe UI", Roboto, sans-serif',
      color: '#e0e0e0',
      background: '#1a1a2e',
      minHeight: '100vh',
    }}>
      <ControlPanel />
    </div>
  );
}
