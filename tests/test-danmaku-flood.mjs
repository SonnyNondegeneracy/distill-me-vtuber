#!/usr/bin/env node
/**
 * test-danmaku-flood.mjs — Simulate ~20 danmaku messages over ~3 minutes
 *
 * Sends messages to POST /api/chat at randomized intervals.
 * Measures per-request latency and reports concurrency stats.
 *
 * Usage:
 *   node tests/test-danmaku-flood.mjs [baseUrl] [apiKey]
 *
 * Example:
 *   node tests/test-danmaku-flood.mjs http://localhost:3001
 *   node tests/test-danmaku-flood.mjs http://localhost:3001 my-secret-key
 */

const BASE_URL = process.argv[2] || 'http://localhost:3001';
const API_KEY = process.argv[3] || '';

const MESSAGES = [
  { user: '弹幕侠A', text: '主播好可爱！今天直播什么呀？' },
  { user: '夜猫子', text: '第一次来，关注了！' },
  { user: '学术狗', text: '请问你对量子计算怎么看？' },
  { user: '二次元boy', text: '这个模型是自己做的吗？好厉害' },
  { user: '路人甲', text: '主播唱首歌吧' },
  { user: '弹幕侠A', text: '你最喜欢的动漫是什么？' },
  { user: '深夜食堂', text: '刚下班来看看，今天聊什么话题' },
  { user: 'GPU战士', text: '你用的什么显卡跑的推理？' },
  { user: '哲学家', text: '你觉得AI会有意识吗？' },
  { user: '吃瓜群众', text: '哈哈哈哈前面那个问题好深奥' },
  { user: '弹幕侠A', text: '主播你平时几点播？' },
  { user: '留学生', text: 'Can you speak English too?'},
  { user: '二次元boy', text: '做个表情！开心的那种！' },
  { user: '编程猫', text: '这个直播系统是开源的吗？想看看代码' },
  { user: '夜猫子', text: '你的声音好好听，是克隆的吗' },
  { user: '学术狗', text: '能推荐几篇最近的AI论文吗？' },
  { user: '新人', text: '大家好！弹幕怎么发？' },
  { user: '深夜食堂', text: '主播吃夜宵了吗？要注意身体哦' },
  { user: 'GPU战士', text: '延迟怎么样，我这边感觉挺流畅的' },
  { user: '哲学家', text: '如果你是AI，那你怎么看待人类的孤独感？' },
];

// Randomized intervals summing to ~180s (3 min)
// Burst pattern: some clustered, some spread out
function generateSchedule(count, totalMs) {
  // Create random weights, then normalize to totalMs
  const raw = [];
  for (let i = 0; i < count; i++) {
    // Mix of short bursts (0.5-3s) and longer gaps (5-15s)
    raw.push(Math.random() < 0.4 ? Math.random() * 2500 + 500 : Math.random() * 10000 + 5000);
  }
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map(r => Math.round((r / sum) * totalMs));
}

async function sendMessage(msg, index) {
  const headers = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['Authorization'] = `Bearer ${API_KEY}`;

  const t0 = Date.now();
  try {
    const resp = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message: msg.text,
        user: msg.user,
        source: 'test',
      }),
    });

    const elapsed = Date.now() - t0;

    if (!resp.ok) {
      const err = await resp.text();
      console.log(`  [${index.toString().padStart(2)}] ✗ ${msg.user}: HTTP ${resp.status} (${elapsed}ms) — ${err.slice(0, 80)}`);
      return { ok: false, elapsed, index };
    }

    const data = await resp.json();
    const preview = (data.text || '').slice(0, 50).replace(/\n/g, ' ');
    console.log(`  [${index.toString().padStart(2)}] ✓ ${msg.user} → "${preview}..." (${elapsed}ms)`);
    return { ok: true, elapsed, index };
  } catch (err) {
    const elapsed = Date.now() - t0;
    console.log(`  [${index.toString().padStart(2)}] ✗ ${msg.user}: ${err.message} (${elapsed}ms)`);
    return { ok: false, elapsed, index };
  }
}

