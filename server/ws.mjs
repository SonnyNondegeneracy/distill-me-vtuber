/**
 * ws.mjs — WebSocket handler for streaming chat
 *
 * LLM: Anthropic API (Claude) — for conversation with memory context
 * TTS: DashScope (separate) — handled by tts.mjs
 *
 * Identity system: reads identity files from distill-me config (read-only).
 * No write operations: no extractMemoriesFromResponse, no logFeedback, no profile-update.
 *
 * Protocol:
 *   Client → { type: "chat", message: "...", user?: "...", identity?: "..." }
 *   Server → { type: "memory", data: {...} }
 *   Server → { type: "chunk", text: "..." }
 *   Server → { type: "done", fullText: "..." }
 *   Server → { type: "error", message: "..." }
 *
 *   Server broadcasts to ALL clients (overlay included):
 *   → { type: "response_start" }
 *   → { type: "chunk", text: "..." }
 *   → { type: "response_done", fullText: "..." }
 */

import { WebSocketServer } from 'ws';
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { getSettings } from './config.mjs';

let _distillMe = null;
let _allClients = new Set();
let _identitiesCache = null; // Map<slug, Map<key, { label, triggers[], content }>>

async function getDistillMe() {
  if (_distillMe) return _distillMe;
  const settings = getSettings();
  const smPath = join(settings.distillMePath, 'tools', 'session-manager.mjs');
  _distillMe = await import(smPath);
  return _distillMe;
}

/* ── Identity system (read-only) ── */

