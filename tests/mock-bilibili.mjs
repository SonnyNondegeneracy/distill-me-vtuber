#!/usr/bin/env node
/**
 * mock-bilibili.mjs — Fake Bilibili danmaku API for testing the full livestream pipeline.
 *
 * Mimics https://api.live.bilibili.com/xlive/web-room/v1/dM/gethistory
 * Feeds ~20 messages over ~3 minutes with realistic timing patterns.
 *
 * Usage:
 *   1. Start this mock:  node tests/mock-bilibili.mjs
 *   2. Configure DistillMe settings:
 *        livestream.enabled = true
 *        livestream.source = "bilibili"
 *        livestream.roomId = "test"
 *        livestream.apiBase = "http://localhost:3099"
 *        livestream.pollInterval = 5000
 *   3. Start/restart DistillMe server
 *   4. Watch the "直播" tab in the UI — messages should appear as they're processed
 *
 *   Or use --auto to configure and start via API:
 *     node tests/mock-bilibili.mjs --auto
 */

import http from 'http';

const PORT = 3099;
const DISTILLME_URL = 'http://localhost:3001';
const AUTO_MODE = process.argv.includes('--auto');

const DANMAKU_SCRIPT = [
  { delay: 0,     uid: 10001, nickname: '弹幕侠A',    text: '主播好可爱！今天直播什么呀？' },
  { delay: 8000,  uid: 10002, nickname: '夜猫子',      text: '第一次来，关注了！' },
  { delay: 10000, uid: 10003, nickname: '学术狗',      text: '请问你对量子计算怎么看？' },
  { delay: 18000, uid: 10004, nickname: '二次元boy',   text: '这个模型是自己做的吗？好厉害' },
  { delay: 22000, uid: 10005, nickname: '路人甲',      text: '主播唱首歌吧' },
  { delay: 30000, uid: 10001, nickname: '弹幕侠A',    text: '你最喜欢的动漫是什么？' },
  { delay: 45000, uid: 10006, nickname: '深夜食堂',    text: '刚下班来看看，今天聊什么话题' },
  { delay: 48000, uid: 10007, nickname: 'GPU战士',     text: '你用的什么显卡跑的推理？' },
  { delay: 60000, uid: 10008, nickname: '哲学家',      text: '你觉得AI会有意识吗？' },
  { delay: 65000, uid: 10009, nickname: '吃瓜群众',    text: '哈哈哈哈前面那个问题好深奥' },
  { delay: 75000, uid: 10001, nickname: '弹幕侠A',    text: '主播你平时几点播？' },
  { delay: 80000, uid: 10010, nickname: '留学生',      text: 'Can you speak English too?' },
  { delay: 95000, uid: 10004, nickname: '二次元boy',   text: '做个表情！开心的那种！' },
  { delay: 100000,uid: 10011, nickname: '编程猫',      text: '这个直播系统是开源的吗？想看看代码' },
  { delay: 115000,uid: 10002, nickname: '夜猫子',      text: '你的声音好好听，是克隆的吗' },
  { delay: 130000,uid: 10003, nickname: '学术狗',      text: '能推荐几篇最近的AI论文吗？' },
  { delay: 140000,uid: 10012, nickname: '新人',        text: '大家好！弹幕怎么发？' },
  { delay: 155000,uid: 10006, nickname: '深夜食堂',    text: '主播吃夜宵了吗？要注意身体哦' },
  { delay: 165000,uid: 10007, nickname: 'GPU战士',     text: '延迟怎么样，我这边感觉挺流畅的' },
  { delay: 170000,uid: 10008, nickname: '哲学家',      text: '如果你是AI，那你怎么看待人类的孤独感？' },
];

// Messages that have "appeared" so far, based on elapsed time
const startTime = Date.now();
let messageSeq = 0;

function getVisibleMessages() {
  const elapsed = Date.now() - startTime;
  const visible = [];
  for (const msg of DANMAKU_SCRIPT) {
    if (msg.delay <= elapsed) {
      const timeline = new Date(startTime + msg.delay).toISOString().replace('T', ' ').slice(0, 19);
      visible.push({
        uid: msg.uid,
        nickname: msg.nickname,
        text: msg.text,
        timeline,
      });
    }
  }
  // Bilibili API returns latest 10 messages
  return visible.slice(-10);
}

// Create mock HTTP server
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/xlive/web-room/v1/dM/gethistory') {
    const roomId = url.searchParams.get('roomid');
    const messages = getVisibleMessages();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[${elapsed.padStart(7)}s] Poll from connector — returning ${messages.length} messages`);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      code: 0,
      data: {
        room: messages,
      },
    }));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

async function configureDistillMe() {
  console.log('配置 DistillMe 直播设置...');
  try {
    const resp = await fetch(`${DISTILLME_URL}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        livestream: {
          enabled: true,
          source: 'bilibili',
          roomId: 'test',
          apiBase: `http://localhost:${PORT}`,
          pollInterval: 5000,
          mode: 'fast',
          maxConcurrency: 3,
        },
      }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    console.log('✓ 设置已更新');

    // Start the livestream
    const startResp = await fetch(`${DISTILLME_URL}/api/livestream/start`, { method: 'POST' });
    const startData = await startResp.json();
    console.log('✓ 直播已启动:', startData);
  } catch (err) {
    console.error('✗ 配置失败:', err.message);
    console.error(`  请确认 DistillMe 服务器运行在 ${DISTILLME_URL}`);
    process.exit(1);
  }
}

server.listen(PORT, async () => {
  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║  Mock Bilibili 弹幕服务器                        ║`);
  console.log(`║  端口: ${PORT}                                       ║`);
  console.log(`║  弹幕数: ${DANMAKU_SCRIPT.length} 条 / ~${Math.round(DANMAKU_SCRIPT[DANMAKU_SCRIPT.length - 1].delay / 1000)}s                          ║`);
  console.log(`╚══════════════════════════════════════════════════╝\n`);

  if (AUTO_MODE) {
    await configureDistillMe();
    console.log('\n自动模式已启动。弹幕将按计划逐条出现。');
    console.log('打开浏览器 → 直播 tab 查看效果。\n');
  } else {
    console.log('手动模式。请在 DistillMe 设置中配置:');
    console.log(`  livestream.enabled = true`);
    console.log(`  livestream.source = "bilibili"`);
    console.log(`  livestream.roomId = "test"`);
    console.log(`  livestream.apiBase = "http://localhost:${PORT}"`);
    console.log(`  livestream.pollInterval = 5000\n`);
  }

  console.log('弹幕时间线:');
  for (const msg of DANMAKU_SCRIPT) {
    const min = Math.floor(msg.delay / 60000);
    const sec = ((msg.delay % 60000) / 1000).toFixed(0).padStart(2, '0');
    console.log(`  ${min}:${sec}  [${msg.nickname}] ${msg.text}`);
  }
  console.log('\n── 等待轮询 ──\n');

  // Auto-stop after all messages + 2min for processing
  const totalDuration = DANMAKU_SCRIPT[DANMAKU_SCRIPT.length - 1].delay + 120000;
  setTimeout(() => {
    console.log('\n所有弹幕已发送完毕，等待处理超时，关闭mock服务器。');
    if (AUTO_MODE) {
      fetch(`${DISTILLME_URL}/api/livestream/stop`, { method: 'POST' }).catch(() => {});
    }
    process.exit(0);
  }, totalDuration);
});
