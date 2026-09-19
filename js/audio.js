/* =========================================================================
 * F1 THE GAME - Audio (WebAudio 합성음)
 * ========================================================================= */
(function (global) {
  'use strict';

  function Sound() {
    this.ctx = null;
    this.enabled = true;
    this.ready = false;
  }

  Sound.prototype.init = function () {
    if (this.ready) return;
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    var ctx = new AC();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.32;
    this.master.connect(ctx.destination);

    // 엔진: 톱니파 2개 + 로우패스
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 1600;
    this.filter.Q.value = 3.5;
    this.engGain.connect(this.filter);
    this.filter.connect(this.master);

    this.osc1 = ctx.createOscillator(); this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator(); this.osc2.type = 'square';
    this.osc2.detune.value = -1210;
    this.osc1.connect(this.engGain);
    this.osc2.connect(this.engGain);
    this.osc1.frequency.value = 60; this.osc2.frequency.value = 60;
    this.osc1.start(); this.osc2.start();

    // 노면/스키드 노이즈
    var len = ctx.sampleRate * 2;
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = ctx.createBufferSource();
    this.noise.buffer = buf; this.noise.loop = true;
    this.noiseFilter = ctx.createBiquadFilter();
    this.noiseFilter.type = 'bandpass';
    this.noiseFilter.frequency.value = 2400;
    this.noiseFilter.Q.value = 1.4;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0;
    this.noise.connect(this.noiseFilter);
    this.noiseFilter.connect(this.noiseGain);
    this.noiseGain.connect(this.master);
    this.noise.start();

    this.ready = true;
  };

  Sound.prototype.resume = function () {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  };

  /** 매 프레임 엔진음 갱신 */
  Sound.prototype.engine = function (car, active) {
    if (!this.ready || !this.enabled) return;
    var g = this.ctx.currentTime;
    if (!active || !car) {
      this.engGain.gain.setTargetAtTime(0, g, 0.1);
      this.noiseGain.gain.setTargetAtTime(0, g, 0.1);
      return;
    }
    var info = car.gearInfo();
    var f = 38 + (info.rpm / 12500) * 205;
    this.osc1.frequency.setTargetAtTime(f, g, 0.03);
    this.osc2.frequency.setTargetAtTime(f * 1.995, g, 0.03);
    var load = 0.20 + car.throttle * 0.55 + Math.min(0.25, car.speed / 300);
    if (car.pitState === 'stopped') load = 0.08;
    this.engGain.gain.setTargetAtTime(load * 0.5, g, 0.05);
    this.filter.frequency.setTargetAtTime(700 + info.rpm * 0.34 + car.speed * 8, g, 0.05);

    var skid = Math.min(0.5, car.slip * 0.55 + (car.onTrack ? 0 : 0.28)) * Math.min(1, car.speed / 20);
    this.noiseFilter.frequency.value = car.onTrack ? 2600 : 900;
    this.noiseGain.gain.setTargetAtTime(skid * 0.4, g, 0.06);
  };

  Sound.prototype.beep = function (freq, dur, vol) {
    if (!this.ready || !this.enabled) return;
    var ctx = this.ctx, t = ctx.currentTime;
    var o = ctx.createOscillator(), gn = ctx.createGain();
    o.type = 'square'; o.frequency.value = freq;
    gn.gain.setValueAtTime(0, t);
    gn.gain.linearRampToValueAtTime(vol || 0.25, t + 0.01);
    gn.gain.exponentialRampToValueAtTime(0.001, t + (dur || 0.25));
    o.connect(gn); gn.connect(this.master);
    o.start(t); o.stop(t + (dur || 0.25) + 0.05);
  };

  Sound.prototype.crash = function (power) {
    if (!this.ready || !this.enabled) return;
    var ctx = this.ctx, t = ctx.currentTime;
    var len = Math.floor(ctx.sampleRate * 0.35);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
    var src = ctx.createBufferSource(); src.buffer = buf;
    var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
    var gn = ctx.createGain(); gn.gain.value = Math.min(0.6, power * 0.05);
    src.connect(f); f.connect(gn); gn.connect(this.master);
    src.start(t);
  };

  Sound.prototype.toggle = function () {
    this.enabled = !this.enabled;
    if (this.master) this.master.gain.value = this.enabled ? 0.32 : 0;
    return this.enabled;
  };

  global.SFX = new Sound();
})(typeof window !== 'undefined' ? window : globalThis);
