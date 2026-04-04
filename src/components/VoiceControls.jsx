import React, { useState, useEffect, useRef, useCallback } from 'react';

const sliderStyle = {
  width: '100%', accentColor: '#5a5aaa', cursor: 'pointer',
};

const labelStyle = {
  display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#aaa', marginBottom: 2,
};

function Slider({ label, value, min, max, step, onChange, formatValue }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={labelStyle}>
        <span>{label}</span>
        <span>{formatValue ? formatValue(value) : value.toFixed(step < 1 ? 1 : 0)}</span>
      </div>
      <input
        type="range"
        style={sliderStyle}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
      />
    </div>
  );
}

export default function VoiceControls({ params, onParamsChange }) {
  const [clonedVoices, setClonedVoices] = useState([]);
  const [audioFiles, setAudioFiles] = useState([]);
  const [cloning, setCloning] = useState(false);
  const [cloneStatus, setCloneStatus] = useState('');
  const [currentVoice, setCurrentVoice] = useState('');
  const [recording, setRecording] = useState(false);
  const [recordTime, setRecordTime] = useState(0);
  const fileInputRef = useRef(null);
  const saveTimerRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(s => {
        setClonedVoices(s.dashscope?.clonedVoices || []);
        setCurrentVoice(s.dashscope?.voiceId || '');
      })
      .catch(console.error);

    fetch('/api/tts/audio-files')
      .then(r => r.json())
      .then(setAudioFiles)
      .catch(console.error);
  }, []);

  const update = useCallback((key, val) => {
    const next = { ...params, [key]: val };
    onParamsChange(next);
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice: next }),
      }).catch(console.error);
    }, 500);
  }, [params, onParamsChange]);

  const selectVoice = async (voiceId) => {
    setCurrentVoice(voiceId);
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dashscope: { voiceId } }),
      });
    } catch (err) {
      console.error('Failed to save voice:', err);
    }
  };

  const handleClone = async (file, name) => {
    setCloning(true);
    setCloneStatus('Converting audio...');
    try {
      if (file instanceof File || file instanceof Blob) {
        const formData = new FormData();
        formData.append('audio', file, file.name || 'recording.wav');
        formData.append('name', name || (file.name ? file.name.replace(/\.[^.]+$/, '') : 'recording'));

        setCloneStatus('Uploading & cloning...');
        const resp = await fetch('/api/tts/clone', { method: 'POST', body: formData });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error);

        setCloneStatus('Done!');
        setClonedVoices(prev => [...prev, { voiceId: data.voiceId, name: data.name }]);
        setCurrentVoice(data.voiceId);
        setTimeout(() => { setCloning(false); setCloneStatus(''); }, 2000);
      } else {
        // Clone from local path
        const resp = await fetch('/api/tts/clone', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath: file, name }),
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error);
        setCloneStatus('Done!');
        setClonedVoices(prev => [...prev, { voiceId: data.voiceId, name: data.name }]);
        setCurrentVoice(data.voiceId);
        setTimeout(() => { setCloning(false); setCloneStatus(''); }, 2000);
      }
    } catch (err) {
      setCloneStatus('Error: ' + err.message);
      setTimeout(() => { setCloning(false); setCloneStatus(''); }, 4000);
    }
  };

  // --- Recording ---
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        blob.name = `recording-${Date.now()}.webm`;
        handleClone(blob, 'recording');
      };

      mediaRecorder.start(100);
      setRecording(true);
      setRecordTime(0);
      timerRef.current = setInterval(() => setRecordTime(t => t + 1), 1000);
    } catch (err) {
      console.error('Mic access denied:', err);
      setCloneStatus('Error: Microphone access denied');
      setTimeout(() => setCloneStatus(''), 3000);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    clearInterval(timerRef.current);
    setRecording(false);
  };

  const formatDelay = (v) => {
    const s = (Math.abs(v) / 1000).toFixed(1);
    if (v > 0) return `语音 +${s}s`;
    if (v < 0) return `字幕 +${s}s`;
    return '0s';
  };

  const noVoice = clonedVoices.length === 0;

  return (
    <div style={{ overflowY: 'auto', flex: 1 }}>
      {/* Voice selection — only cloned voices */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 4, textTransform: 'uppercase' }}>声音</div>
        {noVoice ? (
          <div style={{ fontSize: 12, color: '#f96', padding: '6px 8px', background: '#2a1a1a', borderRadius: 4 }}>
            还没有自定义声音。上传音频或录音来克隆声音。
          </div>
        ) : (
          <select
            value={currentVoice}
            onChange={e => selectVoice(e.target.value)}
            style={{
              width: '100%', padding: '6px 8px',
              background: '#2a2a4a', border: '1px solid #444',
              borderRadius: 4, color: '#e0e0e0', fontSize: 12,
            }}
          >
            {clonedVoices.map(v => (
              <option key={v.voiceId} value={v.voiceId}>{v.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Clone: upload + record */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 4, textTransform: 'uppercase' }}>克隆声音</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={cloning || recording}
            style={{
              padding: '5px 12px', fontSize: 12,
              border: '1px solid #444', background: '#2a2a4a', color: '#aaa',
              borderRadius: 4, cursor: (cloning || recording) ? 'not-allowed' : 'pointer',
            }}
          >
            上传音频
          </button>
          {!recording ? (
            <button
              onClick={startRecording}
              disabled={cloning}
              style={{
                padding: '5px 12px', fontSize: 12,
                border: '1px solid #a44', background: '#3a1a1a', color: '#e66',
                borderRadius: 4, cursor: cloning ? 'not-allowed' : 'pointer',
              }}
            >
              录音
            </button>
          ) : (
            <button
              onClick={stopRecording}
              style={{
                padding: '5px 12px', fontSize: 12,
                border: '1px solid #f44', background: '#4a1a1a', color: '#f88',
                borderRadius: 4, cursor: 'pointer',
                animation: 'none',
              }}
            >
              停止 ({recordTime}s)
            </button>
          )}
          {cloneStatus && (
            <span style={{ fontSize: 12, color: cloneStatus.startsWith('Error') ? '#ff6b6b' : '#6b6' }}>
              {cloneStatus.replace('Error:', '错误:').replace('Converting audio...', '转换音频中...').replace('Uploading & cloning...', '上传克隆中...').replace('Done!', '完成!')}
            </span>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".mp3,.m4a,.wav,.ogg,.flac,.aac,.webm"
            style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleClone(f); e.target.value = ''; }}
          />
        </div>
        {recording && (
          <div style={{ fontSize: 12, color: '#f66', marginTop: 4 }}>
            录音中...请说 10-30 秒以获得最佳效果。
          </div>
        )}
      </div>

      {/* Existing persona audio files */}
      {audioFiles.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 4, textTransform: 'uppercase' }}>人格音频素材</div>
          <div style={{ maxHeight: 120, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {audioFiles.map((f, i) => (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '3px 8px', background: '#2a2a4a', borderRadius: 4, fontSize: 12, color: '#bbb',
              }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{f.name}</span>
                <button
                  onClick={() => handleClone(f.path, f.name.replace(/\.[^.]+$/, ''))}
                  disabled={cloning}
                  style={{
                    padding: '2px 8px', fontSize: 12, border: '1px solid #555',
                    background: '#3a3a5a', color: '#aaa', borderRadius: 3,
                    cursor: cloning ? 'not-allowed' : 'pointer', marginLeft: 6, flexShrink: 0,
                  }}
                >克隆</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Parameters */}
      <div style={{ marginBottom: 6 }}>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 4, textTransform: 'uppercase' }}>参数</div>
        <Slider label="语速" value={params.rate} min={0.5} max={2.0} step={0.1} onChange={v => update('rate', v)} />
        <Slider label="音调" value={params.pitch} min={0.5} max={2.0} step={0.1} onChange={v => update('pitch', v)} />
        <Slider label="音量" value={params.volume} min={0} max={100} step={1} onChange={v => update('volume', v)} />
      </div>

      {/* Delay */}
      <div>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 4, textTransform: 'uppercase' }}>延迟</div>
        <Slider label="延迟" value={params.delay} min={-5000} max={5000} step={100} onChange={v => update('delay', v)} formatValue={formatDelay} />
      </div>
    </div>
  );
}
