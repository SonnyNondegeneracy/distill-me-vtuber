/**
 * distill.mjs — Persona distillation backend
 *
 * Calls distill-me CLI tools (ingest, memory-writer, persona-generator, etc.)
 * Uses Anthropic SDK for LLM profile/memory extraction.
 * Auto-clones voice from uploaded audio files.
 *
 * Endpoints:
 *   POST /api/distill/upload     — upload files (multipart)
 *   POST /api/distill/create     — SSE: full creation pipeline
 *   POST /api/distill/update     — SSE: incremental update
 *   GET  /api/distill/files      — list uploaded files
 *   DELETE /api/distill/files/:name — delete uploaded file
 */

import { Router } from 'express';

/** Extract text from LLM response content (handles thinking models that return thinking + text blocks) */
function extractText(content) {
  if (!content?.length) return '';
  const textBlock = content.find(b => b.type === 'text');
  return textBlock?.text || content[0]?.text || '';
}

/** Extensions that can be read as text for memory extraction */
const TEXT_EXTS = new Set(['.txt', '.md', '.log', '.rst', '.json', '.csv', '.docx', '.doc', '.pdf', '.rtf']);
import multer from 'multer';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile, readdir, stat, mkdir, unlink, writeFile } from 'fs/promises';
import { join, extname, basename } from 'path';
import { existsSync, readdirSync } from 'fs';
import { tmpdir, homedir } from 'os';
import { randomUUID } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { getSettings, saveSettings } from './config.mjs';

const execFileAsync = promisify(execFile);

function dataDir(slug) {
  return join(homedir(), '.claude', 'distill_me', slug, 'uploads');
}

function toolPath(toolName) {
  const settings = getSettings();
  return join(settings.distillMePath, 'tools', toolName);
}

function modelPath(scriptName) {
  const settings = getSettings();
  return join(settings.distillMePath, 'model', scriptName);
}

function promptPath(promptName) {
  const settings = getSettings();
  return join(settings.distillMePath, 'prompts', promptName);
}

function personaDir(slug) {
  return join(homedir(), '.claude', 'distill_me', slug);
}

/** Run a distill-me CLI tool and return parsed JSON output */
async function runTool(script, args, timeout = 60000) {
  const { stdout } = await execFileAsync('node', [script, ...args], { timeout });
  return JSON.parse(stdout);
}

/** Run a python script */
async function runPython(script, args, timeout = 120000) {
  const { stdout, stderr } = await execFileAsync('python3', [script, ...args], { timeout });
  if (stderr) console.log('[distill python]', stderr.slice(0, 500));
  return stdout;
}

/** Create Anthropic client from settings */
function getClient() {
  const settings = getSettings();
  return new Anthropic({
    apiKey: settings.anthropic.apiKey,
    baseURL: settings.anthropic.baseUrl,
  });
}

/** Read text content from any supported file (plain text, docx, pdf) */
async function readTextContent(filePath) {
  const ext = extname(filePath).toLowerCase();

  if (ext === '.docx' || ext === '.doc') {
    // Use python-docx
    const { stdout } = await execFileAsync('python3', ['-c', `
import docx, sys
doc = docx.Document(sys.argv[1])
print('\\n'.join(p.text for p in doc.paragraphs))
`, filePath], { timeout: 30000 });
    return stdout;
  }

  if (ext === '.pdf') {
    // Use pdftotext
    const { stdout } = await execFileAsync('pdftotext', ['-layout', filePath, '-'], { timeout: 30000 });
    return stdout;
  }

  // Plain text / md / json / csv / etc.
  return await readFile(filePath, 'utf-8');
}

/** SSE helper: send a progress event (silently ignores closed connections) */
function sendSSE(res, event, data) {
  try {
    if (!res.writableEnded) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  } catch {
    // Connection closed — pipeline continues silently
  }
}

