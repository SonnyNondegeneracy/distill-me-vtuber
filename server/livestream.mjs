/**
 * livestream.mjs — Concurrent danmaku pipeline with ordered output.
 *
 * Architecture:
 *   1. DanmakuConnector polls for new comments
 *   2. Each comment enters a concurrent processing pool (max N workers)
 *   3. Each worker: LLM generate (full, non-streaming) → TTS polish → TTS synthesize
 *   4. Results enter an ordered output queue keyed by sequence number
 *   5. Output queue drains in-order: broadcasts text + serves audio + expressions
 *
 * Ordering guarantee:
 *   - Each incoming message gets a monotonic sequence number
 *   - Output only advances when the next-in-sequence result is ready
 *   - If the queue grows too long (> 2x maxConcurrency), middle items are skipped
 *     to catch up, but order is still preserved for those that do play
 *
 * The frontend receives:
 *   { type: "livestream_ready", seq, user, text, responseText, audioUrl, expressions, action }
 *   ...then plays them in order (audio via <audio> element, expressions via state)
 */

import { getSettings } from './config.mjs';
import { handleChat, broadcast } from './ws.mjs';
import { polishForTTS, synthesize } from './tts.mjs';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

let _connector = null;
let _generation = 0;

export function startLivestream() {
  const settings = getSettings();
  const ls = settings.livestream;
  if (!ls?.enabled || !ls?.roomId) {
    console.log('[Livestream] Not enabled or no roomId configured');
    return;
  }
  stopLivestream();
  _generation++;
  _connector = new DanmakuConnector(ls, _generation);
  _connector.start();
}

export function stopLivestream() {
  if (_connector) {
    _connector.stop();
    _connector = null;
  }
}

export function isLivestreamRunning() {
  return _connector?.running ?? false;
}

/* ── Ordered Output Queue ── */

class OrderedOutputQueue {
  constructor(onOutput) {
    this._results = new Map();  // seq → result
    this._nextSeq = 0;         // next sequence to output
    this._onOutput = onOutput;
    this._draining = false;
  }

  reset() {
    this._results.clear();
    this._nextSeq = 0;
  }

  /**
   * Set the starting sequence number (first message in this batch).
   */
  setBase(seq) {
    this._nextSeq = seq;
  }

  /**
   * Submit a completed result. Triggers drain if this was the next in line.
   */
  submit(seq, result) {
    this._results.set(seq, result);
    this._drain();
  }

  /**
   * Mark a sequence as skipped (won't be processed).
   */
  skip(seq) {
    this._results.set(seq, null); // null = skipped
    this._drain();
  }

  async _drain() {
    if (this._draining) return;
    this._draining = true;

    while (this._results.has(this._nextSeq)) {
      const result = this._results.get(this._nextSeq);
      this._results.delete(this._nextSeq);
      const seq = this._nextSeq;
      this._nextSeq++;

      if (result) {
        try {
          await this._onOutput(seq, result);
        } catch (err) {
          console.error(`[Livestream] Output error for seq ${seq}:`, err.message);
        }
      } else {
        console.log(`[Livestream] Skipped seq ${seq}`);
      }
    }

    this._draining = false;
  }
}

/* ── Concurrent Processing Pool ── */

class ProcessingPool {
  constructor(maxConcurrency, outputQueue) {
    this._maxConcurrency = maxConcurrency;
    this._outputQueue = outputQueue;
    this._running = 0;
    this._queue = [];  // pending jobs: { seq, msg }
  }

  enqueue(seq, msg) {
    this._queue.push({ seq, msg });
    this._tryRun();
  }

  /**
   * Trim the waiting queue if it's too long.
   * Keep first and last items, skip middle ones.
   */
  trimQueue(maxKeep) {
    if (this._queue.length <= maxKeep) return;
    const skipped = this._queue.splice(1, this._queue.length - maxKeep);
    for (const item of skipped) {
      console.log(`[Livestream] Dropping queued seq ${item.seq} (${item.msg.user}): queue overflow`);
      // Broadcast the user's danmaku so it still appears in the UI
      broadcast({
        type: 'livestream_skipped',
        seq: item.seq,
        user: item.msg.user,
        source: item.msg.source,
        text: item.msg.text,
      });
      this._outputQueue.skip(item.seq);
    }
  }

  async _tryRun() {
    while (this._running < this._maxConcurrency && this._queue.length > 0) {
      const job = this._queue.shift();
      this._running++;
      this._processJob(job).finally(() => {
        this._running--;
        this._tryRun();
      });
    }
  }