async function main() {
  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║  弹幕并发压力测试 — ${MESSAGES.length} 条消息 / ~3分钟     ║`);
  console.log(`║  ${BASE_URL.padEnd(44)}║`);
  console.log(`╚══════════════════════════════════════════════╝\n`);

  // Health check
  try {
    const r = await fetch(`${BASE_URL}/api/settings`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    console.log('✓ 服务器连接正常\n');
  } catch (err) {
    console.error(`✗ 无法连接服务器: ${err.message}`);
    console.error(`  请确认服务器运行在 ${BASE_URL}\n`);
    process.exit(1);
  }

  const delays = generateSchedule(MESSAGES.length, 180_000);
  const results = [];
  const startTime = Date.now();

  // Track in-flight requests for concurrency stats
  let inFlight = 0;
  let maxInFlight = 0;
  const concurrencyLog = [];

  console.log('发送计划 (每条消息的等待间隔):');
  let cumulative = 0;
  for (let i = 0; i < delays.length; i++) {
    cumulative += delays[i];
    const min = Math.floor(cumulative / 60000);
    const sec = ((cumulative % 60000) / 1000).toFixed(1);
    if (i % 5 === 0) {
      console.log(`  #${(i + 1).toString().padStart(2)}-${Math.min(i + 5, delays.length).toString().padStart(2)}: ${min}:${sec.padStart(4, '0')} ~ ...`);
    }
  }
  console.log(`  总时长: ~${Math.round(cumulative / 1000)}s\n`);
  console.log('── 开始发送 ──\n');

  const promises = [];

  for (let i = 0; i < MESSAGES.length; i++) {
    if (i > 0) {
      await new Promise(r => setTimeout(r, delays[i]));
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[${elapsed.padStart(6)}s] 发送 #${i + 1}: [${MESSAGES[i].user}] ${MESSAGES[i].text}`);

    inFlight++;
    if (inFlight > maxInFlight) maxInFlight = inFlight;
    concurrencyLog.push({ time: elapsed, inFlight });

    const p = sendMessage(MESSAGES[i], i + 1).then(result => {
      inFlight--;
      results.push(result);
      return result;
    });
    promises.push(p);
  }

  console.log('\n── 等待所有响应完成 ──\n');
  await Promise.all(promises);

  // Stats
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  const okResults = results.filter(r => r.ok);
  const failResults = results.filter(r => !r.ok);
  const latencies = okResults.map(r => r.elapsed).sort((a, b) => a - b);

  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║  测试结果                                    ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║  总耗时:     ${totalTime.padStart(8)}s                       ║`);
  console.log(`║  成功/失败:  ${String(okResults.length).padStart(3)} / ${String(failResults.length).padEnd(3)}                       ║`);
  console.log(`║  最大并发:   ${String(maxInFlight).padStart(3)}                             ║`);

  if (latencies.length > 0) {
    const avg = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
    const min = latencies[0];
    const max = latencies[latencies.length - 1];
    const p50 = latencies[Math.floor(latencies.length * 0.5)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];

    console.log('╠──────────────────────────────────────────────╣');
    console.log(`║  延迟 (ms):                                  ║`);
    console.log(`║    最小:     ${String(min).padStart(8)}                       ║`);
    console.log(`║    平均:     ${String(avg).padStart(8)}                       ║`);
    console.log(`║    P50:      ${String(p50).padStart(8)}                       ║`);
    console.log(`║    P95:      ${String(p95).padStart(8)}                       ║`);
    console.log(`║    最大:     ${String(max).padStart(8)}                       ║`);
  }

  console.log('╠──────────────────────────────────────────────╣');
  console.log('║  按完成顺序:                                 ║');
  results
    .sort((a, b) => a.index - b.index)
    .forEach(r => {
      const status = r.ok ? '✓' : '✗';
      const bar = '█'.repeat(Math.min(20, Math.round(r.elapsed / 1000)));
      console.log(`║  ${status} #${String(r.index).padStart(2)} ${bar.padEnd(20)} ${String(r.elapsed).padStart(6)}ms ║`);
    });

  console.log('╚══════════════════════════════════════════════╝\n');

  if (failResults.length > 0) {
    console.log(`⚠ ${failResults.length} 条消息失败，检查服务器日志了解详情`);
  }
}

main().catch(console.error);
