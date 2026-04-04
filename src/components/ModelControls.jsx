import React from 'react';

const EXPRESSIONS = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'relaxed'];
const EXPRESSION_LABELS = {
  neutral: '平静', happy: '开心', sad: '悲伤', angry: '愤怒', surprised: '惊讶', relaxed: '放松',
};

const sliderStyle = {
  width: '100%', accentColor: '#5a5aaa', cursor: 'pointer',
};

const sectionStyle = {
  marginBottom: 12,
};

const labelStyle = {
  display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#aaa', marginBottom: 2,
};

function Slider({ label, value, min, max, step, onChange }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={labelStyle}>
        <span>{label}</span>
        <span>{typeof value === 'number' ? value.toFixed(step < 1 ? 1 : 0) : value}</span>
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

export default function ModelControls({
  camera, onCameraChange,
  pose, onPoseChange,
  expression, onExpressionChange,
  idle, onIdleChange,
}) {
  const updateCamera = (key, val) => onCameraChange({ ...camera, [key]: val });
  const updatePose = (key, val) => onPoseChange({ ...pose, [key]: val });
  const updateIdle = (key, val) => onIdleChange({ ...idle, [key]: val });

  return (
    <div style={{ overflowY: 'auto', flex: 1 }}>
      {/* Camera */}
      <div style={sectionStyle}>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 6, textTransform: 'uppercase' }}>摄像机</div>
        <Slider label="Y 偏移" value={camera.offsetY} min={0} max={4.0} step={0.05} onChange={v => updateCamera('offsetY', v)} />
        <Slider label="X 偏移" value={camera.offsetX} min={-2} max={2} step={0.05} onChange={v => updateCamera('offsetX', v)} />
        <Slider label="距离" value={camera.distance} min={0.5} max={10} step={0.1} onChange={v => updateCamera('distance', v)} />
      </div>

      {/* Pose */}
      <div style={sectionStyle}>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 6, textTransform: 'uppercase' }}>姿态</div>
        <Slider label="头部左右" value={pose.headYaw} min={-60} max={60} step={1} onChange={v => updatePose('headYaw', v)} />
        <Slider label="头部俯仰" value={pose.headPitch} min={-40} max={40} step={1} onChange={v => updatePose('headPitch', v)} />
        <Slider label="身体左右" value={pose.bodyYaw} min={-60} max={60} step={1} onChange={v => updatePose('bodyYaw', v)} />
        <Slider label="身体前后" value={pose.bodyLean} min={-20} max={20} step={1} onChange={v => updatePose('bodyLean', v)} />
      </div>

      {/* Arms */}
      <div style={sectionStyle}>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 6, textTransform: 'uppercase' }}>手臂</div>
        <Slider label="左臂" value={pose.leftArmZ ?? 70} min={-30} max={90} step={1} onChange={v => updatePose('leftArmZ', v)} />
        <Slider label="右臂" value={pose.rightArmZ ?? -70} min={-90} max={30} step={1} onChange={v => updatePose('rightArmZ', v)} />
        <Slider label="左前臂" value={pose.leftForearmY ?? 0} min={-135} max={0} step={1} onChange={v => updatePose('leftForearmY', v)} />
        <Slider label="右前臂" value={pose.rightForearmY ?? 0} min={0} max={135} step={1} onChange={v => updatePose('rightForearmY', v)} />
      </div>

      {/* Expressions */}
      <div style={sectionStyle}>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 6, textTransform: 'uppercase' }}>表情</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {EXPRESSIONS.map(e => (
            <button
              key={e}
              onClick={() => onExpressionChange(expression === e ? null : e)}
              style={{
                padding: '4px 10px', fontSize: 12,
                border: expression === e ? '1px solid #5a5aaa' : '1px solid #444',
                background: expression === e ? '#3a3a6a' : '#2a2a4a',
                color: expression === e ? '#fff' : '#aaa',
                borderRadius: 4, cursor: 'pointer',
              }}
            >
              {EXPRESSION_LABELS[e] || e}
            </button>
          ))}
        </div>
      </div>

      {/* Idle */}
      <div style={sectionStyle}>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 6, textTransform: 'uppercase' }}>待机动画</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#aaa', marginBottom: 6, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={idle.headSway !== false}
            onChange={e => updateIdle('headSway', e.target.checked)}
          />
          头部摇晃
        </label>
        <Slider label="眨眼间隔 (秒)" value={idle.blinkInterval} min={1} max={10} step={0.5} onChange={v => updateIdle('blinkInterval', v)} />
      </div>
    </div>
  );
}