/** Clone voice from an audio file (reuses tts.mjs logic) */
async function cloneVoiceFromFile(filePath, name) {
  const settings = getSettings();
  const apiKey = settings.dashscope?.apiKey;
  if (!apiKey) throw new Error('No DashScope API key');

  // Convert to 16kHz mono wav
  const wavPath = join(tmpdir(), `clone-${randomUUID()}.wav`);
  await execFileAsync('ffmpeg', ['-y', '-i', filePath, '-ar', '16000', '-ac', '1', '-f', 'wav', wavPath]);

  // Upload to tmpfiles.org
  const wavData = await readFile(wavPath);
  const formData = new FormData();
  const blob = new Blob([wavData], { type: 'audio/wav' });
  const file = new File([blob], 'voice.wav', { type: 'audio/wav' });
  formData.append('file', file);
  const uploadResp = await fetch('https://tmpfiles.org/api/v1/upload', { method: 'POST', body: formData });
  const uploadJson = await uploadResp.json();
  if (!uploadJson.data?.url) throw new Error('Upload failed: ' + JSON.stringify(uploadJson));
  const publicUrl = uploadJson.data.url.replace('tmpfiles.org/', 'tmpfiles.org/dl/').replace('http://', 'https://');

  await unlink(wavPath).catch(() => {});

  // DashScope voice enrollment
  const ttsModel = settings.dashscope?.ttsModel || 'cosyvoice-v3-flash';
  const prefix = name.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 9) || 'voice';
  const enrollResp = await fetch('https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'voice-enrollment', input: { action: 'create_voice', target_model: ttsModel, prefix, url: publicUrl } }),
  });
  const enrollJson = await enrollResp.json();
  const voiceId = enrollJson.output?.voice_id;
  if (!voiceId) throw new Error('Voice enrollment failed: ' + JSON.stringify(enrollJson));

  // Save to config
  const cloned = settings.dashscope.clonedVoices || [];
  cloned.push({ voiceId, name, createdAt: new Date().toISOString() });
  await saveSettings({ dashscope: { ...settings.dashscope, voiceId, clonedVoices: cloned } });

  return voiceId;
}

/** Find audio files in a directory */
function findAudioFiles(dir) {
  const audioExts = new Set(['.mp3', '.m4a', '.wav', '.ogg', '.flac', '.aac']);
  const files = [];
  if (!existsSync(dir)) return files;
  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (audioExts.has(extname(entry).toLowerCase())) {
      files.push(join(dir, entry));
    }
  }
  return files;
}

