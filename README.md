<div align="center">

# DistillMe VTuber

### 让你的数字分身开口说话

*"蒸馏一个灵魂，赋予一副躯体，然后——开播。"*

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![DistillMe](https://img.shields.io/badge/DistillMe-v1.2.0-blueviolet)](https://github.com/SonnyNondegeneracy/distill-me)

[快速开始](#快速开始) · [功能特性](#功能特性) · [直播弹幕](#直播弹幕接入) · [架构](#架构) · [English](README_EN.md)

</div>

---

## 这是什么

[DistillMe](https://github.com/SonnyNondegeneracy/distill-me) 蒸馏出了一个有记忆、有个性的数字灵魂。**DistillMe VTuber** 给它一副 3D 躯体，让它**开口说话、做表情、直播互动**。

上传材料 → 一键蒸馏人格 → 接入 VRM 虚拟形象 → 语音克隆 → 开播。

```
你的聊天记录/日记/笔记
    ↓ 一键蒸馏
人格 + 记忆图谱
    ↓ VRM 形象 + 语音克隆
能说会动的数字分身
    ↓ 接入直播弹幕
全自动 VTuber 直播
```

![DistillMe VTuber 直播界面](demo.png)

---

## 功能特性

### 对话 — 不只是聊天框

文字输入 → 记忆检索 → LLM 生成 → TTS 语音 → 3D 表情 + 口型同步，全链路自动。

- **Full 模式**：FAISS 向量检索 + 关键词 + 记忆图谱行走，聊 1000 句还像你
- **Fast 模式**：跳过记忆检索，纯人格 + LLM，响应极快
- 对话历史自动保存，随时回顾

### 直播 — 弹幕驱动的 AI 主播

接入直播平台弹幕，AI 自动回复每条弹幕。

- **并发管线**：多条弹幕同时处理 LLM + TTS，按序播放
- **智能跳过**：队列满时自动跳过中间弹幕，不卡不延迟
- **完整记录**：直播弹幕 + AI 回复自动保存，可回看

### 表情 — 不是预设动画，是情感驱动

TTS 文本经 Polish 模型分析情感，返回多表情混合：

```json
{"happy": 0.7, "surprised": 0.3}
```

多个表情同时激活不同强度，语音结束后平滑回归中性。支持 `happy` `sad` `angry` `relaxed` `surprised` `neutral`。

### 语音克隆 — 用你自己的声音

上传 10-30 秒音频，DashScope CosyVoice 克隆你的声音。蒸馏材料里的音频也能直接用。

### 一键蒸馏 — 拖拽上传，全自动

拖拽上传 `.txt` `.md` `.json` `.csv` `.mp3` `.wav`：

扫描 → 人格提取 → 记忆提取 → 建索引 → 生成技能 → 语音克隆

后续有新材料？点 **Update** 增量更新，不重复处理。

---

## 快速开始

### 1. 环境要求

| 依赖 | 版本 | 用途 |
|------|------|------|
| [Node.js](https://nodejs.org/) | 18+ | 前后端运行 |
| Python | 3.10+ | FAISS 索引、嵌入模型（DistillMe 依赖） |
| [ffmpeg](https://ffmpeg.org/) | 任意 | 语音克隆音频格式转换 |

**API Keys（在控制面板设置标签页填入）：**

| 服务 | 用途 | 获取 |
|------|------|------|
| LLM API | 对话生成（Anthropic 兼容接口） | [Anthropic](https://console.anthropic.com/) / [DashScope](https://dashscope.console.aliyun.com/) 等 |
| DashScope API | CosyVoice TTS + 语音克隆 | [阿里云百炼](https://dashscope.console.aliyun.com/) |

### 2. 安装 DistillMe（记忆引擎）

```bash
git clone https://github.com/SonnyNondegeneracy/distill-me.git
cd distill-me
pip install torch>=2.0.0 sentence-transformers>=2.2.0 faiss-cpu>=1.7.4 numpy>=1.24.0
npm install
cd ..
```

### 3. 安装 DistillMe VTuber

```bash
git clone https://github.com/SonnyNondegeneracy/distill-me-vtuber.git
cd distill-me-vtuber
npm install
```

**npm 依赖（自动安装）：**

| 包 | 用途 |
|----|------|
| `express` + `ws` | HTTP + WebSocket 服务 |
| `@anthropic-ai/sdk` | Anthropic LLM API |
| `openai` | 兼容 OpenAI 格式的 LLM API（DashScope 等） |
| `three` + `@pixiv/three-vrm` | 3D 渲染 + VRM 模型加载 |
| `react` + `react-dom` | 前端 UI |
| `multer` | 文件上传（蒸馏材料、语音克隆音频） |
| `vite` | 前端构建 + 开发服务器 |

### 4. 准备 VRM 模型

需要一个 `.vrm` 格式的 3D 虚拟形象文件。可以从以下途径获取：

- [VRoid Hub](https://hub.vroid.com/) — 下载免费 VRM 模型
- [VRoid Studio](https://vroid.com/studio) — 自己创建 VRM 角色
- 任何支持 VRM 1.0 导出的 3D 工具

将 `.vrm` 文件放到本地任意路径，启动后在设置标签页或 `config.json` 中填入路径。

### 5. 启动

```bash
# 开发模式（前端热重载 + 后端）
npm run dev
# 前端: http://localhost:5173  ← 开发时打开这个
# 后端: http://localhost:3001  ← API + WebSocket

# 生产模式
npm run build && node server/index.mjs
# 前后端统一: http://localhost:3001
```

自定义端口：`PORT=8080 node server/index.mjs`

### 6. 首次配置

1. 打开浏览器 → **设置**标签页 → 填入：
   - DistillMe 路径（步骤 2 克隆的目录）
   - LLM API Key + Base URL + 模型名
   - DashScope API Key
   - Persona slug + userId
   - VRM 模型文件路径
2. 打开**蒸馏**标签页 → 拖拽上传材料文件 → 点击 **Distill**
3. 蒸馏完成后即可在**对话**模式与数字分身对话，或切换到**直播**模式开播

### 7. 测试

```bash
# 启动 mock 弹幕服务器（20 条弹幕 / ~3 分钟，自动配置直播设置）
node tests/mock-bilibili.mjs --auto

# 手动模式（只启动 mock 服务器，不自动开播）
node tests/mock-bilibili.mjs
```

---

## 直播弹幕接入

### 内置连接器

直播模式配置栏填写平台和房间号，设置并发数，点击「开播」即可。当前支持 Bilibili。

### REST API（外部脚本推送）

```bash
curl -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "你好呀", "user": "观众123", "source": "bilibili"}'
```

### OBS 直播叠加

1. OBS → 来源 → 浏览器 → `http://localhost:3001?mode=overlay`
2. 1920×1080，勾选「关闭源时刷新浏览器」
3. 设置中开启 Transparent Background

### API 参考

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/settings` | GET/POST | 读取/更新配置 |
| `/api/chat` | POST | 发送对话消息（`{ message, user?, source? }`） |
| `/api/tts` | POST | TTS 合成（`{ text, voice?, rate?, pitch?, volume? }`） |
| `/api/tts/clone` | POST | 语音克隆（multipart 上传或 `{ filePath }`） |
| `/api/tts/audio-files` | GET | 列出可用于克隆的音频文件 |
| `/api/identities` | GET | 获取身份列表 |
| `/api/livestream/status` | GET | 直播状态 |
| `/api/livestream/start` | POST | 开始直播 |
| `/api/livestream/stop` | POST | 停止直播 |
| `/api/distill/upload` | POST | 上传蒸馏材料（multipart） |
| `/api/distill/create` | POST | 执行蒸馏（SSE 流式进度） |
| `/api/distill/update` | POST | 增量更新（SSE 流式进度） |
| `/api/assets/*` | GET | 静态资源代理（VRM 模型等） |
| `/ws` | WebSocket | 流式对话 + 直播消息推送 |

---

## 架构

### 对话管线

```
用户输入 / 直播弹幕
    ↓
1. [Full] FAISS 向量 + 关键词 + 图谱行走 → ~log₂(n) 条记忆
   [Fast] 跳过
    ↓
2. System Prompt（人格 + 记忆注入）
    ↓
3. LLM 流式生成（Anthropic 兼容 API）
    ↓
4. Polish Model → 清理文本 + 情感分析 → 表情混合 + 动作
    ↓
5. CosyVoice TTS → 语音合成
    ↓
6. 前端同步：表情混合 + 动作动画 + 口型同步（Web Audio 振幅分析）
```

### 直播并发管线

```
弹幕流
    ↓
DanmakuConnector（轮询 / 推送）
    ↓
ProcessingPool（N 路并发）
    ├─ Worker 1: LLM → Polish → TTS
    ├─ Worker 2: LLM → Polish → TTS
    └─ Worker N: ...
    ↓
OrderedOutputQueue（按序号排序输出）
    ↓
WebSocket 广播 → 前端自动播放队列
```

### 项目结构

```
server/
  index.mjs        Express + WebSocket 入口
  ws.mjs           流式对话管线（Full/Fast + 记忆检索 + think 过滤）
  tts.mjs          CosyVoice TTS + 语音克隆 + Polish
  livestream.mjs   并发弹幕管线（处理池 + 有序队列 + generation 防重）
  distill.mjs      蒸馏后端（调用 DistillMe CLI）
  api.mjs          REST API
  config.mjs       配置读写

src/
  components/
    ControlPanel.jsx       主界面（标签页 + 自动播放队列 + 表情/动作）
    ChatPanel.jsx          对话/直播双模式
    LivestreamMessages.jsx 直播气泡布局（弹幕 + 回复 + 自动滚动）
    AvatarVRM.jsx          Three.js + VRM 渲染（表情混合 + 呼吸 + 动作）
    VoiceControls.jsx      语音参数 + 克隆
    DistillPanel.jsx       蒸馏 UI
  hooks/
    useChat.js             WebSocket + 对话/直播持久化
    useTTS.js              TTS 播放 + 表情回调
    useLipSync.js          音频 → 口型同步
  lib/
    lip-sync-analyzer.js   Web Audio 振幅分析
    vrm-expressions.js     VRM 表情控制（混合 + 淡出）
    vrm-actions.js         VRM 动作注册
```

---

## 配置

所有设置在控制面板标签页中**自动保存**到 `config.json`。也可以直接编辑：

```json
{
  "distillMePath": "/path/to/distill-me",
  "anthropic": {
    "apiKey": "sk-xxx",
    "baseUrl": "https://api.anthropic.com",
    "model": "claude-sonnet-4-6",
    "polishModel": "qwen-turbo"
  },
  "dashscope": {
    "apiKey": "sk-xxx",
    "ttsModel": "cosyvoice-v3-flash",
    "voiceId": ""
  },
  "persona": {
    "slug": "your-persona",
    "userId": "your-username"
  },
  "avatar": {
    "type": "vrm",
    "modelPath": "/path/to/model.vrm",
    "transparent": false
  }
}
```

---

## 与 DistillMe 的关系

[DistillMe](https://github.com/SonnyNondegeneracy/distill-me) 是记忆引擎——蒸馏人格、构建记忆图谱、四层检索管线。

**DistillMe VTuber** 是它的多模态前端——给数字灵魂加上 3D 躯体、声音、表情、直播能力。

```
DistillMe（灵魂）           DistillMe VTuber（躯体）
├─ 人格蒸馏                 ├─ VRM 3D 形象
├─ 记忆图谱                 ├─ TTS 语音克隆
├─ FAISS 向量检索           ├─ 表情混合 + 口型同步
├─ MLP 在线学习             ├─ 直播弹幕接入
└─ 身份系统                 └─ OBS 叠加层
```

同一套记忆检索管线驱动文字对话和直播互动——聊到第一千句还像你。

---

## License

MIT · 数据纯本地，不上传任何东西

</div>
