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
// Note names are a letter from A to G, then # or b for sharp or flat if you want
// one, then an octave number if you want one. "A", "a", "Bb" and "F#3" all work.
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
      stop(seconds = 0) {
        // Fade out, then end the oscillator
        let end = audio.currentTime + seconds;
        gain.gain.setTargetAtTime(0, end, Notes.FADE / 3);
        oscillator.stop(end + Notes.FADE * 2);
      },
    };
  }
}