  async _processJob({ seq, msg }) {
    const settings = getSettings();
    const t0 = Date.now();

    try {
      // Step 1: LLM generate (non-streaming, collect full response)
      const chatMessage = `[${msg.source}观众 ${msg.user}]: ${msg.text}`;
      let responseText = '';
      let chatError = null;

      const fakeWs = {
        send(data) {
          const parsed = JSON.parse(data);
          if (parsed.type === 'done') responseText = parsed.fullText;
          if (parsed.type === 'error') chatError = parsed.message;
        },
      };

      await handleChat(fakeWs, {
        type: 'chat',
        message: chatMessage,
        user: msg.user,
        mode: settings.livestream?.mode || 'fast',
      });

      if (chatError || !responseText) {
        console.error(`[Livestream] LLM error for seq ${seq}:`, chatError);
        this._outputQueue.skip(seq);
        return;
      }

      // Strip <think>...</think> blocks and stray </think> tags
      responseText = responseText
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<\/?think>/gi, '')
        .trim();

      const t1 = Date.now();

      // Step 2: TTS polish (expression detection) — concurrent with nothing, just do it
      const polishResult = await polishForTTS(responseText, settings);
      const { text: ttsText, expressions, emotion, action } = polishResult;

      // Step 3: TTS synthesize
      const voice = settings.dashscope?.voiceId || 'longanyang';
      const model = settings.dashscope?.ttsModel || 'cosyvoice-v3-flash';
      const rate = settings.voice?.rate ?? 1;
      const pitch = settings.voice?.pitch ?? 1;
      const volume = settings.voice?.volume ?? 50;

      let audioBuffer = null;
      let audioUrl = null;
      if (settings.dashscope?.apiKey && ttsText.trim()) {
        audioBuffer = await synthesize(ttsText, {
          apiKey: settings.dashscope.apiKey,
          model, voice, rate, pitch, volume,
        });

        // Write to temp file and serve via URL
        const audioDir = join(tmpdir(), 'distillme-livestream');
        await mkdir(audioDir, { recursive: true });
        const audioFile = join(audioDir, `ls-${seq}-${randomUUID().slice(0, 8)}.mp3`);
        await writeFile(audioFile, audioBuffer);
        audioUrl = `/api/livestream/audio/${encodeURIComponent(audioFile.split('/').pop())}`;

        // Schedule cleanup after 60s
        setTimeout(async () => {
          try { await unlink(audioFile); } catch {}
        }, 60000);
      }

      const elapsed = Date.now() - t0;
      console.log(`[Livestream] seq ${seq} ready (${elapsed}ms): ${msg.user} → ${responseText.slice(0, 40)}...`);

      // Submit to output queue
      this._outputQueue.submit(seq, {
        seq,
        user: msg.user,
        source: msg.source,
        text: msg.text,
        responseText,
        audioUrl,
        expressions,
        action,
        emotion,
      });

    } catch (err) {
      console.error(`[Livestream] Process error for seq ${seq}:`, err.message);
      this._outputQueue.skip(seq);
    }
  }
}

/* ── Danmaku Connector ── */

class DanmakuConnector {
  constructor(config, generation) {
    this.source = config.source || 'bilibili';
    this.roomId = config.roomId;
    this.mode = config.mode || 'fast';
    this.pollInterval = config.pollInterval || 10000;
    this.maxConcurrency = config.maxConcurrency || 3;
    this.running = false;
    this._timer = null;
    this._seenIds = new Set();
    this._seq = 0;
    this._apiBase = config.apiBase || '';
    this._generation = generation;

    // Output queue → broadcast only if this generation is still active
    this._outputQueue = new OrderedOutputQueue(async (seq, result) => {
      if (this._generation !== _generation) return; // stale generation, skip
      broadcast({
        type: 'livestream_ready',
        ...result,
      });
    });
    this._outputQueue.setBase(0);

    // Processing pool
    this._pool = new ProcessingPool(this.maxConcurrency, this._outputQueue);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._seq = 0;
    this._outputQueue.reset();
    this._outputQueue.setBase(0);
    console.log(`[Livestream] Started ${this.source} connector for room ${this.roomId} (concurrency: ${this.maxConcurrency})`);
    this._poll();
    this._timer = setInterval(() => this._poll(), this.pollInterval);
  }

  stop() {
    this.running = false;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    console.log('[Livestream] Connector stopped');
  }

  async _poll() {
    if (!this.running) return;
    try {
      const messages = await this._fetchDanmaku();
      this._errorCount = 0;
      for (const msg of messages) {
        if (this._seenIds.has(msg.id)) continue;
        this._seenIds.add(msg.id);
        if (this._seenIds.size > 1000) {
          const arr = [...this._seenIds];
          this._seenIds = new Set(arr.slice(-500));
        }

        const seq = this._seq++;
        msg.source = this.source;
        console.log(`[Livestream] Enqueue seq ${seq}: [${msg.user}] ${msg.text}`);

        // Trim queue if overwhelmed (keep at most 2x concurrency waiting)
        this._pool.trimQueue(this.maxConcurrency * 2);

        this._pool.enqueue(seq, msg);
      }
    } catch (err) {
      this._errorCount = (this._errorCount || 0) + 1;
      if (this._errorCount <= 1 || this._errorCount % 6 === 0) {
        console.error(`[Livestream] Poll error (x${this._errorCount}):`, err.message);
      }
    }
  }

  async _fetchDanmaku() {
    if (this.source === 'bilibili') {
      return this._fetchBilibili();
    }
    return [];
  }

  async _fetchBilibili() {
    const url = this._apiBase
      ? `${this._apiBase}/xlive/web-room/v1/dM/gethistory?roomid=${this.roomId}`
      : `https://api.live.bilibili.com/xlive/web-room/v1/dM/gethistory?roomid=${this.roomId}`;
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer': `https://live.bilibili.com/${this.roomId}`,
      },
    });

    if (!resp.ok) throw new Error(`Bilibili API ${resp.status}`);

    const data = await resp.json();
    if (data.code !== 0 || !data.data?.room) return [];

    return data.data.room.map(item => ({
      id: `${item.uid}_${item.timeline}`,
      user: item.nickname || `用户${item.uid}`,
      text: item.text,
      timestamp: item.timeline,
    }));
  }
}