/** Full creation pipeline */
async function createPipeline(res, slug, name) {
  const dd = dataDir(slug);
  const settings = getSettings();

  try {
    // Step 1: Scan
    sendSSE(res, 'progress', { step: 'scan', status: 'running' });
    const scanResult = await runTool(toolPath('ingest.mjs'), ['scan', dd]);
    sendSSE(res, 'progress', { step: 'scan', status: 'done', data: scanResult.breakdown });

    // Step 2: Init
    sendSSE(res, 'progress', { step: 'init', status: 'running' });
    await runTool(toolPath('ingest.mjs'), ['init', slug]);
    sendSSE(res, 'progress', { step: 'init', status: 'done' });

    // Step 3: Extract profile
    sendSSE(res, 'progress', { step: 'profile', status: 'running' });
    const distillerPrompt = await readFile(promptPath('distiller.md'), 'utf-8');
    const textFiles = [...(scanResult.files.text || []), ...(scanResult.files.json || []), ...(scanResult.files.csv || [])];

    let allContent = '';
    for (const f of textFiles) {
      const fullPath = join(dd, f.path);
      const chunk = await readTextContent(fullPath);
      allContent += `\n\n--- File: ${f.path} ---\n${chunk.slice(0, 8000)}`;
    }

    const client = getClient();
    const audit = { filesProcessed: 0, filesSkipped: 0, chunksProcessed: 0, chunksSkipped: 0, charsSent: 0, charsReceived: 0 };

    const profileInput = `请分析以下材料并提取人格档案：\n${allContent}`;
    audit.charsSent += profileInput.length;
    const profileResp = await client.messages.create({
      model: settings.anthropic.model,
      max_tokens: 4096,
      system: distillerPrompt,
      messages: [{ role: 'user', content: profileInput }],
    });

    const profileText = extractText(profileResp.content);
    audit.charsReceived += profileText.length;
    // Extract JSON from response (may be wrapped in ```json ... ```)
    const jsonMatch = profileText.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, profileText];
    let profile;
    try {
      profile = JSON.parse(jsonMatch[1].trim());
    } catch {
      // Try to find any JSON object in the response
      const objMatch = profileText.match(/\{[\s\S]*\}/);
      profile = JSON.parse(objMatch[0]);
    }

    await writeFile(join(personaDir(slug), 'profile.json'), JSON.stringify(profile, null, 2), 'utf-8');
    sendSSE(res, 'progress', { step: 'profile', status: 'done', name: profile.basic?.name });

    // Step 4: Extract memories
    sendSSE(res, 'progress', { step: 'memories', status: 'running', total: textFiles.length });
    const memExtractorPrompt = await readFile(promptPath('memory-extractor.md'), 'utf-8');
    let memCount = 0;

    for (let i = 0; i < textFiles.length; i++) {
      const f = textFiles[i];
      const fullPath = join(dd, f.path);
      const content = await readTextContent(fullPath);

      // Process in chunks
      const chunkSize = 4000;
      audit.filesProcessed++;

      for (let offset = 0; offset < content.length; offset += chunkSize) {
        const chunk = content.slice(offset, offset + chunkSize);
        const inputText = `人物名称: ${name}\n\n材料片段:\n${chunk}`;
        audit.charsSent += inputText.length;

        let memText;
        try {
          const memResp = await client.messages.create({
            model: settings.anthropic.model,
            max_tokens: 4096,
            system: memExtractorPrompt,
            messages: [{ role: 'user', content: inputText }],
          });
          memText = extractText(memResp.content);
          audit.charsReceived += memText.length;
          audit.chunksProcessed++;
        } catch (e) {
          console.error(`Chunk skipped (${f.path} offset ${offset}):`, e.message?.slice(0, 200));
          audit.chunksSkipped++;
          continue;
        }
        if (!memText) continue;

        // Extract memories: try JSON array first, then individual JSON objects
        let memories = [];
        try {
          const arrMatch = memText.match(/\[[\s\S]*\]/);
          if (arrMatch) {
            memories = JSON.parse(arrMatch[0]);
          } else {
            // Fallback: extract individual JSON objects from code blocks or raw text
            const objMatches = memText.matchAll(/\{[\s\S]*?\n\}/g);
            for (const m of objMatches) {
              try { memories.push(JSON.parse(m[0])); } catch { /* skip malformed */ }
            }
          }
        } catch (e) {
          // Array parse failed, try individual objects
          const objMatches = memText.matchAll(/\{[\s\S]*?\n\}/g);
          for (const m of objMatches) {
            try { memories.push(JSON.parse(m[0])); } catch { /* skip */ }
          }
        }

        for (const mem of memories) {
          if (!mem.category || !mem.topic || !mem.body) continue;
          try {
            const args = [slug, mem.category, mem.topic, '--body', mem.body];
            if (mem.type) args.push('--type', mem.type);
            if (mem.importance) args.push('--importance', String(mem.importance));
            if (mem.tags?.length) args.push('--tags', mem.tags.join(','));
            await runTool(toolPath('memory-writer.mjs'), args);
            memCount++;
          } catch (e) {
            console.error('Memory write error:', e.message);
          }
        }
      }

      sendSSE(res, 'progress', { step: 'memories', status: 'running', current: i + 1, total: textFiles.length, count: memCount, audit });
    }
    sendSSE(res, 'progress', { step: 'memories', status: 'done', count: memCount, audit });

    // Step 5: Build index
    sendSSE(res, 'progress', { step: 'index', status: 'running' });
    const pDir = personaDir(slug);
    const mDir = join(pDir, 'memories');
    await runPython(modelPath('embedder.py'), ['build', mDir, pDir]);
    sendSSE(res, 'progress', { step: 'index', status: 'done' });

    // Step 6: Cold start links
    sendSSE(res, 'progress', { step: 'links', status: 'running' });
    await runPython(modelPath('cold_start.py'), [pDir]);
    sendSSE(res, 'progress', { step: 'links', status: 'done' });

    // Step 7: Generate skill
    sendSSE(res, 'progress', { step: 'skill', status: 'running' });
    await runTool(toolPath('persona-generator.mjs'), [slug]);
    sendSSE(res, 'progress', { step: 'skill', status: 'done' });

    // Step 8: Auto-clone voice from audio files
    const audioFiles = findAudioFiles(dd);
    if (audioFiles.length > 0) {
      sendSSE(res, 'progress', { step: 'voice', status: 'running', file: basename(audioFiles[0]) });
      try {
        const voiceId = await cloneVoiceFromFile(audioFiles[0], name || slug);
        sendSSE(res, 'progress', { step: 'voice', status: 'done', voiceId });
      } catch (e) {
        sendSSE(res, 'progress', { step: 'voice', status: 'error', error: e.message });
      }
    }

    // Step 9: Mark done
    sendSSE(res, 'progress', { step: 'markdone', status: 'running' });
    await runTool(toolPath('ingest.mjs'), ['mark-done', slug, dd]);
    sendSSE(res, 'progress', { step: 'markdone', status: 'done' });

    // Step 10: Update vtuber config
    await saveSettings({ persona: { slug, userId: settings.persona?.userId || '' } });

    sendSSE(res, 'done', { slug, memoryCount: memCount, name: profile.basic?.name || name, audit });
  } catch (err) {
    console.error('Distill pipeline error:', err);
    sendSSE(res, 'error', { message: err.message });
  } finally {
    try {
      await runTool(toolPath('ingest.mjs'), ['mark-done', slug, dd]);
    } catch (e) {
      console.error('mark-done failed:', e.message);
    }
  }

  if (!res.writableEnded) res.end();
}

