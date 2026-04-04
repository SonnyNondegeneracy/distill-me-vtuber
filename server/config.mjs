/**
 * config.mjs — Settings persistence
 *
 * Reads/writes config.json in the project root (gitignored).
 *
 * Two separate API configs:
 *   - anthropic: LLM conversation (Claude)
 *   - dashscope: TTS only (CosyVoice)
 */

import { readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, '..', 'config.json');

const DEFAULTS = {
  distillMePath: join(__dirname, '..', '..', 'distill-me'),
  anthropic: {
    apiKey: process.env.ANTHROPIC_AUTH_TOKEN || '',
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
    model: 'claude-sonnet-4-20250514',
    polishModel: '',
  },
  dashscope: {
    apiKey: '',
    ttsModel: 'cosyvoice-v3-flash',
    voiceId: 'longanyang',
    clonedVoices: [],
  },
  voice: {
    rate: 1.0,
    pitch: 1.0,
    volume: 50,
    delay: 0,
    ttsMode: 'full',
  },
  persona: {
    slug: '',
    userId: '',
  },
  avatar: {
    type: 'vrm',
    modelPath: '',
  },
  subtitle: {
    fontSize: 28,
  },
  model: {
    camera: { offsetY: 1.2, offsetX: 0, distance: 3 },
    pose: { headYaw: 0, headPitch: 0, bodyYaw: 0, bodyLean: 0 },
    idle: { headSway: true, blinkInterval: 4 },
  },
  livestream: {
    enabled: false,
    source: '',        // e.g. 'bilibili', 'youtube', 'twitch'
    roomId: '',        // platform-specific room/channel ID
    mode: 'fast',      // 'fast' or 'full' — fast skips memory retrieval for speed
    pollInterval: 10000, // ms between danmaku polls
    maxConcurrency: 3, // max concurrent LLM+TTS workers
    maxQueueSize: 5,   // max pending messages to process
    apiKey: '',        // optional auth key for the REST chat endpoint
    apiBase: '',       // optional base URL override for danmaku API (e.g. mock server)
  },
};

let _settings = null;

export async function loadSettings() {
  if (_settings) return _settings;
  try {
    const raw = await readFile(CONFIG_PATH, 'utf-8');
    _settings = { ...DEFAULTS, ...JSON.parse(raw) };
    _settings.anthropic = { ...DEFAULTS.anthropic, ..._settings.anthropic };
    _settings.dashscope = { ...DEFAULTS.dashscope, ..._settings.dashscope };
    _settings.persona = { ...DEFAULTS.persona, ..._settings.persona };
    _settings.avatar = { ...DEFAULTS.avatar, ..._settings.avatar };
    _settings.subtitle = { ...DEFAULTS.subtitle, ..._settings.subtitle };
    _settings.voice = { ...DEFAULTS.voice, ..._settings.voice };
    _settings.model = {
      camera: { ...DEFAULTS.model.camera, ...(_settings.model?.camera || {}) },
      pose: { ...DEFAULTS.model.pose, ...(_settings.model?.pose || {}) },
      idle: { ...DEFAULTS.model.idle, ...(_settings.model?.idle || {}) },
    };
    _settings.dashscope.clonedVoices = _settings.dashscope.clonedVoices || [];
    _settings.livestream = { ...DEFAULTS.livestream, ...(_settings.livestream || {}) };
  } catch {
    _settings = { ...DEFAULTS };
  }
  return _settings;
}

export async function saveSettings(updates) {
  const current = await loadSettings();
  for (const [key, val] of Object.entries(updates)) {
    if (typeof val === 'object' && val !== null && !Array.isArray(val) && current[key]) {
      current[key] = { ...current[key], ...val };
    } else {
      current[key] = val;
    }
  }
  _settings = current;
  await writeFile(CONFIG_PATH, JSON.stringify(current, null, 2), 'utf-8');
  return current;
}

export function getSettings() {
  return _settings || DEFAULTS;
}

export function getSafeSettings() {
  const s = getSettings();
  return {
    ...s,
    anthropic: {
      ...s.anthropic,
      apiKey: s.anthropic.apiKey ? '***' + s.anthropic.apiKey.slice(-4) : '',
    },
    dashscope: {
      ...s.dashscope,
      apiKey: s.dashscope.apiKey ? '***' + s.dashscope.apiKey.slice(-4) : '',
    },
  };
}
