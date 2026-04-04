import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { applyMouthOpenness, applyBlink, applyEmotion, applyExpressionBlend, resetExpressions, fadeExpressionsToNeutral } from '../lib/vrm-expressions.js';
import { createActionPlayer } from '../lib/vrm-actions.js';

export default function AvatarVRM({
  modelUrl,
  mouthOpenness = 0,
  mouthRef: externalMouthRef,
  width = 400,
  height = 600,
  transparent = true,
  cameraOverrides,
  poseOverrides,
  expressionOverride,
  actionOverride,
  idleConfig,
}) {
  const canvasRef = useRef(null);
  const vrmRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const clockRef = useRef(new THREE.Clock());
  const blinkTimerRef = useRef(0);
  const blinkStateRef = useRef(0);
  const rafRef = useRef(null);
  const mouthRef = useRef(mouthOpenness);
  const cameraOverridesRef = useRef(cameraOverrides);
  const poseOverridesRef = useRef(poseOverrides);
  const expressionOverrideRef = useRef(expressionOverride);
  const actionOverrideRef = useRef(actionOverride);
  const actionPlayerRef = useRef(null);
  const idleConfigRef = useRef(idleConfig);
  const autoFrameRef = useRef({ y: 1.2, dist: 3 });
  const externalMouthRefStable = useRef(externalMouthRef);

  // Use external lip sync ref if provided, otherwise fall back to prop
  if (externalMouthRef) {
    externalMouthRefStable.current = externalMouthRef;
  } else {
    mouthRef.current = mouthOpenness;
  }
  cameraOverridesRef.current = cameraOverrides;
  poseOverridesRef.current = poseOverrides;
  expressionOverrideRef.current = expressionOverride;
  idleConfigRef.current = idleConfig;

  // Start new action when actionOverride changes
  if (actionOverride && actionOverride !== actionOverrideRef.current) {
    console.log('[AvatarVRM] new action:', actionOverride);
    actionPlayerRef.current = createActionPlayer(actionOverride);
  } else if (!actionOverride) {
    actionPlayerRef.current = null;
  }
  actionOverrideRef.current = actionOverride;

  // Setup scene (once)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: transparent,
      antialias: true,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    // Critical for PBR materials in Three.js r150+
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;

    if (transparent) renderer.setClearColor(0x000000, 0);
    else renderer.setClearColor(0x1a1a2e, 1);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Camera — wide enough to see full upper body, adjustable after model loads
    const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 50);
    camera.position.set(0, 1.2, 3);
    camera.lookAt(0, 1.0, 0);
    cameraRef.current = camera;

    // Lighting — bright enough to show material colors naturally
    const ambient = new THREE.AmbientLight(0xffffff, 1.1);
    scene.add(ambient);
    const directional = new THREE.DirectionalLight(0xfff8f0, 0.9);
    directional.position.set(1, 2, 3);
    scene.add(directional);
    // Soft fill from below-left
    const fill = new THREE.DirectionalLight(0xf0f0ff, 0.4);
    fill.position.set(-1, 0, 2);
    scene.add(fill);

    // Animation loop
    const animate = () => {
      rafRef.current = requestAnimationFrame(animate);

      const delta = clockRef.current.getDelta();
      const vrm = vrmRef.current;
      if (!vrm) {
        renderer.render(scene, camera);
        return;
      }

      const currentMouth = externalMouthRefStable.current
        ? externalMouthRefStable.current.current
        : mouthRef.current;
      applyMouthOpenness(vrm, currentMouth);

      // Expression override — supports blend object or single string
      const expr = expressionOverrideRef.current;
      if (expr) {
        if (typeof expr === 'object') {
          applyExpressionBlend(vrm, expr);
        } else {
          resetExpressions(vrm);
          applyEmotion(vrm, expr);
        }
        applyMouthOpenness(vrm, currentMouth); // re-apply mouth after reset
      } else {
        // No expression override — fade all emotion expressions toward 0
        fadeExpressionsToNeutral(vrm, delta);
      }

      const idle = idleConfigRef.current || {};
      const blinkInt = idle.blinkInterval || 4;

      // Random blink
      blinkTimerRef.current -= delta;
      if (blinkTimerRef.current <= 0) {
        blinkStateRef.current = 1;
        blinkTimerRef.current = blinkInt * 0.5 + Math.random() * blinkInt;
      }
      if (blinkStateRef.current > 0) {
        blinkStateRef.current -= delta * 8;
        if (blinkStateRef.current < 0) blinkStateRef.current = 0;
        applyBlink(vrm, blinkStateRef.current);
      }

      // Idle head sway + pose overrides
      const t = clockRef.current.elapsedTime;
      const pose = poseOverridesRef.current || {};
      const deg2rad = Math.PI / 180;
      if (vrm.humanoid) {
        const head = vrm.humanoid.getNormalizedBoneNode('head');
        if (head) {
          const swayY = (idle.headSway !== false) ? Math.sin(t * 0.3) * 0.05 : 0;
          const swayX = (idle.headSway !== false) ? Math.sin(t * 0.4) * 0.02 : 0;
          head.rotation.y = swayY + (pose.headYaw || 0) * deg2rad;
          head.rotation.x = swayX + (pose.headPitch || 0) * deg2rad;
        }
        const spine = vrm.humanoid.getNormalizedBoneNode('spine');
        if (spine) {
          const breathSpine = Math.sin(t * 0.8) * 0.005;
          spine.rotation.y = (pose.bodyYaw || 0) * deg2rad;
          spine.rotation.x = (pose.bodyLean || 0) * deg2rad + breathSpine;
        }
        // Breathing animation — chest bone gentle rise and fall
        const chest = vrm.humanoid.getNormalizedBoneNode('chest');
        if (chest) {
          const breathPhase = Math.sin(t * 0.8) * 0.01;
          chest.rotation.x = breathPhase;
        }
        // Actions — tick and apply, may override arm bones
        const actionPlayer = actionPlayerRef.current;
        let actionOverridingArms = false;
        if (actionPlayer?.active) {
          actionPlayer.tick(delta);
          actionOverridingArms = actionPlayer.apply(vrm);
        }
        // Arms — default from T-pose to natural resting position (skip if action overrides)
        if (!actionOverridingArms) {
          const leftArm = vrm.humanoid.getNormalizedBoneNode('leftUpperArm');
          if (leftArm) leftArm.rotation.z = (pose.leftArmZ ?? 70) * deg2rad;
          const rightArm = vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
          if (rightArm) rightArm.rotation.z = (pose.rightArmZ ?? -70) * deg2rad;
          const leftForearm = vrm.humanoid.getNormalizedBoneNode('leftLowerArm');
          if (leftForearm) leftForearm.rotation.y = (pose.leftForearmY ?? 0) * deg2rad;
          const rightForearm = vrm.humanoid.getNormalizedBoneNode('rightLowerArm');
          if (rightForearm) rightForearm.rotation.y = (pose.rightForearmY ?? 0) * deg2rad;
        }
      }

      // Camera overrides
      const cam = cameraOverridesRef.current;
      if (cam && cameraRef.current) {
        const af = autoFrameRef.current;
        const cy = cam.offsetY ?? af.y;
        const cx = cam.offsetX ?? 0;
        const cd = cam.distance ?? af.dist;
        cameraRef.current.position.set(cx, cy, cd);
        cameraRef.current.lookAt(cx, cy, 0);
      }

      vrm.update(delta);
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(rafRef.current);
      renderer.dispose();
    };
  }, [width, height, transparent]);

  // Load VRM model
  useEffect(() => {
    if (!modelUrl || !sceneRef.current) return;

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    // Clear previous model
    if (vrmRef.current) {
      VRMUtils.deepDispose(vrmRef.current.scene);
      sceneRef.current.remove(vrmRef.current.scene);
      vrmRef.current = null;
    }

    console.log('Loading VRM from:', modelUrl);

    loader.load(
      modelUrl,
      (gltf) => {
        const vrm = gltf.userData.vrm;
        if (!vrm) {
          console.error('VRM not found in GLTF userData');
          return;
        }

        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        VRMUtils.removeUnnecessaryJoints(gltf.scene);

        // VRM models face +Z by default, rotate to face camera
        vrm.scene.rotation.y = Math.PI;

        sceneRef.current.add(vrm.scene);
        vrmRef.current = vrm;

        // Diagnostic: log available bones and expressions
        if (vrm.humanoid) {
          const bones = [];
          for (const name of ['head', 'spine', 'chest', 'upperChest', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm']) {
            const node = vrm.humanoid.getNormalizedBoneNode(name);
            bones.push(name + ':' + (node ? 'YES' : 'NO'));
          }
          console.log('[VRM] Bones:', bones.join(', '));
        }
        if (vrm.expressionManager) {
          const exprs = [];
          for (const name of ['happy', 'sad', 'angry', 'relaxed', 'surprised', 'neutral', 'aa', 'blink']) {
            const expr = vrm.expressionManager.getExpression(name);
            exprs.push(name + ':' + (expr ? 'YES' : 'NO'));
          }
          console.log('[VRM] Expressions:', exprs.join(', '));
        } else {
          console.warn('[VRM] No expressionManager found!');
        }

        // Auto-frame: compute bounding box and adjust camera
        const box = new THREE.Box3().setFromObject(vrm.scene);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        console.log('VRM bounds:', { size, center });

        // Position camera to frame upper body (head + torso)
        const camera = cameraRef.current;
        if (camera) {
          // Look at upper body center
          const lookY = center.y + size.y * 0.15;
          const dist = size.y * 1.8;
          autoFrameRef.current = { y: lookY, dist };
          // Only apply auto-frame if no camera overrides
          if (!cameraOverridesRef.current) {
            camera.position.set(0, lookY, dist);
            camera.lookAt(0, lookY, 0);
          }
        }

        console.log('VRM loaded successfully');
      },
      (progress) => {
        if (progress.total) {
          const pct = Math.round((progress.loaded / progress.total) * 100);
          if (pct % 25 === 0) console.log(`VRM loading: ${pct}%`);
        }
      },
      (err) => console.error('VRM load error:', err),
    );
  }, [modelUrl]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ display: 'block', borderRadius: 8 }}
    />
  );
}