/** Incremental update pipeline */
async function updatePipeline(res, slug) {
  const dd = dataDir(slug);
  const settings = getSettings();

  try {
    // Step 1: Diff
    sendSSE(res, 'progress', { step: 'diff', status: 'running' });
    const diffResult = await runTool(toolPath('ingest.mjs'), ['diff', slug, dd]);
    sendSSE(res, 'progress', { step: 'diff', status: 'done', data: diffResult });

    if (diffResult.to_process === 0) {
      sendSSE(res, 'done', { slug, message: 'No new files to process' });
      if (!res.writableEnded) res.end();
      return;
    }

    // Step 2: Extract memories from new/changed files
    const filesToProcess = [...diffResult.new_files, ...diffResult.changed_files];
    sendSSE(res, 'progress', { step: 'memories', status: 'running', total: filesToProcess.length });
    const memExtractorPrompt = await readFile(promptPath('memory-extractor.md'), 'utf-8');
    const client = getClient();
    let memCount = 0;
    const audit = { filesProcessed: 0, filesSkipped: 0, chunksProcessed: 0, chunksSkipped: 0, charsSent: 0, charsReceived: 0 };

    // Load existing profile for context
    let profileName = slug;
    try {
      const profile = JSON.parse(await readFile(join(personaDir(slug), 'profile.json'), 'utf-8'));
      profileName = profile.basic?.name || slug;
    } catch { /* ignore */ }

    for (let i = 0; i < filesToProcess.length; i++) {
      const f = filesToProcess[i];
      const fullPath = f.path;
      // Only process text-readable files
      if (!TEXT_EXTS.has(extname(fullPath).toLowerCase())) {
        audit.filesSkipped++;
        continue;
      }

      const content = await readTextContent(fullPath);
      const chunkSize = 4000;
      audit.filesProcessed++;
      console.log(`[distill] File ${i+1}/${filesToProcess.length}: ${basename(fullPath)} (${content.length} chars, ${Math.ceil(content.length / chunkSize)} chunks)`);

      for (let offset = 0; offset < content.length; offset += chunkSize) {
        const chunk = content.slice(offset, offset + chunkSize);
        const inputText = `人物名称: ${profileName}\n\n材料片段:\n${chunk}`;
        audit.charsSent += inputText.length;

        let memText;
        try {
          const memResp = await client.messages.create({
            model: settings.anthropic.model,
            max_tokens: 4096,
            system: memExtractorPrompt,
            messages: [{ role: 'user', content: inputText }],
          });
          memText = extractText(memResp.content);
          audit.charsReceived += memText.length;
          audit.chunksProcessed++;
        } catch (e) {
          console.error(`[distill] Chunk skipped (${basename(fullPath)} offset ${offset}):`, e.message?.slice(0, 200));
          audit.chunksSkipped++;
          continue;
        }
        if (!memText) continue;
        // Extract memories: try JSON array first, then individual JSON objects
        let memories = [];
        try {
          const arrMatch = memText.match(/\[[\s\S]*\]/);
          if (arrMatch) {
            memories = JSON.parse(arrMatch[0]);
          } else {
            const objMatches = memText.matchAll(/\{[\s\S]*?\n\}/g);
            for (const m of objMatches) {
              try { memories.push(JSON.parse(m[0])); } catch { /* skip */ }
            }
          }
        } catch {
          const objMatches = memText.matchAll(/\{[\s\S]*?\n\}/g);
          for (const m of objMatches) {
            try { memories.push(JSON.parse(m[0])); } catch { /* skip */ }
          }
        }
        console.log(`[distill] Parsed ${memories.length} memories`);

        for (const mem of memories) {
          if (!mem.category || !mem.topic || !mem.body) continue;
          try {
            // Use persona-editor for update (auto-triggers index rebuild)
            const args = ['memory', 'add', slug, mem.category, mem.topic, '--body', mem.body];
            if (mem.importance) args.push('--importance', String(mem.importance));
            if (mem.tags?.length) args.push('--tags', mem.tags.join(','));
            if (mem.type) args.push('--type', mem.type);
            await runTool(toolPath('persona-editor.mjs'), args);
            memCount++;
          } catch (e) {
            console.error('Memory write error:', e.message);
          }
        }
      }

      sendSSE(res, 'progress', { step: 'memories', status: 'running', current: i + 1, total: filesToProcess.length, count: memCount, audit });
    }
    sendSSE(res, 'progress', { step: 'memories', status: 'done', count: memCount, audit });

    // Step 3: Auto-clone new audio files
    const audioFiles = findAudioFiles(dd);
    const existingCloned = settings.dashscope?.clonedVoices || [];
    if (audioFiles.length > 0 && existingCloned.length === 0) {
      sendSSE(res, 'progress', { step: 'voice', status: 'running', file: basename(audioFiles[0]) });
      try {
        const voiceId = await cloneVoiceFromFile(audioFiles[0], profileName);
        sendSSE(res, 'progress', { step: 'voice', status: 'done', voiceId });
      } catch (e) {
        sendSSE(res, 'progress', { step: 'voice', status: 'error', error: e.message });
      }
    }

    // Step 4: Mark done
    sendSSE(res, 'progress', { step: 'markdone', status: 'running' });
    await runTool(toolPath('ingest.mjs'), ['mark-done', slug, dd]);
    sendSSE(res, 'progress', { step: 'markdone', status: 'done' });

    sendSSE(res, 'done', { slug, memoryCount: memCount, audit });
  } catch (err) {
    console.error('Update pipeline error:', err);
    sendSSE(res, 'error', { message: err.message });
  } finally {
    // Always mark files as done — even if pipeline errored partway through,
    // the files that were processed should be registered so they don't get
    // re-processed on next run.
    try {
      await runTool(toolPath('ingest.mjs'), ['mark-done', slug, dd]);
    } catch (e) {
      console.error('mark-done failed:', e.message);
    }
  }

  if (!res.writableEnded) res.end();
}

