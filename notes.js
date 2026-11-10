// Plays musical notes as sound waves, using the browser's Web Audio API.
// Include this file before your sketch, then:
//
//   const notes = new Notes();
//
//   function mousePressed() {
//     notes.play("A");         // A for half a second
//     notes.play("C#5", 2);    // C sharp in octave 5, for 2 seconds
//   }
//
// To hold a note until you stop it:
//
//   let sound = notes.hold("E");
//   sound.stop();
//
// To change the pitch of a held note, give bend() a value and the highest that
// value can be. 0 is the note itself and the highest value is one octave up:
//
//   sound.bend(arduino.value, 800);       // 0 to 800 slides up one octave
//   sound.bend(arduino.value, 800, 24);   // the same, but up 24 semitones (2 octaves)
//
// To change the volume of a held note, give amp() a value from 0 (silent) to 1 (full):
//
//   sound.amp(0.5);
//   sound.amp(arduino.value / 800);       // fade with a sensor that goes from 0 to 800
//
// Note names are a letter from A to G, then # or b for sharp or flat if you want
// one, then an octave number if you want one. "A", "a", "Bb" and "F#3" all work.
//
// A piano goes from "A0" up to "C8", and middle C is "C4". Notes.PIANO lists all
// 88 keys in order, so a number can pick a key:
//
//   notes.play(Notes.PIANO[39]);   // middle C
//
// Pick a different sound, volume or amount of echo when you make the Notes:
//
//   const notes = new Notes({ wave: "soft", volume: 0.5, reverb: 0.4 });
//
// The sounds are "piano" (the default), "soft", "pluck" and "organ", or the plain
// waves "sine", "triangle", "square" and "sawtooth".
//
// Browsers stay silent until the person clicks or presses a key on the page, so
// start the first note from something like mousePressed().

class Notes {
  constructor(options = {}) {
    this.wave = options.wave ?? "piano"; // one of the names in Notes.INSTRUMENTS
    this.volume = options.volume ?? 0.25; // 0 to 1
    this.octave = options.octave ?? 4; // used when a note doesn't give an octave
    this.reverb = options.reverb ?? 0.2; // 0 (none) to 1 (lots of echo)
    this.audio = null; // made when the first note plays
    this.waves = {}; // the shape of each instrument's wave, made when first needed
  }

  // How many semitones each letter is above C
  static SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  // How each sound is made:
  //   harmonics  - how loud each overtone is (1st is the note, 2nd an octave up...)
  //   attack     - seconds to fade in. Even a tiny fade stops the start clicking.
  //   decay      - seconds to settle from full volume down to the sustain level
  //   sustain    - how loud the note stays while held, from 0 to 1
  //   release    - seconds to fade out after stop(). This stops the end clicking.
  //   brightness - how many overtones get through at the start. 0 lets all through.
  //   chorus     - cents two copies of the wave are pulled apart, for a fuller sound
  static INSTRUMENTS = {
    piano: { harmonics: [1, 0.35, 0.18, 0.08, 0.05, 0.03, 0.02, 0.01], attack: 0.012, decay: 1.5, sustain: 0.2, release: 0.45, brightness: 5, chorus: 3 },
    soft: { harmonics: [1, 0.15, 0.05, 0.02], attack: 0.08, decay: 0.4, sustain: 0.8, release: 0.5, brightness: 3, chorus: 6 },
    pluck: { harmonics: [1, 0.45, 0.3, 0.2, 0.12, 0.08, 0.05, 0.03, 0.02], attack: 0.005, decay: 0.5, sustain: 0, release: 0.2, brightness: 8, chorus: 0 },
    organ: { harmonics: [1, 0.7, 0, 0.4, 0, 0.25, 0, 0.2], attack: 0.015, decay: 0.1, sustain: 0.9, release: 0.1, brightness: 0, chorus: 2 },
    sine: { type: "sine", attack: 0.01, decay: 0, sustain: 1, release: 0.08, brightness: 0, chorus: 0 },
    triangle: { type: "triangle", attack: 0.01, decay: 0, sustain: 1, release: 0.08, brightness: 0, chorus: 0 },
    square: { type: "square", attack: 0.01, decay: 0, sustain: 1, release: 0.08, brightness: 0, chorus: 0 },
    sawtooth: { type: "sawtooth", attack: 0.01, decay: 0, sustain: 1, release: 0.08, brightness: 0, chorus: 0 },
  };

