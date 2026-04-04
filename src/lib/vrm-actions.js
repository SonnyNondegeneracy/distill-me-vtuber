/**
 * vrm-actions.js — Registered VRM body actions (animations)
 *
 * Each action is a function(vrm, t, progress) where:
 *   - vrm: the VRM model
 *   - t: elapsed time (seconds)
 *   - progress: 0→1 over the action duration
 *
 * Returns bone overrides that the animation loop should apply.
 * Actions have a duration and an easing curve.
 */

const deg2rad = Math.PI / 180;

/**
 * Smooth ease-in-out curve.
 */
function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

/**
 * Action registry — add new actions here.
 * Each action: { duration (seconds), apply(vrm, progress) }
 *
 * progress goes 0→1 over duration. The apply function sets bone rotations.
 * It should handle its own ease-in / hold / ease-out within 0→1.
 */
const ACTION_REGISTRY = {
  raiseArms: {
    duration: 2.5,
    apply(vrm, progress) {
      if (!vrm.humanoid) return;

      // Phase: 0-0.3 raise, 0.3-0.7 hold, 0.7-1.0 lower
      let blend;
      if (progress < 0.3) {
        blend = easeInOut(progress / 0.3);
      } else if (progress < 0.7) {
        blend = 1;
      } else {
        blend = easeInOut(1 - (progress - 0.7) / 0.3);
      }

      // Raise upper arms from resting (~70deg) to raised (~20deg from horizontal)
      const restZ = 70;
      const raisedZ = 20;
      const targetZ = restZ - (restZ - raisedZ) * blend;

      const leftArm = vrm.humanoid.getNormalizedBoneNode('leftUpperArm');
      if (leftArm) leftArm.rotation.z = targetZ * deg2rad;
      const rightArm = vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
      if (rightArm) rightArm.rotation.z = -targetZ * deg2rad;

      // Slightly bend forearms during raise
      const forearmBend = blend * -20;
      const leftForearm = vrm.humanoid.getNormalizedBoneNode('leftLowerArm');
      if (leftForearm) leftForearm.rotation.y = forearmBend * deg2rad;
      const rightForearm = vrm.humanoid.getNormalizedBoneNode('rightLowerArm');
      if (rightForearm) rightForearm.rotation.y = -forearmBend * deg2rad;

      return true; // signals "I'm overriding arms, skip default arm pose"
    },
  },
};

export const VALID_ACTIONS = new Set(Object.keys(ACTION_REGISTRY));

/**
 * Get action definition by name.
 */
export function getAction(name) {
  return ACTION_REGISTRY[name] || null;
}

/**
 * Create an action playback state object.
 * Use in animation loop: call tick(delta) each frame, check .active, call .apply(vrm).
 */
export function createActionPlayer(actionName) {
  const action = ACTION_REGISTRY[actionName];
  if (!action) return null;

  let elapsed = 0;
  let active = true;

  return {
    get active() { return active; },
    get name() { return actionName; },
    tick(delta) {
      if (!active) return;
      elapsed += delta;
      if (elapsed >= action.duration) {
        active = false;
      }
    },
    apply(vrm) {
      if (!active) return false;
      const progress = Math.min(1, elapsed / action.duration);
      return action.apply(vrm, progress);
    },
  };
}
