/**
 * tts.mjs — DashScope CosyVoice TTS proxy
 *
 * Uses CosyVoice WebSocket API (wss://dashscope.aliyuncs.com/api-ws/v1/inference).
 * API key stays server-side.
 *
 * LLM polish: before synthesis, optionally calls LLM to clean text for speech
 * and detect emotion, then maps emotion → rate/pitch adjustments.
 *
 * Endpoints:
 *   POST /api/tts           { text, voice?, rate?, pitch?, volume?, polish? }  → audio/mpeg
 *   POST /api/tts/clone     multipart upload OR { filePath }                   → { voiceId }
 *   GET  /api/tts/audio-files                                                  → [{ name, path }]
 */

import { Router } from 'express';
import WebSocket from 'ws';
import { randomUUID } from 'crypto';
import { getSettings, saveSettings } from './config.mjs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile, readdir, stat, unlink, writeFile } from 'fs/promises';
import { join, extname, basename } from 'path';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import multer from 'multer';
import Anthropic from '@anthropic-ai/sdk';

const WS_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference';

/* ── Emotion → voice parameter presets ── */

const EMOTION_PRESETS = {
  '开心':  { rateMul: 1.15, pitchMul: 1.20 },
  '平静':  { rateMul: 1.00, pitchMul: 1.00 },
  '悲伤':  { rateMul: 0.85, pitchMul: 0.85 },
  '愤怒':  { rateMul: 1.20, pitchMul: 1.05 },
  '犹豫':  { rateMul: 0.90, pitchMul: 0.95 },
  '撒娇':  { rateMul: 1.10, pitchMul: 1.25 },
};

const POLISH_SYSTEM = `TTS预处理。去掉<think>、markdown、括号注释、HTML、emoji。不改原文措辞和语言。
判断表情混合(可多个)和可选动作。
表情：happy,sad,angry,relaxed,surprised,neutral（0-1）
动作(可选)：raiseArms
只输出JSON：{"text":"清理文本","expressions":{"名":值},"action":"动作或null"}`;

/* Map VRM expression names to TTS emotion presets */
const EXPR_TO_EMOTION = {
  happy: '开心', sad: '悲伤', angry: '愤怒',
  relaxed: '平静', surprised: '开心', neutral: '平静',
};
const VALID_EXPRESSIONS = new Set(['happy', 'sad', 'angry', 'relaxed', 'surprised', 'neutral']);
const VALID_ACTIONS = new Set(['raiseArms']);

function dominantEmotion(expressions) {
  let max = 0, dominant = '平静';
  for (const [k, v] of Object.entries(expressions)) {
    if (v > max && EXPR_TO_EMOTION[k]) { max = v; dominant = EXPR_TO_EMOTION[k]; }
  }
  return dominant;
}

/**
 * Call LLM to clean text for TTS and detect expression blend.
 * Falls back to raw text + neutral on failure.
 */
