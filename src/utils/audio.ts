// Web Audio API Synthesizer for Retro 8-bit Game Sound Effects

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    void audioCtx.resume();
  }
  return audioCtx;
}

export function playSound(type: "attack" | "heal" | "poison" | "death" | "shoot" | "shield" | "reload") {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    
    if (type === "attack") {
      // 8-bit White Noise explosion / crunch for hitting/attacking
      const duration = 0.25;
      const bufferSize = ctx.sampleRate * duration;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      
      // Fill buffer with white noise
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      
      // Lowpass/bandpass filter sweep for a retro crunch hit
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(900, now);
      filter.frequency.exponentialRampToValueAtTime(150, now + duration);
      
      // Gain envelope
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + duration);
      
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      noise.start(now);
    } 
    else if (type === "heal") {
      // 8-bit Arpeggio (rising retro chime sound)
      const duration = 0.35;
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + duration);
      
      // Arpeggio notes: C5 (523Hz), E5 (659Hz), G5 (784Hz), C6 (1046Hz)
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.setValueAtTime(659.25, now + 0.08);
      osc.frequency.setValueAtTime(783.99, now + 0.16);
      osc.frequency.setValueAtTime(1046.50, now + 0.24);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + duration);
    } 
    else if (type === "poison") {
      // Bubbly / down-frequency pitch slide
      const duration = 0.45;
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(250, now);
      filter.frequency.linearRampToValueAtTime(60, now + duration);
      
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + duration);
      
      // Slide down pitch
      osc.frequency.setValueAtTime(160, now);
      osc.frequency.linearRampToValueAtTime(70, now + duration);
      
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + duration);
    } 
    else if (type === "death") {
      // Classic falling game over sound
      const duration = 0.7;
      const osc = ctx.createOscillator();
      osc.type = "square"; // High-fidelity 8-bit sound
      
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.linearRampToValueAtTime(0.01, now + duration);
      
      // Slow drop in pitch
      osc.frequency.setValueAtTime(330, now);
      osc.frequency.setValueAtTime(247, now + 0.15);
      osc.frequency.setValueAtTime(165, now + 0.35);
      osc.frequency.exponentialRampToValueAtTime(55, now + duration);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + duration);
    }
    else if (type === "shoot") {
      // 8-bit retro laser/gunshot: rapid pitch drop
      const duration = 0.15;
      const osc = ctx.createOscillator();
      osc.type = "square";
      
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + duration);
      
      osc.frequency.setValueAtTime(1400, now);
      osc.frequency.exponentialRampToValueAtTime(300, now + duration);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + duration);
    } 
    else if (type === "shield") {
      // Retro metallic block/shield ding: short sine wave sweep + high pitch
      const duration = 0.22;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(1800, now);
      filter.frequency.exponentialRampToValueAtTime(800, now + duration);
      filter.Q.setValueAtTime(12, now); // High resonance for metallic tone
      
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.22, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + duration);
      
      osc.frequency.setValueAtTime(1000, now);
      osc.frequency.linearRampToValueAtTime(1200, now + duration);
      
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + duration);
    } 
    else if (type === "reload") {
      // 8-bit double click sound: mechanical revolver cylinder spin "chk-chk"
      const playClick = (time: number) => {
        const osc = ctx.createOscillator();
        osc.type = "triangle";
        
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.12, time);
        gain.gain.exponentialRampToValueAtTime(0.01, time + 0.06);
        
        osc.frequency.setValueAtTime(180, time);
        osc.frequency.exponentialRampToValueAtTime(60, time + 0.06);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(time);
        osc.stop(time + 0.08);
      };
      
      playClick(now);
      playClick(now + 0.12);
    }
  } catch (e) {
    // Fail silently if browser blocks autoplay
    console.warn("Audio Context playback failed:", e);
  }
}

let bgmVolumeNode: GainNode | null = null;
let schedulerTimer: number | null = null;
let nextNoteTime = 0.0;
let step = 0;
const tempo = 110.0; // BPM
const secondsPerStep = 60.0 / tempo / 2; // 8th notes (approx. 0.27s)

// Cozy retro fantasy chord progression: Am -> F -> C -> G
const CHORDS = [
  [110.00, 220.00, 261.63, 329.63], // Am
  [110.00, 220.00, 261.63, 329.63],
  [87.31, 174.61, 261.63, 349.23],  // F
  [87.31, 174.61, 261.63, 349.23],
  [130.81, 261.63, 329.63, 392.00], // C
  [130.81, 261.63, 329.63, 392.00],
  [98.00, 196.00, 293.66, 392.00],  // G
  [98.00, 196.00, 293.66, 392.00]
];

