/**
 * Neogram Retro Audio Engine (Web Audio API)
 * Client-side 8-bit sound effects: clicks, shutters, dial-up handshakes, chimes.
 */
(function (window) {
  'use strict';

  function RetroAudioEngine() {
    this.ctx = null;
    this.enabled = true;
  }

  RetroAudioEngine.prototype.initCtx = function () {
    if (!this.ctx && typeof window !== 'undefined') {
      var AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (AudioCtxClass) {
        this.ctx = new AudioCtxClass();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(function () {});
    }
  };

  // Windows 95 / Mac OS System Click
  RetroAudioEngine.prototype.playClick = function () {
    if (!this.enabled) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      var osc = this.ctx.createOscillator();
      var gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(800, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(300, this.ctx.currentTime + 0.04);

      gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.04);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.05);
    } catch (e) {}
  };

  // Dial-up Handshake Beep sequence
  RetroAudioEngine.prototype.playDialupBeep = function () {
    if (!this.enabled) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      var now = this.ctx.currentTime;
      var osc1 = this.ctx.createOscillator();
      var osc2 = this.ctx.createOscillator();
      var gain = this.ctx.createGain();

      osc1.type = 'sawtooth';
      osc2.type = 'square';

      osc1.frequency.setValueAtTime(941, now);
      osc2.frequency.setValueAtTime(1336, now);

      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.22);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(this.ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.25);
      osc2.stop(now + 0.25);
    } catch (e) {}
  };

  // Success Chime
  RetroAudioEngine.prototype.playSuccess = function () {
    if (!this.enabled) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      var notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
      var start = this.ctx.currentTime;
      var ctx = this.ctx;

      notes.forEach(function (freq, idx) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        var noteStart = start + idx * 0.07;

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, noteStart);

        gain.gain.setValueAtTime(0.12, noteStart);
        gain.gain.exponentialRampToValueAtTime(0.01, noteStart + 0.15);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(noteStart);
        osc.stop(noteStart + 0.16);
      });
    } catch (e) {}
  };

  // Error Buzz
  RetroAudioEngine.prototype.playError = function () {
    if (!this.enabled) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      var now = this.ctx.currentTime;
      var osc = this.ctx.createOscillator();
      var gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.setValueAtTime(90, now + 0.1);

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.26);
    } catch (e) {}
  };

  // Counter Tick
  RetroAudioEngine.prototype.playCounterTick = function () {
    if (!this.enabled) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      var now = this.ctx.currentTime;
      var osc = this.ctx.createOscillator();
      var gain = this.ctx.createGain();

      osc.type = 'square';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.03);

      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.03);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.04);
    } catch (e) {}
  };

  // AIM Door Open (Buddy signs on)
  RetroAudioEngine.prototype.playAimDoorOpen = function () {
    if (!this.enabled) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      var now = this.ctx.currentTime;
      var ctx = this.ctx;

      // Tone 1
      var osc1 = ctx.createOscillator();
      var gain1 = ctx.createGain();
      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(330, now);
      gain1.gain.setValueAtTime(0.12, now);
      gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.13);

      // Tone 2 (higher)
      var osc2 = ctx.createOscillator();
      var gain2 = ctx.createGain();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(523.25, now + 0.08);
      gain2.gain.setValueAtTime(0.12, now + 0.08);
      gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.22);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.08);
      osc2.stop(now + 0.23);
    } catch (e) {}
  };

  // AIM Door Slam (Buddy signs off)
  RetroAudioEngine.prototype.playAimDoorSlam = function () {
    if (!this.enabled) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      var now = this.ctx.currentTime;
      var ctx = this.ctx;

      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(160, now);
      osc.frequency.exponentialRampToValueAtTime(45, now + 0.18);

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.21);
    } catch (e) {}
  };

  // AIM Incoming Message Chime (Classic double bell)
  RetroAudioEngine.prototype.playAimMessageChime = function () {
    if (!this.enabled) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      var now = this.ctx.currentTime;
      var ctx = this.ctx;

      // Bell 1 (E6)
      var osc1 = ctx.createOscillator();
      var gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(1318.5, now);
      gain1.gain.setValueAtTime(0.18, now);
      gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.14);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.15);

      // Bell 2 (G6)
      var osc2 = ctx.createOscillator();
      var gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1567.98, now + 0.09);
      gain2.gain.setValueAtTime(0.18, now + 0.09);
      gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.28);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.09);
      osc2.stop(now + 0.3);
    } catch (e) {}
  };

  // AIM Outgoing Send Sound (Crisp retro click)
  RetroAudioEngine.prototype.playAimSendSound = function () {
    if (!this.enabled) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      var now = this.ctx.currentTime;
      var osc = this.ctx.createOscillator();
      var gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1100, now);
      osc.frequency.exponentialRampToValueAtTime(550, now + 0.04);

      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.04);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.05);
    } catch (e) {}
  };

  window.retroAudio = new RetroAudioEngine();
})(window);
