import React, { useState, useEffect, useRef, useCallback } from 'react';

const STEPS = {
  scan: '扫描文件',
  init: '初始化',
  profile: '提取人格',
  memories: '提取记忆',
  index: '构建索引',
  links: '生成链接',
  skill: '生成技能',
  voice: '克隆声音',
  markdone: '完成收尾',
  diff: '检测变更',
};

const AUDIO_EXTS = new Set(['.mp3', '.m4a', '.wav', '.ogg', '.flac', '.aac']);

/** Format character count: 1234 → "1.2K", 12345 → "12.3K" */
function fmtChars(n) {
  if (!n) return '0';
  if (n < 1000) return String(n);
  if (n < 1000000) return (n / 1000).toFixed(1) + 'K';
  return (n / 1000000).toFixed(1) + 'M';
}

export default function DistillPanel({ currentSlug }) {
  const [slug, setSlug] = useState(currentSlug || '');
  const [name, setName] = useState('');
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);
  const logRef = useRef(null);

  // Sync slug when currentSlug prop changes (e.g. after settings load)
  useEffect(() => {
    if (currentSlug && !slug) setSlug(currentSlug);
  }, [currentSlug]);

  const loadFiles = useCallback(async () => {
    if (!slug) return;
    try {
      const resp = await fetch(`/api/distill/files?slug=${encodeURIComponent(slug)}`);
      const data = await resp.json();
      setFiles(data);
    } catch { /* ignore */ }
  }, [slug]);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [steps]);

  const handleUpload = async (fileList) => {
    if (!fileList?.length) return;
    const s = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
    if (!s) return;
    if (!slug) setSlug(s);

    setUploading(true);
    const formData = new FormData();
    formData.append('slug', s);
    for (const f of fileList) formData.append('files', f);

    try {
      await fetch(`/api/distill/upload?slug=${encodeURIComponent(s)}`, { method: 'POST', body: formData });
      await loadFiles();
    } catch (e) {
      console.error('Upload error:', e);
    }
    setUploading(false);
  };

  const handleDelete = async (fileName) => {
    const s = slug || currentSlug;
    if (!s) return;
    try {
      await fetch(`/api/distill/files/${encodeURIComponent(fileName)}?slug=${encodeURIComponent(s)}`, { method: 'DELETE' });
      await loadFiles();
    } catch { /* ignore */ }
  };

  const runPipeline = async (mode) => {
    const s = slug || currentSlug;
    if (!s) return;

    setRunning(true);
    setSteps([]);
    setResult(null);
    setError(null);

    const body = mode === 'create' ? { slug: s, name: name || s } : { slug: s };

    try {
      const resp = await fetch(`/api/distill/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const err = await resp.json();
        setError(err.error || 'Request failed');
        setRunning(false);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        let eventType = null;
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ') && eventType) {
            try {
              const data = JSON.parse(line.slice(6));
              if (eventType === 'progress') {
                setSteps(prev => {
                  const idx = prev.findIndex(s => s.step === data.step);
                  if (idx >= 0) { const next = [...prev]; next[idx] = data; return next; }
                  return [...prev, data];
                });
              } else if (eventType === 'done') { setResult(data); }
              else if (eventType === 'error') { setError(data.message); }
            } catch { /* ignore */ }
            eventType = null;
          }
        }
      }
    } catch (e) { setError(e.message); }
    setRunning(false);
  };

  const hasTextFiles = files.some(f => !AUDIO_EXTS.has(f.ext));
  const hasAudioFiles = files.some(f => AUDIO_EXTS.has(f.ext));
  const isExisting = !!currentSlug;

  return (
    <div style={{ overflowY: 'auto', flex: 1 }}>
      {/* Name input */}
      {!isExisting && (
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>人格名称</label>
          <input
            value={name}
            onChange={e => { setName(e.target.value); setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/-+$/, '')); }}
            placeholder="例如 Nondegeneracy"
            disabled={running}
            style={{
              width: '100%', padding: '8px 12px', background: '#2a2a4a', border: '1px solid #444',
              borderRadius: 6, color: '#e0e0e0', fontSize: 12, boxSizing: 'border-box',
            }}
          />
          {slug && <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>slug: {slug}</div>}
        </div>
      )}
      {isExisting && (
        <div style={{ marginBottom: 12, fontSize: 12, color: '#aaa' }}>
          当前人格: <strong style={{ color: '#ccc' }}>{currentSlug}</strong>
        </div>
      )}

      {/* Upload area */}
      <div
        onDrop={e => { e.preventDefault(); handleUpload(e.dataTransfer.files); }}
        onDragOver={e => e.preventDefault()}
        onClick={() => !running && fileInputRef.current?.click()}
        style={{
          border: '2px dashed #444', borderRadius: 8, padding: '20px 16px',
          textAlign: 'center', color: '#666', fontSize: 12, cursor: running ? 'default' : 'pointer',
          marginBottom: 12,
        }}
      >
        {uploading ? '上传中...' : '拖拽文件到这里或点击上传'}
        <div style={{ fontSize: 12, color: '#555', marginTop: 4 }}>
          支持任意文件：文本、文档、音频、图片等
        </div>
        <input
          ref={fileInputRef}
          type="file" multiple
          style={{ display: 'none' }}
          onChange={e => { handleUpload(e.target.files); e.target.value = ''; }}
        />
      </div>

      {/* File list */}
      {files.length > 0 && (() => {
        // Group files by folder
        const groups = {};
        for (const f of files) {
          const folder = f.folder || '';
          if (!groups[folder]) groups[folder] = [];
          groups[folder].push(f);
        }
        const folders = Object.keys(groups).sort((a, b) => (a || '').localeCompare(b || ''));
        const displayName = (f) => f.name.includes('/') ? f.name.split('/').pop() : f.name;
        return (
          <div style={{ marginBottom: 12, maxHeight: 180, overflowY: 'auto' }}>
            {folders.map(folder => (
              <div key={folder || '_root'}>
                {folder && (
                  <div style={{ fontSize: 12, color: '#777', padding: '4px 8px 2px', fontWeight: 600 }}>
                    {'\uD83D\uDCC1'} {folder}
                  </div>
                )}
                {groups[folder].map(f => (
                  <div key={f.name} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '3px 8px', paddingLeft: folder ? 20 : 8, fontSize: 12,
                    color: f.ingested ? '#8a8' : '#bba',
                    background: f.ingested ? '#1a2a1a' : '#2a2a1a',
                    borderRadius: 4, marginBottom: 1,
                    borderLeft: f.ingested ? '2px solid #4a6a4a' : '2px solid #6a6a3a',
                  }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      {AUDIO_EXTS.has(f.ext) ? '\uD83C\uDFA4 ' : '\uD83D\uDCC4 '}{displayName(f)}
                      <span style={{ color: '#666', marginLeft: 6 }}>{Math.round(f.size / 1024)}KB</span>
                    </span>
                    {!running && (
                      <button onClick={e => { e.stopPropagation(); handleDelete(f.name); }} style={{
                        background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 12, padding: '0 4px',
                      }}>x</button>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        );
      })()}

      {/* Action buttons */}
      {!running && !result && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button
            onClick={() => runPipeline('create')}
            disabled={!hasTextFiles || (!name && !currentSlug)}
            style={{
              flex: 1, padding: '10px 16px', fontSize: 12, fontWeight: 600,
              background: (!hasTextFiles || (!name && !currentSlug)) ? '#333' : '#5a5aaa',
              border: 'none', borderRadius: 8, color: '#fff', cursor: 'pointer',
              opacity: (!hasTextFiles || (!name && !currentSlug)) ? 0.5 : 1,
            }}
          >
            蒸馏
          </button>
          {isExisting && (
            <button
              onClick={() => runPipeline('update')}
              disabled={files.length === 0}
              style={{
                flex: 1, padding: '10px 16px', fontSize: 12, fontWeight: 600,
                background: files.length === 0 ? '#333' : '#4a7a4a',
                border: 'none', borderRadius: 8, color: '#fff', cursor: 'pointer',
                opacity: files.length === 0 ? 0.5 : 1,
              }}
            >
              更新
            </button>
          )}
        </div>
      )}

      {hasAudioFiles && !running && !result && (
        <div style={{ fontSize: 12, color: '#6a6', marginBottom: 8 }}>
          检测到音频文件 - 声音将自动克隆
        </div>
      )}

      {/* Progress */}
      {steps.length > 0 && (
        <div ref={logRef} style={{
          background: '#0d0d1a', borderRadius: 6, padding: 10,
          maxHeight: 200, overflowY: 'auto', marginBottom: 12,
        }}>
          {steps.map((s, i) => (
            <div key={i} style={{
              fontSize: 12, padding: '3px 0',
              color: s.status === 'done' ? '#6b6' : s.status === 'error' ? '#f66' : '#aaa',
            }}>
              {s.status === 'done' ? '\u2713' : s.status === 'error' ? '\u2717' : '\u25CB'}{' '}
              {STEPS[s.step] || s.step}
              {s.current && s.total ? ` (${s.current}/${s.total})` : ''}
              {s.count != null ? ` - ${s.count} memories` : ''}
              {s.audit && s.status === 'running' ? ` | ${fmtChars(s.audit.charsSent)} sent` : ''}
              {s.audit && s.chunksSkipped ? ` | ${s.audit.chunksSkipped} skipped` : ''}
              {s.error ? ` - ${s.error}` : ''}
            </div>
          ))}
        </div>
      )}

      {error && (
        <div style={{ color: '#f66', fontSize: 12, padding: '8px 12px', background: '#2a1a1a', borderRadius: 6, marginBottom: 8 }}>
          Error: {error}
        </div>
      )}

      {result && (
        <div style={{ color: '#6b6', fontSize: 12, padding: '12px 16px', background: '#1a2a1a', borderRadius: 8 }}>
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 6, textAlign: 'center' }}>蒸馏完成</div>
          <div style={{ fontSize: 12, color: '#8a8', textAlign: 'center', marginBottom: result.audit ? 8 : 0 }}>
            {result.name || result.slug}
            {result.memoryCount != null && ` - ${result.memoryCount} memories`}
            {result.message && ` - ${result.message}`}
          </div>
          {result.audit && (
            <div style={{ fontSize: 12, color: '#7a7', borderTop: '1px solid #2a3a2a', paddingTop: 6, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px' }}>
              <span>已处理文件: {result.audit.filesProcessed}</span>
              <span>跳过文件: {result.audit.filesSkipped}</span>
              <span>已发送片段: {result.audit.chunksProcessed}</span>
              <span>跳过片段: {result.audit.chunksSkipped}</span>
              <span>发送字符: {fmtChars(result.audit.charsSent)}</span>
              <span>接收字符: {fmtChars(result.audit.charsReceived)}</span>
            </div>
          )}
        </div>
      )}

      {running && (
        <div style={{ textAlign: 'center', color: '#888', fontSize: 12, marginTop: 8 }}>
          处理中...可能需要几分钟。
        </div>
      )}
    </div>
  );
}