  // Notes start this many seconds in the future, so the fade in is never cut short
  static LOOKAHEAD = 0.01;

  // All 88 piano keys from lowest to highest: "A0", "A#0", "B0", "C1" ... "C8"
  static PIANO = Array.from({ length: 88 }, (_, i) => {
    let names = ["A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#"];
    let octave = Math.floor((i + 9) / 12); // each new octave starts on C
    return names[i % 12] + octave;
  });

  // Turn a note name into its frequency in Hz: "A" gives 440
  frequency(note) {
    let match = /^([a-g])([#b]?)(-?\d*)$/i.exec(note);
    if (!match) throw new Error(`Not a note: "${note}". Try something like "A", "C#" or "Bb3".`);

    let [, letter, accidental, octave] = match;
    let semitone = Notes.SEMITONES[letter.toUpperCase()];
    if (accidental === "#") semitone += 1;
    if (accidental === "b") semitone -= 1;
    octave = octave === "" ? this.octave : Number(octave);

    // Count semitones away from A in octave 4. Every 12 semitones doubles the frequency.
    let fromA4 = semitone - 9 + (octave - 4) * 12;
    return 440 * 2 ** (fromA4 / 12);
  }

  // Play a note for a number of seconds. Returns the sound, so you can stop it early.
  play(note, seconds = 0.5) {
    let sound = this.hold(note);
    sound.stop(seconds);
    return sound;
  }

  // Start a note that keeps playing until you call stop() on the sound it returns.
  // stop() also takes a number of seconds to wait first.
  hold(note) {
    let frequency = this.frequency(note);
    let instrument = Notes.INSTRUMENTS[this.wave];
    if (!instrument) {
      let names = Object.keys(Notes.INSTRUMENTS).join('", "');
      throw new Error(`Not a sound: "${this.wave}". Try one of "${names}".`);
    }

    let audio = this.start();
    let { attack, decay, sustain, release, brightness, chorus } = instrument;
    let begin = audio.currentTime + Notes.LOOKAHEAD;

    // Low notes ring on longer than high ones, like a real string
    decay *= Math.min(Math.max(Math.sqrt(262 / frequency), 0.4), 2);

    // The sound goes through: waves -> filter -> envelope -> level -> fade -> speakers
    //   filter   takes away overtones, so the note gets mellower as it rings
    //   envelope fades the note in and down to its sustain level
    //   level    is what amp() changes
    //   fade     fades the note out when stop() is called
    // Each fade has its own gain, so they never fight each other and jump (click).
    let filter = audio.createBiquadFilter();
    let envelope = audio.createGain();
    let level = audio.createGain();
    let fade = audio.createGain();
    filter.type = "lowpass";
    filter.Q.value = 0.5;
    filter.connect(envelope).connect(level).connect(fade).connect(this.output);

    // bend() moves this number, which shifts the pitch of the waves and the filter
    // together, in cents (100 cents is one semitone)
    let pitch = audio.createConstantSource();
    pitch.offset.value = 0;
    pitch.connect(filter.detune);

    // One wave, or two pulled slightly apart for chorus
    let detunes = chorus > 0 ? [-chorus, chorus] : [0];
    let mix = audio.createGain();
    mix.gain.value = 1 / detunes.length;
    mix.connect(filter);
    let oscillators = detunes.map((cents) => {
      let oscillator = audio.createOscillator();
      if (instrument.type) oscillator.type = instrument.type;
      else oscillator.setPeriodicWave(this.waveFor(this.wave, instrument));
      oscillator.frequency.value = frequency;
      oscillator.detune.value = cents;
      pitch.connect(oscillator.detune);
      oscillator.connect(mix);
      oscillator.start(begin);
      return oscillator;
    });
    pitch.start(begin);

    // Fade in, then settle down to the sustain level
    let peak = this.volume;
    envelope.gain.setValueAtTime(0, begin);
    envelope.gain.linearRampToValueAtTime(peak, begin + attack);
    if (decay > 0 && sustain < 1) {
      envelope.gain.setTargetAtTime(peak * sustain, begin + attack, decay / 3);
    }

    // Start bright and get mellower. Keep below what the speakers can play.
    let highest = audio.sampleRate * 0.45;
    if (brightness > 0) {
      let bright = Math.min(frequency * brightness + 700, highest);
      let mellow = Math.min(frequency * brightness * 0.35 + 450, highest);
      filter.frequency.setValueAtTime(bright, begin);
      filter.frequency.setTargetAtTime(mellow, begin + attack, (decay || 0.3) / 3);
    } else {
      filter.frequency.value = Math.min(12000, highest);
    }

    let stopped = false;

    return {
      note: note,
      frequency: frequency,
      // Slide the pitch up from the note. value goes from 0 to max, and max is
      // that many semitones above the note.
      bend(value, max, semitones = 12) {
        let amount = Math.min(Math.max(value / max, 0), 1);
        pitch.offset.setTargetAtTime(amount * semitones * 100, audio.currentTime, 0.02);
      },
      // Set how loud the note is, from 0 (silent) to 1 (full volume)
      amp(value) {
        let amount = Math.min(Math.max(value, 0), 1);
        level.gain.setTargetAtTime(amount, audio.currentTime, 0.02);
      },
      stop(seconds = 0) {
        if (stopped) return; // stopping twice would be an error
        stopped = true;

        // Fade out smoothly, then end the waves once they're silent
        let end = Math.max(audio.currentTime + seconds, begin);
        fade.gain.setValueAtTime(1, end);
        fade.gain.setTargetAtTime(0, end, release / 4);
        let silent = end + release * 2.5;
        for (let oscillator of oscillators) oscillator.stop(silent);
        pitch.stop(silent);
        oscillators[0].onended = () => fade.disconnect();
      },
    };
  }

  // Make the audio system the first time it's needed. Every note goes into one
  // output, which adds a little echo and a limiter that keeps chords from crackling.
  start() {
    if (!this.audio) {
      let audio = new AudioContext({ latencyHint: "interactive" });

      // The limiter turns things down when lots of notes play at once
      let limiter = audio.createDynamicsCompressor();
      limiter.threshold.value = -10;
      limiter.knee.value = 10;
      limiter.ratio.value = 8;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.2;
      limiter.connect(audio.destination);

      // Notes go straight to the limiter, and also through the echo
      this.output = audio.createGain();
      this.output.connect(limiter);

      let echo = audio.createConvolver();
      echo.buffer = this.room(audio, 2);
      let wet = audio.createGain();
      wet.gain.value = this.reverb;
      this.output.connect(echo).connect(wet).connect(limiter);

      this.audio = audio;
    }
    this.audio.resume();
    return this.audio;
  }

  // The sound of a room: hiss that dies away over a number of seconds.
  // Playing notes "through" it gives them an echo.
  room(audio, seconds) {
    let length = Math.floor(audio.sampleRate * seconds);
    let buffer = audio.createBuffer(2, length, audio.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      let data = buffer.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp((-5 * i) / length);
      }
    }
    return buffer;
  }

  // Build a wave from a list of overtones. Each instrument's is made once and reused.
  waveFor(name, instrument) {
    if (!this.waves[name]) {
      let sines = new Float32Array([0, ...instrument.harmonics]);
      let cosines = new Float32Array(sines.length);
      this.waves[name] = this.audio.createPeriodicWave(cosines, sines);
    }
    return this.waves[name];
  }
}
