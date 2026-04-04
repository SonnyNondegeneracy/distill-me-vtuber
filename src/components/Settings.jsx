import React, { useState, useEffect, useRef } from 'react';

const fieldStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  marginBottom: 12,
};

const labelStyle = {
  fontSize: 12,
  color: '#888',
};

const inputStyle = {
  padding: '8px 12px',
  background: '#2a2a4a',
  border: '1px solid #444',
  borderRadius: 6,
  color: '#e0e0e0',
  fontSize: 12,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

export default function Settings() {
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const saveTimerRef = useRef(null);

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(setSettings)
      .catch(() => setStatus('加载设置失败'));
  }, []);

  const doSave = (data) => {
    const payload = JSON.parse(JSON.stringify(data));
    if (payload.anthropic?.apiKey?.startsWith('***')) delete payload.anthropic.apiKey;
    if (payload.dashscope?.apiKey?.startsWith('***')) delete payload.dashscope.apiKey;
    if (payload.livestream?.apiKey?.startsWith('***')) delete payload.livestream.apiKey;

    return fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  };

  const update = (path, value) => {
    setSettings(prev => {
      const next = { ...prev };
      const parts = path.split('.');
      let obj = next;
      for (let i = 0; i < parts.length - 1; i++) {
        obj[parts[i]] = { ...obj[parts[i]] };
        obj = obj[parts[i]];
      }
      obj[parts[parts.length - 1]] = value;

      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        setStatus('保存中...');
        doSave(next).then(resp => {
          setStatus(resp.ok ? '已保存' : '保存失败');
          setTimeout(() => setStatus(''), 2000);
        }).catch(() => {
          setStatus('保存失败');
          setTimeout(() => setStatus(''), 2000);
        });
      }, 800);

      return next;
    });
  };

  if (!settings) return <div style={{ color: '#666', padding: 12 }}>加载中...</div>;

  return (
    <div style={{ overflowY: 'auto', flex: 1 }}>
      <h3 style={{ fontSize: 18, color: '#aaa', marginBottom: 8, marginTop: 0 }}>LLM API</h3>
      <div style={fieldStyle}>
        <label style={labelStyle}>API Key {settings.anthropic?.apiKey?.startsWith('***') && <span style={{ color: '#6b6' }}>(已设置)</span>}</label>
        <input
          style={inputStyle}
          type="password"
          value={settings.anthropic?.apiKey || ''}
          onChange={e => update('anthropic.apiKey', e.target.value)}
          placeholder="sk-...（不修改则保留当前密钥）"
        />
      </div>
      <div style={fieldStyle}>
        <label style={labelStyle}>Base URL</label>
        <input
          style={inputStyle}
          value={settings.anthropic?.baseUrl || ''}
          onChange={e => update('anthropic.baseUrl', e.target.value)}
        />
      </div>
      <div style={fieldStyle}>
        <label style={labelStyle}>对话模型</label>
        <input
          style={inputStyle}
          value={settings.anthropic?.model || ''}
          onChange={e => update('anthropic.model', e.target.value)}
        />
      </div>
      <div style={fieldStyle}>
        <label style={labelStyle}>Polish 模型（TTS 表情识别）</label>
        <input
          style={inputStyle}
          value={settings.anthropic?.polishModel || ''}
          onChange={e => update('anthropic.polishModel', e.target.value)}
          placeholder="例如 qwen-turbo"
        />
      </div>
      <div style={fieldStyle}>
        <label style={labelStyle}>对话模式</label>
        <div style={{ display: 'flex', gap: 0 }}>
          {['full', 'fast'].map(m => (
            <button
              key={m}
              onClick={() => update('voice.ttsMode', m)}
              style={{
                flex: 1,
                padding: '5px 0',
                fontSize: 12,
                fontWeight: (settings.voice?.ttsMode || 'full') === m ? 600 : 400,
                color: (settings.voice?.ttsMode || 'full') === m ? '#ccc' : '#666',
                background: (settings.voice?.ttsMode || 'full') === m ? '#3a3a6a' : '#2a2a4a',
                border: '1px solid #444',
                borderRadius: m === 'full' ? '4px 0 0 4px' : '0 4px 4px 0',
                cursor: 'pointer',
              }}
            >
              {m === 'full' ? '完整' : '快速'}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
          {(settings.voice?.ttsMode || 'full') === 'fast' ? '跳过记忆检索，响应更快' : '完整管线，包含记忆检索'}
        </div>
      </div>

      <h3 style={{ fontSize: 18, color: '#aaa', marginBottom: 8, marginTop: 16 }}>DashScope (TTS)</h3>
      <div style={fieldStyle}>
        <label style={labelStyle}>API Key {settings.dashscope?.apiKey?.startsWith('***') && <span style={{ color: '#6b6' }}>(已设置)</span>}</label>
        <input
          style={inputStyle}
          type="password"
          value={settings.dashscope?.apiKey || ''}
          onChange={e => update('dashscope.apiKey', e.target.value)}
          placeholder="sk-...（不修改则保留当前密钥）"
        />
      </div>

      <h3 style={{ fontSize: 18, color: '#aaa', marginBottom: 8, marginTop: 16 }}>人格</h3>
      <div style={fieldStyle}>
        <label style={labelStyle}>Slug</label>
        <input
          style={inputStyle}
          value={settings.persona?.slug || ''}
          onChange={e => update('persona.slug', e.target.value)}
        />
      </div>
      <div style={fieldStyle}>
        <label style={labelStyle}>用户 ID</label>
        <input
          style={inputStyle}
          value={settings.persona?.userId || ''}
          onChange={e => update('persona.userId', e.target.value)}
        />
      </div>

      <h3 style={{ fontSize: 18, color: '#aaa', marginBottom: 8, marginTop: 16 }}>虚拟形象</h3>
      <div style={fieldStyle}>
        <label style={labelStyle}>模型路径（绝对路径）</label>
        <input
          style={inputStyle}
          value={settings.avatar?.modelPath || ''}
          onChange={e => update('avatar.modelPath', e.target.value)}
          placeholder="/path/to/model.vrm"
        />
      </div>
      <div style={fieldStyle}>
        <label style={{ ...labelStyle, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <span>透明背景（OBS）</span>
          <input
            type="checkbox"
            checked={settings.avatar?.transparent ?? false}
            onChange={e => update('avatar.transparent', e.target.checked)}
            style={{ accentColor: '#5a5aaa' }}
          />
        </label>
      </div>

      <h3 style={{ fontSize: 18, color: '#aaa', marginBottom: 8, marginTop: 16 }}>直播</h3>
      <div style={fieldStyle}>
        <label style={{ ...labelStyle, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <span>启用直播 API</span>
          <input
            type="checkbox"
            checked={settings.livestream?.enabled ?? false}
            onChange={e => update('livestream.enabled', e.target.checked)}
            style={{ accentColor: '#5a5aaa' }}
          />
        </label>
      </div>
      <div style={fieldStyle}>
        <label style={labelStyle}>来源平台</label>
        <input
          style={inputStyle}
          value={settings.livestream?.source || ''}
          onChange={e => update('livestream.source', e.target.value)}
          placeholder="bilibili / youtube / twitch"
        />
      </div>
      <div style={fieldStyle}>
        <label style={labelStyle}>房间号 / 频道 ID</label>
        <input
          style={inputStyle}
          value={settings.livestream?.roomId || ''}
          onChange={e => update('livestream.roomId', e.target.value)}
          placeholder="例如 Bilibili 直播间号"
        />
      </div>
      <div style={fieldStyle}>
        <label style={labelStyle}>轮询间隔（毫秒）</label>
        <input
          style={inputStyle}
          type="number"
          value={settings.livestream?.pollInterval || 10000}
          onChange={e => update('livestream.pollInterval', parseInt(e.target.value) || 10000)}
        />
      </div>
      <div style={fieldStyle}>
        <label style={labelStyle}>模式</label>
        <select
          style={inputStyle}
          value={settings.livestream?.mode || 'fast'}
          onChange={e => update('livestream.mode', e.target.value)}
        >
          <option value="fast">快速（跳过记忆）</option>
          <option value="full">完整（含记忆检索）</option>
        </select>
      </div>
      <div style={fieldStyle}>
        <label style={labelStyle}>API 密钥（可选鉴权）</label>
        <input
          style={inputStyle}
          type="password"
          value={settings.livestream?.apiKey || ''}
          onChange={e => update('livestream.apiKey', e.target.value)}
          placeholder="留空则不需要鉴权"
        />
      </div>

      <h3 style={{ fontSize: 18, color: '#aaa', marginBottom: 8, marginTop: 16 }}>字幕</h3>
      <div style={fieldStyle}>
        <label style={labelStyle}>字体大小</label>
        <input
          style={inputStyle}
          type="number"
          value={settings.subtitle?.fontSize || 28}
          onChange={e => update('subtitle.fontSize', parseInt(e.target.value) || 28)}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 16, alignItems: 'center' }}>
        {status && <span style={{ fontSize: 12, color: status === '已保存' ? '#6b6' : status === '保存中...' ? '#aaa' : '#f66' }}>{status}</span>}
      </div>
    </div>
  );
}