export function createDistillRouter() {
  const router = Router();

  // File upload
  const storage = multer.diskStorage({
    destination: async (req, _file, cb) => {
      const slug = req.body?.slug || req.query?.slug || 'default';
      const dir = dataDir(slug);
      await mkdir(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const original = Buffer.from(file.originalname, 'latin1').toString('utf8');
      cb(null, original);
    },
  });
  const upload = multer({ storage });

  router.post('/upload', upload.array('files', 200), (req, res) => {
    const files = (req.files || []).map(f => ({
      name: f.filename,
      size: f.size,
      path: f.path,
    }));
    res.json({ uploaded: files.length, files });
  });

  // List uploaded files (recursive, with ingested status)
  router.get('/files', async (req, res) => {
    const slug = req.query.slug || getSettings().persona?.slug || 'default';
    const dir = dataDir(slug);
    if (!existsSync(dir)) return res.json([]);
    try {
      // Load ingest log to check processed status
      let ingestLog = { files: {} };
      try {
        ingestLog = JSON.parse(await readFile(join(personaDir(slug), 'ingest_log.json'), 'utf-8'));
      } catch { /* no log yet */ }

      const files = [];
      async function walk(d, prefix) {
        const entries = await readdir(d, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;
          const fullPath = join(d, entry.name);
          if (entry.isDirectory()) {
            await walk(fullPath, prefix ? `${prefix}/${entry.name}` : entry.name);
          } else {
            const s = await stat(fullPath);
            const relName = prefix ? `${prefix}/${entry.name}` : entry.name;
            files.push({
              name: relName,
              size: s.size,
              ext: extname(entry.name).toLowerCase(),
              folder: prefix || null,
              ingested: !!ingestLog.files[relName],
            });
          }
        }
      }
      await walk(dir, '');
      res.json(files);
    } catch {
      res.json([]);
    }
  });

  // Delete uploaded file + remove from ingest log (un-register)
  router.delete('/files/*', async (req, res) => {
    const slug = req.query.slug || getSettings().persona?.slug || 'default';
    const relName = req.params[0];
    const filePath = join(dataDir(slug), relName);
    try {
      await unlink(filePath);
      // Remove from ingest log so re-upload triggers re-processing
      const logPath = join(personaDir(slug), 'ingest_log.json');
      try {
        const log = JSON.parse(await readFile(logPath, 'utf-8'));
        if (log.files[relName]) {
          delete log.files[relName];
          await writeFile(logPath, JSON.stringify(log, null, 2) + '\n', 'utf-8');
        }
      } catch { /* no log yet */ }
      res.json({ ok: true });
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  });

  // Create pipeline (SSE)
  router.post('/create', async (req, res) => {
    const { slug, name } = req.body;
    if (!slug || !name) return res.status(400).json({ error: 'slug and name required' });

    // Ensure data dir has files
    const dir = dataDir(slug);
    if (!existsSync(dir)) return res.status(400).json({ error: 'No files uploaded. Upload files first.' });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    await createPipeline(res, slug, name);
  });

  // Update pipeline (SSE)
  router.post('/update', async (req, res) => {
    const slug = req.body?.slug || getSettings().persona?.slug;
    if (!slug) return res.status(400).json({ error: 'slug required' });

    const dir = dataDir(slug);
    if (!existsSync(dir)) return res.status(400).json({ error: 'No files uploaded for this persona.' });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    await updatePipeline(res, slug);
  });

  return router;
}