// Nostalgic retro fantasy RPG melody (sine wave for cozy ambient sound)
const MELODY = [
  440.00, 523.25, 587.33, 659.25, 
  0,       659.25, 783.99, 880.00, 
  880.00, 783.99, 659.25, 523.25, 
  587.33, 0,       440.00, 0
];

function scheduleNextStep(ctx: AudioContext, time: number) {
  if (!bgmVolumeNode) return;
  const chordIdx = Math.floor(step / 4) % CHORDS.length;
  const chord = CHORDS[chordIdx];
  
  // 1. Bass line
  if (step % 4 === 0) {
    const bassOsc = ctx.createOscillator();
    bassOsc.type = "triangle";
    bassOsc.frequency.setValueAtTime(chord[0] / 2, time); // deeper bass
    
    const bassGain = ctx.createGain();
    bassGain.gain.setValueAtTime(0.12, time);
    bassGain.gain.exponentialRampToValueAtTime(0.001, time + 0.9);
    
    bassOsc.connect(bassGain);
    bassGain.connect(bgmVolumeNode);
    bassOsc.start(time);
    bassOsc.stop(time + 1.0);
  }
  
  // 2. Cozy chord arpeggio
  const arpNoteIdx = step % 4;
  const arpFreq = chord[1 + (arpNoteIdx % 3)];
  const arpOsc = ctx.createOscillator();
  arpOsc.type = "sine";
  arpOsc.frequency.setValueAtTime(arpFreq, time);
  
  const arpGain = ctx.createGain();
  arpGain.gain.setValueAtTime(0.03, time);
  arpGain.gain.exponentialRampToValueAtTime(0.001, time + 0.22);
  
  arpOsc.connect(arpGain);
  arpGain.connect(bgmVolumeNode);
  arpOsc.start(time);
  arpOsc.stop(time + 0.25);

  // 3. Melody line
  const melodyFreq = MELODY[step % MELODY.length];
  if (melodyFreq > 0) {
    const melOsc = ctx.createOscillator();
    melOsc.type = "sine";
    melOsc.frequency.setValueAtTime(melodyFreq, time);
    
    // Cozy vibrato
    const vibrato = ctx.createOscillator();
    const vibratoGain = ctx.createGain();
    vibrato.frequency.value = 5.5; // vibrato speed
    vibratoGain.gain.value = 2.5;  // vibrato depth
    vibrato.connect(vibratoGain);
    vibratoGain.connect(melOsc.frequency);
    
    const melGain = ctx.createGain();
    melGain.gain.setValueAtTime(0.04, time);
    melGain.gain.linearRampToValueAtTime(0.03, time + 0.15);
    melGain.gain.exponentialRampToValueAtTime(0.001, time + 0.45);
    
    melOsc.connect(melGain);
    melGain.connect(bgmVolumeNode);
    
    vibrato.start(time);
    melOsc.start(time);
    vibrato.stop(time + 0.5);
    melOsc.stop(time + 0.5);
  }

  step++;
}

export function startBGM() {
  try {
    const ctx = getAudioContext();
    if (schedulerTimer) return; // already running

    if (!bgmVolumeNode) {
      bgmVolumeNode = ctx.createGain();
      const savedMute = localStorage.getItem("bgm_muted");
      bgmVolumeNode.gain.value = savedMute === "true" ? 0 : 0.15; // cozy background volume
      bgmVolumeNode.connect(ctx.destination);
    }

    nextNoteTime = ctx.currentTime;
    step = 0;

    const scheduler = () => {
      while (nextNoteTime < ctx.currentTime + 0.1) {
        scheduleNextStep(ctx, nextNoteTime);
        nextNoteTime += secondsPerStep;
      }
      schedulerTimer = window.setTimeout(scheduler, 25);
    };
    
    scheduler();
  } catch (e) {
    console.warn("BGM failed to start:", e);
  }
}

export function stopBGM() {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
}

export function setBGMMuted(muted: boolean) {
  localStorage.setItem("bgm_muted", String(muted));
  if (bgmVolumeNode) {
    bgmVolumeNode.gain.value = muted ? 0 : 0.15;
  }
}

export function isBGMMuted(): boolean {
  const savedMute = localStorage.getItem("bgm_muted");
  return savedMute === "true";
}
