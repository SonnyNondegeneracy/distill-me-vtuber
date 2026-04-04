/**
 * lip-sync-analyzer.js — Audio volume → mouth openness
 *
 * Uses Web Audio API AnalyserNode to extract RMS volume from an audio element,
 * mapped to a 0-1 mouthOpenness value.
 */

export class LipSyncAnalyzer {
  constructor() {
    this.audioContext = null;
    this.analyser = null;
    this.source = null;
    this.dataArray = null;
    this._connected = false;
    this._smoothed = 0;        // EMA-smoothed value
    this._openSpeed = 0.6;     // how fast mouth opens (0-1, higher = faster)
    this._closeSpeed = 0.15;   // how fast mouth closes (slower = more natural)
  }

  /**
   * Connect to an HTMLAudioElement to analyse its output.
   * Can be called multiple times — only re-creates source if element changes.
   */
  connectAudio(audioElement) {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.8;
      this.analyser.connect(this.audioContext.destination);
      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    }

    // Resume AudioContext if suspended (Chrome autoplay policy)
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }

    // Same element already connected — nothing to do
    if (this._connectedElement === audioElement) return;

    // Disconnect previous source if any
    if (this.source) {
      try { this.source.disconnect(); } catch {}
      this.source = null;
    }

    // Connect new audio element
    this.source = this.audioContext.createMediaElementSource(audioElement);
    this.source.connect(this.analyser);
    this._connectedElement = audioElement;
    this._connected = true;
  }

  /**
   * Get current mouth openness (0-1) based on audio volume.
   * Call this every animation frame.
   */
  getMouthOpenness() {
    if (!this.analyser || !this.dataArray) return 0;

    this.analyser.getByteTimeDomainData(this.dataArray);

    // Calculate RMS
    let sum = 0;
    for (let i = 0; i < this.dataArray.length; i++) {
      const v = (this.dataArray[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / this.dataArray.length);

    // Map RMS to 0-1 range with slight compression
    const raw = Math.min(1, rms / 0.12);

    // Asymmetric EMA: open fast, close slow (mimics jaw inertia)
    const speed = raw > this._smoothed ? this._openSpeed : this._closeSpeed;
    this._smoothed += (raw - this._smoothed) * speed;

    // Gentle curve — avoid fully linear mapping
    return this._smoothed * this._smoothed;
  }

  dispose() {
    this.source?.disconnect();
    this.analyser?.disconnect();
    this.audioContext?.close();
    this._connected = false;
  }
}
