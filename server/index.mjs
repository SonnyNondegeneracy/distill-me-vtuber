/**
 * index.mjs — Express + WebSocket server entry point
 */

import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, statSync } from 'fs';
import { readdir, unlink, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { createApiRouter } from './api.mjs';
import { createTTSRouter } from './tts.mjs';
import { createDistillRouter } from './distill.mjs';
import { setupWebSocket } from './ws.mjs';
import { loadSettings } from './config.mjs';
import { startLivestream } from './livestream.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

async function main() {
  await loadSettings();

  // Clean up stale temp files from previous runs
  cleanupTempFiles();
  // Run cleanup every 30 minutes
  setInterval(cleanupTempFiles, 30 * 60 * 1000);

  const app = express();
  app.use(cors({ exposedHeaders: ['X-TTS-Expressions', 'X-TTS-Emotion', 'X-TTS-Action'] }));
  app.use(express.json());

  // Serve avatar assets — BEFORE api router to avoid conflicts
  app.get('/api/assets/*', (req, res) => {
    // req.params[0] is everything after /api/assets/
    const filePath = '/' + req.params[0];
    if (filePath.includes('..')) {
      return res.status(400).send('Invalid path');
    }
    if (!existsSync(filePath)) {
      console.error('Asset not found:', filePath);
      return res.status(404).send('File not found: ' + filePath);
    }
    console.log('Serving asset:', filePath, '(' + Math.round(statSync(filePath).size/1024) + 'KB)');
    res.sendFile(filePath);
  });

  // Serve livestream audio temp files
  app.get('/api/livestream/audio/:filename', (req, res) => {
    const filename = req.params.filename;
    if (filename.includes('..') || filename.includes('/')) {
      return res.status(400).send('Invalid filename');
    }
    const audioDir = join(tmpdir(), 'distillme-livestream');
    const filePath = join(audioDir, filename);
    if (!existsSync(filePath)) {
      return res.status(404).send('Audio not found');
    }
    res.set('Content-Type', 'audio/mpeg');
    res.sendFile(filePath);
  });

  // API routes
  app.use('/api/tts', createTTSRouter());
  app.use('/api/distill', createDistillRouter());
  app.use('/api', createApiRouter());

  // Serve built frontend (production)
  const distDir = join(__dirname, '..', 'dist');
  const publicDir = join(__dirname, '..', 'public');
  if (existsSync(publicDir)) {
    app.use(express.static(publicDir));
  }
  if (existsSync(distDir)) {
    app.use(express.static(distDir));
    // SPA fallback — only for non-API routes
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.sendFile(join(distDir, 'index.html'));
    });
  }

  const server = createServer(app);
  setupWebSocket(server);

  server.listen(PORT, () => {
    console.log(`DistillMe VTuber server running at http://localhost:${PORT}`);
    console.log(`OBS Overlay: http://localhost:${PORT}?mode=overlay`);
    // Start livestream connector if configured
    startLivestream();
  });
}

main().catch(console.error);

/** Clean stale temp files (clone wavs, multer uploads) older than 1 hour */
async function cleanupTempFiles() {
  const maxAge = 60 * 60 * 1000; // 1 hour
  const now = Date.now();
  let cleaned = 0;

  // 1. /tmp/clone-*.wav leftover from voice cloning
  try {
    const tmpFiles = await readdir(tmpdir());
    for (const f of tmpFiles) {
      if (!f.startsWith('clone-') || !f.endsWith('.wav')) continue;
      const fp = join(tmpdir(), f);
      try {
        const s = await stat(fp);
        if (now - s.mtimeMs > maxAge) { await unlink(fp); cleaned++; }
      } catch {}
    }
  } catch {}

  // 2. /tmp/distillme-uploads/ leftover from multer
  const uploadsDir = join(tmpdir(), 'distillme-uploads');
  try {
    const files = await readdir(uploadsDir);
    for (const f of files) {
      const fp = join(uploadsDir, f);
      try {
        const s = await stat(fp);
        if (now - s.mtimeMs > maxAge) { await unlink(fp); cleaned++; }
      } catch {}
    }
  } catch {}

  if (cleaned > 0) console.log(`Cleaned ${cleaned} stale temp files`);
}
