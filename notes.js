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
// Browsers stay silent until the person clicks or presses a key on the page, so
// start the first note from something like mousePressed().

class Notes {
  constructor(options = {}) {
    this.wave = options.wave ?? "sine"; // "sine", "square", "triangle" or "sawtooth"
    this.volume = options.volume ?? 0.3; // 0 to 1
    this.octave = options.octave ?? 4; // used when a note doesn't give an octave
    this.audio = null; // made when the first note plays
  }

  // How many semitones each letter is above C
  static SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  // How long notes take to fade in and out, in seconds. Without this they click.
  static FADE = 0.02;

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

    // Make the audio system the first time it's needed
    this.audio ??= new AudioContext();
    let audio = this.audio;
    audio.resume();

    // An oscillator makes the wave, and a gain sets how loud it is
    let oscillator = audio.createOscillator();
    let gain = audio.createGain();
    oscillator.type = this.wave;
    oscillator.frequency.value = frequency;
    oscillator.connect(gain);
    gain.connect(audio.destination);

    // Fade in
    let now = audio.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(this.volume, now + Notes.FADE);
    oscillator.start(now);

    return {
      note: note,
      frequency: frequency,
      // Slide the pitch up from the note. value goes from 0 to max, and max is
      // that many semitones above the note.
      bend(value, max, semitones = 12) {
        let amount = Math.min(Math.max(value / max, 0), 1);
        let bent = frequency * 2 ** ((amount * semitones) / 12);
        oscillator.frequency.setTargetAtTime(bent, audio.currentTime, Notes.FADE);
      },
      // Set how loud the note is, from 0 (silent) to 1 (full volume)
      amp(value) {
        let amount = Math.min(Math.max(value, 0), 1);
        gain.gain.setTargetAtTime(amount, audio.currentTime, Notes.FADE);
      },
      stop(seconds = 0) {
        // Fade out, then end the oscillator
        let end = audio.currentTime + seconds;
        gain.gain.setTargetAtTime(0, end, Notes.FADE / 3);
        oscillator.stop(end + Notes.FADE * 2);
      },
    };
  }
}
