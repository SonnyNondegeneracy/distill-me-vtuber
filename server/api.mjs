/**
 * api.mjs — REST API routes
 */

import { Router } from 'express';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { loadSettings, saveSettings, getSafeSettings, getSettings } from './config.mjs';
import { handleChat, broadcast, getIdentities } from './ws.mjs';
import { startLivestream, stopLivestream, isLivestreamRunning } from './livestream.mjs';

let _distillMe = null;

async function getDistillMe() {
  if (_distillMe) return _distillMe;
  const settings = getSettings();
  const smPath = join(settings.distillMePath, 'tools', 'session-manager.mjs');
  _distillMe = await import(smPath);
  return _distillMe;
}

export function createApiRouter() {
  const router = Router();

  // --- Settings ---
  router.get('/settings', (req, res) => {
    res.json(getSafeSettings());
  });

  router.post('/settings', async (req, res) => {
    try {
      await saveSettings(req.body);
      _distillMe = null; // re-import if distillMePath changed
      res.json(getSafeSettings());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Personas ---
  router.get('/personas', async (req, res) => {
    try {
      const baseDir = join(homedir(), '.claude', 'distill_me');
      const entries = await readdir(baseDir, { withFileTypes: true });
      const personas = [];
      for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith('_')) continue;
        try {
          const profile = JSON.parse(
            await readFile(join(baseDir, e.name, 'profile.json'), 'utf-8')
          );
          personas.push({
            slug: e.name,
            name: profile.basic?.name || e.name,
          });
        } catch {
          personas.push({ slug: e.name, name: e.name });
        }
      }
      res.json(personas);
    } catch (err) {
      res.json([]);
    }
  });

  // --- Identities (for current persona) ---
  router.get('/identities', async (req, res) => {
    try {
      const settings = getSettings();
      const slug = req.query.slug || settings.persona.slug;
      if (!slug) return res.json([]);
      const identities = await getIdentities(slug);
      const list = [{ value: 'auto', label: '自动' }];
      for (const [key, { label }] of identities) {
        list.push({ value: key, label });
      }
      res.json(list);
    } catch {
      res.json([{ value: 'auto', label: '自动' }]);
    }
  });

  // --- Compose (debug endpoint) ---
  router.post('/compose', async (req, res) => {
    try {
      const { slug, message, phase, user } = req.body;
      const sm = await getDistillMe();
      const result = await sm.composeMemoryContext(slug, message, { phase, user });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Livestream control ---
  router.get('/livestream/status', (req, res) => {
    res.json({ running: isLivestreamRunning() });
  });

  router.post('/livestream/start', (req, res) => {
    try {
      startLivestream();
      res.json({ running: isLivestreamRunning() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/livestream/stop', (req, res) => {
    stopLivestream();
    res.json({ running: false });
  });

  // --- Chat (REST, for external sources like Bilibili) ---
  // POST /api/chat { message, user, source }
  // When source is provided, the message is treated as a livestream viewer comment.
  // The persona responds as if interacting with a viewer, not the owner.
  router.post('/chat', async (req, res) => {
    const { message, user, source } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });

    const settings = getSettings();
    const livestream = settings.livestream || {};

    // Optional API key auth
    if (livestream.apiKey) {
      const auth = req.headers.authorization?.replace('Bearer ', '');
      if (auth !== livestream.apiKey) {
        return res.status(401).json({ error: 'unauthorized' });
      }
    }

    // Build the message with viewer context
    let chatMessage = message;
    if (source || livestream.source) {
      const platform = source || livestream.source || 'livestream';
      const viewerName = user || 'anonymous';
      chatMessage = `[${platform}观众 ${viewerName}]: ${message}`;
    }

    // Collect response chunks
    let fullText = '';
    let error = null;
    const fakeWs = {
      send(data) {
        const parsed = JSON.parse(data);
        if (parsed.type === 'done') fullText = parsed.fullText;
        if (parsed.type === 'error') error = parsed.message;
      },
    };

    try {
      await handleChat(fakeWs, {
        type: 'chat',
        message: chatMessage,
        user: user || 'viewer',
        mode: livestream.mode || 'fast',
      });
      if (error) return res.status(500).json({ error });
      res.json({ text: fullText, user, source });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
