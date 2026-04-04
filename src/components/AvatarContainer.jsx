import React from 'react';
import AvatarVRM from './AvatarVRM.jsx';

/**
 * AvatarContainer — Unified avatar interface.
 *
 * Props:
 *   type          — 'vrm' (future: 'live2d')
 *   modelUrl      — URL to model file
 *   mouthOpenness — 0-1 lip sync value
 *   expression    — emotion string
 *   width/height  — dimensions
 *   transparent   — transparent background for OBS
 *
 * This component abstracts the avatar renderer so that VRM and
 * future Live2D implementations share the same interface.
 */
export default function AvatarContainer({
  type = 'vrm',
  modelUrl,
  mouthOpenness = 0,
  mouthRef,
  expression = 'neutral',
  width = 400,
  height = 600,
  transparent = true,
  cameraOverrides,
  poseOverrides,
  expressionOverride,
  actionOverride,
  idleConfig,
}) {
  if (type === 'vrm') {
    return (
      <AvatarVRM
        modelUrl={modelUrl}
        mouthOpenness={mouthOpenness}
        mouthRef={mouthRef}
        expression={expression}
        width={width}
        height={height}
        transparent={transparent}
        cameraOverrides={cameraOverrides}
        poseOverrides={poseOverrides}
        expressionOverride={expressionOverride}
        actionOverride={actionOverride}
        idleConfig={idleConfig}
      />
    );
  }

  // Placeholder for Live2D (Phase future)
  return (
    <div style={{
      width,
      height,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: transparent ? 'transparent' : '#1a1a2e',
      color: '#666',
      fontSize: 12,
      borderRadius: 8,
    }}>
      Live2D renderer not yet implemented
    </div>
  );
}
