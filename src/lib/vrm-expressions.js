/**
 * vrm-expressions.js — VRM blend shape / expression helpers
 *
 * Maps high-level expression names to VRM expression presets.
 * Compatible with @pixiv/three-vrm v3 ExpressionManager.
 */

// VRM 1.0 expression preset names
export const EXPRESSIONS = {
  neutral: 'neutral',
  happy: 'happy',
  angry: 'angry',
  sad: 'sad',
  relaxed: 'relaxed',
  surprised: 'surprised',
  aa: 'aa',     // mouth open
  ih: 'ih',
  ou: 'ou',
  ee: 'ee',
  oh: 'oh',
  blink: 'blink',
  blinkLeft: 'blinkLeft',
  blinkRight: 'blinkRight',
};

/**
 * Apply mouth openness to VRM model.
 * Maps a 0-1 value to the 'aa' (mouth open) expression.
 */
export function applyMouthOpenness(vrm, value) {
  if (!vrm?.expressionManager) return;
  vrm.expressionManager.setValue('aa', Math.max(0, Math.min(1, value)));
}

/**
 * Apply a blink to VRM model.
 */
export function applyBlink(vrm, value) {
  if (!vrm?.expressionManager) return;
  vrm.expressionManager.setValue('blink', Math.max(0, Math.min(1, value)));
}

/**
 * Apply an emotion expression to VRM model.
 */
export function applyEmotion(vrm, emotion, value = 1) {
  if (!vrm?.expressionManager) return;
  if (EXPRESSIONS[emotion]) {
    vrm.expressionManager.setValue(EXPRESSIONS[emotion], Math.max(0, Math.min(1, value)));
  }
}

/**
 * Reset all expressions to neutral.
 */
export function resetExpressions(vrm) {
  if (!vrm?.expressionManager) return;
  for (const name of Object.values(EXPRESSIONS)) {
    vrm.expressionManager.setValue(name, 0);
  }
}

// VRM emotion expression preset names
const EMOTION_EXPRESSIONS = new Set(['happy', 'angry', 'sad', 'relaxed', 'surprised', 'neutral']);

/**
 * Smoothly fade all emotion expressions toward 0.
 * Call each frame when no expression override is active.
 * @param {number} delta — frame delta in seconds
 * @param {number} speed — fade speed (higher = faster), default ~3s to fully fade
 */
export function fadeExpressionsToNeutral(vrm, delta, speed = 3) {
  if (!vrm?.expressionManager) return;
  for (const name of EMOTION_EXPRESSIONS) {
    const current = vrm.expressionManager.getValue(name) || 0;
    if (current > 0.001) {
      vrm.expressionManager.setValue(name, Math.max(0, current - delta * speed));
    } else if (current !== 0) {
      vrm.expressionManager.setValue(name, 0);
    }
  }
}

/**
 * Apply a blend of multiple emotion expressions simultaneously.
 * @param {object} vrm — VRM model
 * @param {object} blendMap — e.g. { happy: 0.7, surprised: 0.3 }
 */
export function applyExpressionBlend(vrm, blendMap) {
  if (!vrm?.expressionManager) return;
  // Clear all emotion expressions first
  for (const name of EMOTION_EXPRESSIONS) {
    vrm.expressionManager.setValue(name, 0);
  }
  // Apply blend values
  for (const [name, value] of Object.entries(blendMap)) {
    if (EMOTION_EXPRESSIONS.has(name)) {
      vrm.expressionManager.setValue(name, Math.max(0, Math.min(1, value)));
    }
  }
}