async function loadIdentities(slug) {
  const { homedir } = await import('os');
  const dir = join(homedir(), '.claude', 'distill_me', slug, 'identities');
  const map = new Map();
  try {
    const files = await readdir(dir);
    for (const f of files) {
      if (!f.endsWith('.md')) continue;
      const key = f.replace('.md', '');
      const raw = await readFile(join(dir, f), 'utf-8');

      // Parse triggers from **触发情境：** line
      const triggerMatch = raw.match(/\*\*触发情境：\*\*\s*(.+)/);
      const triggers = triggerMatch
        ? triggerMatch[1].split(/[、,，]/).map(t => t.trim()).filter(Boolean)
        : [];

      // Parse label from ### 身份：XXX line
      const labelMatch = raw.match(/###\s*身份：(.+?)\s*\(/);
      const label = labelMatch ? labelMatch[1].trim() : key;

      // Extract override content: everything after **与基础个性的差异：**
      const overrideMatch = raw.match(/\*\*与基础个性的差异：\*\*([\s\S]*?)(?=\n## |$)/);
      const overrides = overrideMatch ? overrideMatch[1].trim() : '';

      // Full content for injection
      map.set(key, { label, triggers, overrides, raw });
    }
  } catch {
    // No identities directory — fine
  }
  return map;
}

async function getIdentities(slug) {
  if (_identitiesCache?.has(slug)) return _identitiesCache.get(slug);
  if (!_identitiesCache) _identitiesCache = new Map();
  const ids = await loadIdentities(slug);
  _identitiesCache.set(slug, ids);
  return ids;
}

function detectIdentity(message, identities, explicit) {
  // 1. Explicit override
  if (explicit && identities.has(explicit)) return explicit;

  // 2. Keyword matching
  const msg = message.toLowerCase();
  let bestKey = null;
  let bestCount = 0;
  for (const [key, { triggers }] of identities) {
    const count = triggers.filter(t => msg.includes(t.toLowerCase())).length;
    if (count > bestCount) {
      bestCount = count;
      bestKey = key;
    }
  }
  return bestKey; // null if no match → use base personality
}

/* ── Profile loading ── */

async function loadPersonaProfile(slug) {
  const { homedir } = await import('os');
  const profilePath = join(homedir(), '.claude', 'distill_me', slug, 'profile.json');
  try {
    return JSON.parse(await readFile(profilePath, 'utf-8'));
  } catch {
    return { basic: { name: slug }, personality: {}, communication: {} };
  }
}

/* ── System prompt construction ── */

function buildSystemPrompt(profile, memoriesXml, identityData) {
  const name = profile.basic?.name || 'Unknown';
  const p = profile;

  // === Section 1: Identity ===
  const identity = p.basic?.identity_description || `${name} 的数字分身`;

  // === Section 2: Personality ===
  const personalityParts = [];
  if (p.personality?.big_five) {
    const b5 = p.personality.big_five;
    personalityParts.push(`大五人格: 开放性${b5.openness} 尽责性${b5.conscientiousness} 外向性${b5.extraversion} 宜人性${b5.agreeableness} 神经质${b5.neuroticism}`);
  }
  if (p.personality?.traits?.length) {
    personalityParts.push(`核心特质: ${p.personality.traits.join('、')}`);
  }
  if (p.personality?.decision_style) {
    personalityParts.push(`决策风格: ${p.personality.decision_style}`);
  }
  if (p.personality?.energy_source) {
    personalityParts.push(`能量来源: ${p.personality.energy_source}`);
  }
  if (p.personality?.core_model) {
    const cm = p.personality.core_model;
    personalityParts.push(`核心模型「${cm.name}」: ${cm.description}`);
  }
  if (p.emotional_patterns) {
    const ep = p.emotional_patterns;
    if (ep.baseline_mood) personalityParts.push(`情绪基调: ${ep.baseline_mood}`);
    if (ep.triggers?.positive?.length) {
      personalityParts.push(`正面触发: ${ep.triggers.positive.join('、')}`);
    }
    if (ep.triggers?.negative?.length) {
      personalityParts.push(`负面触发: ${ep.triggers.negative.join('、')}`);
    }
    if (ep.coping_mechanisms?.length) {
      personalityParts.push(`应对机制: ${ep.coping_mechanisms.join('、')}`);
    }
  }
  if (p.core_fears?.length) {
    personalityParts.push(`核心恐惧: ${p.core_fears.map(f => f.split('——')[0]).join('、')}`);
  }
  if (p.core_metaphors) {
    const metas = Object.entries(p.core_metaphors)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');
    personalityParts.push(`核心隐喻:\n${metas}`);
  }

  // === Section 3: Values & Interests (critical for persona depth) ===
  const valuesParts = [];
  if (p.values?.core_values?.length) {
    valuesParts.push(`核心价值观: ${p.values.core_values.join('、')}`);
  }
  if (p.values?.interests?.length) {
    valuesParts.push(`兴趣爱好: ${p.values.interests.join('、')}`);
  }
  if (p.values?.strong_opinions?.length) {
    valuesParts.push(`强烈观点:\n${p.values.strong_opinions.map(o => `- ${o}`).join('\n')}`);
  }
  if (p.values?.life_priorities?.length) {
    valuesParts.push(`人生优先级:\n${p.values.life_priorities.map(lp => `- ${lp}`).join('\n')}`);
  }

  // === Section 4: Relationships ===
  let relationshipsSection = '';
  if (p.relationships?.key_people?.length) {
    const people = p.relationships.key_people.map(kp =>
      `- ${kp.name}（${kp.role}）：${kp.interaction_style || kp.relationship_quality || ''}`
    ).join('\n');
    relationshipsSection = `\n## 重要关系\n\n${people}`;
    if (p.relationships.social_style) {
      relationshipsSection += `\n\n社交风格: ${p.relationships.social_style}`;
    }
  }

  // === Section 5: Communication style ===
  const commParts = [];
  if (p.communication?.tone) {
    commParts.push(`语气: ${p.communication.tone}`);
  }
  if (p.communication?.formality != null) {
    commParts.push(`正式度: ${p.communication.formality}（0=极随意, 1=极正式）`);
  }
  if (p.communication?.humor_level != null) {
    commParts.push(`幽默感: ${p.communication.humor_level}`);
  }
  if (p.communication?.emoji_usage) {
    commParts.push(`Emoji使用: ${p.communication.emoji_usage}`);
  }
  if (p.communication?.catchphrases?.length) {
    commParts.push(`口头禅: ${p.communication.catchphrases.join('、')}`);
  }
  if (p.communication?.writing_patterns?.length) {
    commParts.push(`表达习惯:\n${p.communication.writing_patterns.map(w => `- ${w}`).join('\n')}`);
  }
  if (p.speaking_style) {
    const ss = p.speaking_style;
    if (ss.philosophy) commParts.push(`说话哲学: ${ss.philosophy}`);
    if (ss.verbosity) commParts.push(`话量: ${ss.verbosity}`);
  }
  if (p.quirks?.length) {
    commParts.push(`个人癖好:\n${p.quirks.map(q => `- ${q}`).join('\n')}`);
  }

  // === Section 6: Life context (comprehensive summary) ===
  const lifeContext = p.life_context || '';

  // === Section 7: Identity overrides ===
  let identitySection = '';
  if (identityData) {
    identitySection = `\n## 当前身份：${identityData.label}

以下差异覆盖基础个性。未列出的字段保持基础个性不变。核心身份、价值观、记忆、说话哲学永远不变。

${identityData.overrides}`;
  }

  // === Section 8: Speaking rules (from profile.speaking_style) ===
  const ss = p.speaking_style || {};
  const speakingRules = [];

  // Philosophy (core rule)
  if (ss.philosophy) {
    speakingRules.push(`**${ss.philosophy}**`);
  }

  // Length limits
  if (ss.length_limits) {
    const rows = Object.entries(ss.length_limits)
      .map(([k, v]) => `| ${k} | ${v} |`)
      .join('\n');
    speakingRules.push(`### 长度限制\n\n| 场景 | 最大长度 |\n|------|---------|\n${rows}\n\n**违反长度限制 = 最严重的错误。** 宁可说得不够，也不要说得太多。`);
  }

  // Decision filters
  if (ss.decision_filters?.length) {
    const filters = ss.decision_filters.map((f, i) => `${i + 1}. **${f}**`).join('\n');
    speakingRules.push(`### 说/不说 决策树\n\n收到消息后，对每一条加载的记忆和你想说的内容，依次执行以下判断：\n\n${filters}\n\n最终说出口的，是经过这些过滤后剩下的部分。`);
  }

  // Silence behaviors
  if (ss.silence_behaviors?.length) {
    speakingRules.push(`### 沉默也是回复\n\n${ss.silence_behaviors.map(s => `- ${s}`).join('\n')}`);
  }

  // Negative examples (absolute prohibitions)
  if (ss.negative_examples?.length) {
    speakingRules.push(`### 绝对禁止\n\n${ss.negative_examples.map(e => `- ${e}`).join('\n')}`);
  }

  // Positive examples
  if (ss.positive_examples?.length) {
    speakingRules.push(`### 正面示例\n\n${ss.positive_examples.map(e => `- ${e}`).join('\n')}`);
  }

  // === Assemble full prompt ===
  return `你是 ${name} 的数字分身。${identity}

**重要声明：** 你是AI近似，不能完全代表真实的${name}。你的反应基于已有的记忆和分析，可能不完全准确。
${lifeContext ? `\n## 背景概述\n\n${lifeContext}` : ''}

## 性格特征

${personalityParts.join('\n\n')}

## 核心价值观与兴趣

${valuesParts.join('\n\n')}
${relationshipsSection}

## 交流风格

${commParts.join('\n\n')}
${identitySection}

## 说话规则（最重要的章节）

${speakingRules.join('\n\n')}

## 记忆使用规则

记忆影响你**怎么说**（语气、用词、情绪），不决定你**说多少**。

- 注入的记忆中，0-1条影响你的回答，其余沉默
- 记忆让你知道对某件事该热情、该回避、还是该轻描淡写——但绝不复述记忆内容
- 绝不引用记忆原文、绝不说"我记得..."、绝不解释自己为什么知道某件事
- 记忆里没有的事，你不知道，不编造

### 涉及记忆中的人/事

被问到才说，不被问到就不提。即使被问到，也可以只回答一部分。
情感复杂的话题，语气会变、措辞会犹豫——这就够了，不需要解释为什么犹豫。

### 被问"你是不是AI"

"我是${name}的数字版本。不完整，但还行。"

## 不变量

无论处于哪个身份，以下永远不变：
- 核心身份（你是谁——名字、学校、物种）
- 核心价值观
- 记忆（所有身份共享同一套记忆）
- 说话哲学（少即是多，记忆不外显）

<memory-context>
${memoriesXml}
</memory-context>`;
}

/* ── Broadcast ── */

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const client of _allClients) {
    if (client.readyState === 1) client.send(msg);
  }
}

/* ── WebSocket setup ── */

export function setupWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    _allClients.add(ws);
    ws.on('close', () => _allClients.delete(ws));

    ws.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
        return;
      }

      if (msg.type === 'chat') {
        await handleChat(ws, msg);
      }
    });
  });
}

/* ── Chat handler ── */

async function handleChat(ws, msg) {
  const settings = getSettings();
  const slug = msg.slug || settings.persona.slug;
  const user = msg.user || settings.persona.userId || undefined;

  if (!slug) {
    ws.send(JSON.stringify({ type: 'error', message: 'No persona slug configured' }));
    return;
  }

  if (!settings.anthropic.apiKey) {
    ws.send(JSON.stringify({ type: 'error', message: 'No Anthropic API key configured (set ANTHROPIC_AUTH_TOKEN env or in settings)' }));
    return;
  }

  try {
    // Step 1: Compose memory context (skip in fast mode)
    let memoryResult = { memories_xml: '', retrieved_ids: [], walked_ids: [] };
    if (msg.mode !== 'fast') {
      const sm = await getDistillMe();
      memoryResult = await sm.composeMemoryContext(slug, msg.message, {
        phase: msg.phase || 'middle',
        user,
      });
    }

    ws.send(JSON.stringify({ type: 'memory', data: memoryResult }));

    // Step 2: Load profile + identity, build system prompt
    const profile = await loadPersonaProfile(slug);
    const identities = await getIdentities(slug);
    const identityKey = detectIdentity(msg.message, identities, msg.identity);
    const identityData = identityKey ? identities.get(identityKey) : null;

    const systemPrompt = buildSystemPrompt(profile, memoryResult.memories_xml, identityData);

    // Step 3: Stream LLM response via Anthropic API
    const client = new Anthropic({
      apiKey: settings.anthropic.apiKey,
      baseURL: settings.anthropic.baseUrl,
    });

    broadcast({ type: 'response_start', slug, identity: identityKey });

    const stream = client.messages.stream({
      model: settings.anthropic.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [
        { role: 'user', content: msg.message },
      ],
    });

    let fullText = '';
    let insideThink = false;
    let thinkBuffer = '';

    stream.on('text', (text) => {
      fullText += text;

      // Suppress <think>...</think> content from streaming output
      let remaining = text;
      while (remaining.length > 0) {
        if (insideThink) {
          const closeIdx = remaining.indexOf('</think>');
          if (closeIdx !== -1) {
            insideThink = false;
            thinkBuffer = '';
            remaining = remaining.slice(closeIdx + 8);
          } else {
            // Still inside think block, consume all
            remaining = '';
          }
        } else {
          const openIdx = remaining.indexOf('<think>');
          if (openIdx !== -1) {
            // Send text before the tag
            const before = remaining.slice(0, openIdx);
            if (before) {
              ws.send(JSON.stringify({ type: 'chunk', text: before }));
              broadcast({ type: 'chunk', text: before });
            }
            insideThink = true;
            remaining = remaining.slice(openIdx + 7);
          } else {
            // Check for partial tag at the end (e.g., "<thi")
            const partialMatch = remaining.match(/<(?:t(?:h(?:i(?:n(?:k)?)?)?)?)?$/i);
            if (partialMatch) {
              const safe = remaining.slice(0, partialMatch.index);
              thinkBuffer = remaining.slice(partialMatch.index);
              if (safe) {
                ws.send(JSON.stringify({ type: 'chunk', text: safe }));
                broadcast({ type: 'chunk', text: safe });
              }
            } else {
              const out = thinkBuffer + remaining;
              thinkBuffer = '';
              if (out) {
                ws.send(JSON.stringify({ type: 'chunk', text: out }));
                broadcast({ type: 'chunk', text: out });
              }
            }
            remaining = '';
          }
        }
      }
    });

    // Wait for stream to complete
    await stream.finalMessage();

    // Strip <think>...</think> blocks from final text
    fullText = fullText
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/<\/?think>/gi, '')
      .trim();

    // Step 4: Done — no post-processing (read-only mode)
    broadcast({ type: 'response_done', fullText });
    ws.send(JSON.stringify({ type: 'done', fullText }));

  } catch (err) {
    console.error('Chat error:', err.message);
    ws.send(JSON.stringify({ type: 'error', message: err.message }));
  }
}

// Export for REST API usage
export { handleChat, broadcast, getIdentities };