async function polishForTTS(rawText, settings) {
  try {
    const client = new Anthropic({
      apiKey: settings.anthropic.apiKey,
      baseURL: settings.anthropic.baseUrl,
    });

    const polishModel = settings.anthropic.polishModel;
    if (!polishModel) {
      console.warn('[TTS polish] No polishModel configured, skipping LLM polish');
      throw new Error('polishModel not configured');
    }

    const resp = await client.messages.create({
      model: polishModel,
      max_tokens: 150,
      system: POLISH_SYSTEM,
      messages: [{ role: 'user', content: rawText }],
    });

    let text = '';
    if (typeof resp.content === 'string') {
      text = resp.content;
    } else if (Array.isArray(resp.content)) {
      const textBlock = resp.content.find(b => b.type === 'text');
      text = textBlock?.text || resp.content[0]?.text || '';
    }

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      // Validate expressions: only keep known names with 0-1 values
      const expressions = {};
      if (parsed.expressions && typeof parsed.expressions === 'object') {
        for (const [k, v] of Object.entries(parsed.expressions)) {
          if (VALID_EXPRESSIONS.has(k) && typeof v === 'number') {
            expressions[k] = Math.max(0, Math.min(1, v));
          }
        }
      }
      // Fallback: old format with single emotion field
      if (Object.keys(expressions).length === 0 && parsed.emotion) {
        expressions.relaxed = 0.4;
      }
      const emotion = dominantEmotion(expressions);
      const action = (parsed.action && VALID_ACTIONS.has(parsed.action)) ? parsed.action : null;
      console.log('[TTS polish] OK — expressions:', expressions, 'emotion:', emotion, 'action:', action);
      return { text: parsed.text || rawText, expressions, emotion, action };
    }
  } catch (err) {
    console.error('TTS polish LLM failed (falling back to regex):', err.message);
  }

  // Fallback: basic regex strip
  const cleaned = rawText
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\uff08[^\uff09]*\uff09/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\u3010[^\u3011]*\u3011/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/#{1,6}\s*/g, '')
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]*`/g, '')
    .replace(/[\u{1F600}-\u{1F9FF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1F100}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}\u{2702}-\u{27B0}\u{E0020}-\u{E007F}]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { text: cleaned || rawText, expressions: { neutral: 0.3 }, emotion: '平静', action: null };
}

/**
 * Synthesize text to audio via DashScope CosyVoice WebSocket API.
 * Returns a Buffer of mp3 audio.
 */
function synthesize(text, { apiKey, model, voice, rate = 1, pitch = 1, volume = 50 }) {
  return new Promise((resolve, reject) => {
    const taskId = randomUUID();
    const chunks = [];

    const ws = new WebSocket(WS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('TTS timeout'));
    }, 30000);

    ws.on('open', () => {
      // Step 1: run-task
      ws.send(JSON.stringify({
        header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
        payload: {
          task_group: 'audio',
          task: 'tts',
          function: 'SpeechSynthesizer',
          model,
          parameters: {
            text_type: 'PlainText',
            voice,
            format: 'mp3',
            sample_rate: 22050,
            volume,
            rate,
            pitch,
          },
          input: {},
        },
      }));
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        // Binary frame = audio chunk
        chunks.push(Buffer.from(data));
        return;
      }

      const msg = JSON.parse(data.toString());
      const event = msg.header?.event;

      if (event === 'task-started') {
        // Step 2: send text
        ws.send(JSON.stringify({
          header: { action: 'continue-task', task_id: taskId, streaming: 'duplex' },
          payload: { input: { text } },
        }));
        // Step 3: finish
        ws.send(JSON.stringify({
          header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
          payload: { input: {} },
        }));
      } else if (event === 'task-finished') {
        clearTimeout(timeout);
        ws.close();
        resolve(Buffer.concat(chunks));
      } else if (event === 'task-failed') {
        clearTimeout(timeout);
        ws.close();
        reject(new Error(msg.header?.error_message || 'TTS synthesis failed'));
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

export function createTTSRouter() {
  const router = Router();

  router.post('/', async (req, res) => {
    const { text, polish } = req.body;
    if (!text) return res.status(400).json({ error: 'text is required' });

    const settings = getSettings();
    if (!settings.dashscope.apiKey) {
      return res.status(500).json({ error: 'No API key configured' });
    }

    const voice = req.body.voice || settings.dashscope.voiceId || 'longanyang';
    const model = settings.dashscope.ttsModel || 'cosyvoice-v3-flash';
    let baseRate = req.body.rate ?? settings.voice?.rate ?? 1;
    let basePitch = req.body.pitch ?? settings.voice?.pitch ?? 1;
    const volume = req.body.volume ?? settings.voice?.volume ?? 50;

    try {
      // Polish: LLM cleans text + detects emotion → adjust rate/pitch
      let finalText = text;
      let emotion = '平静';

      let expressions = null;
      let action = null;

      if (polish) {
        const result = await polishForTTS(text, settings);
        finalText = result.text;
        emotion = result.emotion;
        expressions = result.expressions;
        action = result.action;

        const preset = EMOTION_PRESETS[emotion] || EMOTION_PRESETS['平静'];
        baseRate = Math.min(2, Math.max(0.5, baseRate * preset.rateMul));
        basePitch = Math.min(2, Math.max(0.5, basePitch * preset.pitchMul));
      }

      if (!finalText.trim()) {
        return res.status(400).json({ error: 'Empty text after polish' });
      }

      const audioBuffer = await synthesize(finalText, {
        apiKey: settings.dashscope.apiKey,
        model,
        voice,
        rate: baseRate,
        pitch: basePitch,
        volume,
      });

      res.set('Content-Type', 'audio/mpeg');
      res.set('Content-Length', audioBuffer.length);
      res.set('X-TTS-Emotion', encodeURIComponent(emotion));
      if (expressions) {
        res.set('X-TTS-Expressions', JSON.stringify(expressions));
      }
      if (action) {
        res.set('X-TTS-Action', action);
      }
      res.send(audioBuffer);
    } catch (err) {
      console.error('TTS error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // --- Voice clone endpoint ---
  const upload = multer({ dest: join(tmpdir(), 'distillme-uploads') });

  router.post('/clone', upload.single('audio'), async (req, res) => {
    const settings = getSettings();
    const apiKey = settings.dashscope?.apiKey;
    if (!apiKey) return res.status(500).json({ error: 'No DashScope API key configured' });

    try {
      // Determine source file: uploaded file or local filePath
      let sourceFile;
      if (req.file) {
        sourceFile = req.file.path;
      } else if (req.body?.filePath) {
        sourceFile = req.body.filePath;
        if (!existsSync(sourceFile)) {
          return res.status(400).json({ error: 'File not found: ' + sourceFile });
        }
      } else {
        return res.status(400).json({ error: 'Upload a file or provide filePath' });
      }

      // Convert to 16kHz mono wav via ffmpeg
      const wavPath = join(tmpdir(), `clone-${randomUUID()}.wav`);
      const execFileAsync = promisify(execFile);
      await execFileAsync('ffmpeg', [
        '-y', '-i', sourceFile,
        '-ar', '16000', '-ac', '1', '-f', 'wav', wavPath,
      ]);

      // Upload to tmpfiles.org to get a public URL
      const wavData = await readFile(wavPath);
      const blob = new Blob([wavData], { type: 'audio/wav' });
      const file = new File([blob], 'voice.wav', { type: 'audio/wav' });
      const formData = new FormData();
      formData.append('file', file);

      const uploadResp = await fetch('https://tmpfiles.org/api/v1/upload', {
        method: 'POST',
        body: formData,
      });
      const uploadJson = await uploadResp.json();
      if (!uploadJson.data?.url) {
        throw new Error('Upload failed: ' + JSON.stringify(uploadJson));
      }
      // tmpfiles.org returns URL like https://tmpfiles.org/12345/voice.wav
      // Direct download URL is https://tmpfiles.org/dl/12345/voice.wav
      const publicUrl = uploadJson.data.url.replace('tmpfiles.org/', 'tmpfiles.org/dl/').replace('http://', 'https://');

      // Clean up temp files
      await unlink(wavPath).catch(() => {});
      if (req.file) await unlink(req.file.path).catch(() => {});

      // Call DashScope voice enrollment API
      const ttsModel = settings.dashscope.ttsModel || 'cosyvoice-v3-flash';
      const name = req.body.name || basename(sourceFile, extname(sourceFile));
      const prefix = name.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 9) || 'voice';
      const enrollResp = await fetch('https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'voice-enrollment',
          input: { action: 'create_voice', target_model: ttsModel, prefix, url: publicUrl },
        }),
      });
      const enrollJson = await enrollResp.json();
      const voiceId = enrollJson.output?.voice_id;
      if (!voiceId) {
        throw new Error('Voice enrollment failed: ' + JSON.stringify(enrollJson));
      }

      // Save to config
      const cloned = settings.dashscope.clonedVoices || [];
      cloned.push({ voiceId, name, createdAt: new Date().toISOString() });
      await saveSettings({ dashscope: { ...settings.dashscope, clonedVoices: cloned } });

      res.json({ voiceId, name });
    } catch (err) {
      console.error('Clone error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // --- List audio files from persona assets ---
  router.get('/audio-files', async (req, res) => {
    const settings = getSettings();
    const slug = settings.persona?.slug;
    if (!slug) return res.json([]);

    const audioExts = new Set(['.mp3', '.m4a', '.wav', '.ogg', '.flac', '.aac']);
    const files = [];

    // Scan directories that might contain persona audio assets
    const dirs = [];
    const homeDir = process.env.HOME || process.env.USERPROFILE || '/root';
    dirs.push(join(homeDir, '.claude', 'distill_me', slug, '数字资产'));
    if (settings.distillMePath) {
      dirs.push(join(settings.distillMePath, 'personas', slug, '数字资产'));
    }

    for (const dir of dirs) {
      if (!existsSync(dir)) continue;
      try {
        const entries = await readdir(dir, { recursive: true });
        for (const entry of entries) {
          const ext = extname(entry).toLowerCase();
          if (audioExts.has(ext)) {
            const fullPath = join(dir, entry);
            const s = await stat(fullPath);
            if (s.isFile()) {
              files.push({
                name: entry,
                path: fullPath,
                size: s.size,
              });
            }
          }
        }
      } catch { /* skip unreadable dirs */ }
    }

    res.json(files);
  });

  return router;
}

// Export internals for livestream pipeline
export { polishForTTS, synthesize, EMOTION_PRESETS };
