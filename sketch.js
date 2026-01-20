let midiAccess;
let midiReady = false;

let audioReady = false;
let started = false;

let soundBankJSON = null;
let soundGroups = {};
const VOICES_PER_FILE = 5;

// Nota -> sonido activo
let noteToVoice = {};  // { note: {sound, group} }

// POINTER -> note activo (multi-touch robusto)
let pointerIdToNote = {}; // { pointerId: note }

let structures = [];
let globalEnergy = 0;

const rightHandSplit = 60; // C4

// Teclado ordenador -> notas
const keyboardMap = {
  "a": 48, "s": 50, "d": 52, "f": 53, "g": 55, "h": 57, "j": 59,
  "k": 60, "l": 62,
  "q": 60, "w": 62, "e": 64, "r": 65, "t": 67, "y": 69, "u": 71,
  "i": 72, "o": 74, "p": 76
};
let pressedKeys = {};

const randomNotesPool = [36,38,40,43,45,48,50,52,55,57,60,62,64,67,69,71,72,74,76,79];

function preload() {
  soundBankJSON = loadJSON("soundbank.json");
}

function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL);
  colorMode(HSB, 360, 100, 100, 1);
  noStroke();

  loadAllSoundsFromJSON();

  const btn = document.getElementById("startBtn");
  btn.addEventListener("click", async () => {
    await userStartAudio(); // ✅ desbloquea audio mobile
    audioReady = true;
    started = true;

    setupMIDI();
    attachUniversalPointerEvents(); // ✅ LO MÁS IMPORTANTE

    document.getElementById("overlay").style.display = "none";
    setStatus("✅ Ready: MIDI + Keyboard + Touch/Mouse/Pen");
  });
}

// -----------------------------
// STATUS
// -----------------------------
function setStatus(msg) {
  const el = document.getElementById("status");
  if (el) el.textContent = msg;
}

// -----------------------------
// SOUND LOADING (poly voices)
// -----------------------------
function loadAllSoundsFromJSON() {
  if (!soundBankJSON) {
    console.warn("❌ soundbank.json missing.");
    setStatus("❌ soundbank.json missing.");
    return;
  }

  soundGroups = {};
  const groups = Object.keys(soundBankJSON);

  let totalToLoad = 0;
  let loaded = 0;

  for (let g of groups) {
    totalToLoad += (soundBankJSON[g]?.length || 0) * VOICES_PER_FILE;
  }

  setStatus(`⏳ Loading sounds... 0 / ${totalToLoad}`);

  for (let g of groups) {
    soundGroups[g] = [];

    for (let file of soundBankJSON[g]) {
      const fileEntry = { file, voices: [] };
      soundGroups[g].push(fileEntry);

      for (let i = 0; i < VOICES_PER_FILE; i++) {
        const snd = loadSound(
          file,
          () => {
            loaded++;
            setStatus(`⏳ Loading sounds... ${loaded} / ${totalToLoad}`);
            if (loaded >= totalToLoad) {
              setStatus("✅ Sounds loaded. Press START.");
            }
          },
          () => {
            loaded++;
            setStatus(`⚠️ Missing: ${file} (${loaded}/${totalToLoad})`);
            if (loaded >= totalToLoad) {
              setStatus("✅ Loaded (with warnings). Press START.");
            }
          }
        );

        snd.playMode("sustain");
        snd.setVolume(0);

        fileEntry.voices.push(snd);
      }
    }
  }
}

function getAvailableVoice(groupName) {
  const files = soundGroups[groupName];
  if (!files || files.length === 0) return null;

  const fileObj = random(files);
  if (!fileObj || !fileObj.voices) return null;

  for (let v of fileObj.voices) {
    if (!v.isPlaying()) return v;
  }

  // si todo ocupado, recicla una
  const v = random(fileObj.voices);
  if (v && v.isPlaying()) v.stop();
  return v;
}

function pickGroupForNote(note) {
  const isRight = note >= rightHandSplit;

  if (isRight) {
    if (soundGroups.shimmer && random() < 0.65) return "shimmer";
    return "glass";
  } else {
    if (soundGroups.atmos && random() < 0.7) return "atmos";
    return "glass";
  }
}

function fadeOutAndStop(snd, seconds = 0.08) {
  if (!snd) return;
  try {
    snd.setVolume(0, seconds);
    setTimeout(() => {
      try { snd.stop(); } catch (e) {}
    }, Math.max(10, seconds * 1000 + 60));
  } catch (e) {
    try { snd.stop(); } catch (e2) {}
  }
}

// -----------------------------
// NOTE ON / OFF
// -----------------------------
function onNoteOn(note, vel) {
  if (!audioReady) return;

  // si ya sonaba esa nota, la cortamos
  if (noteToVoice[note]?.sound) {
    fadeOutAndStop(noteToVoice[note].sound, 0.03);
    delete noteToVoice[note];
  }

  globalEnergy = constrain(globalEnergy + vel / 127, 0, 4);

  let group = pickGroupForNote(note);
  if (!soundGroups[group] || soundGroups[group].length === 0) {
    group = soundGroups.glass ? "glass" : Object.keys(soundGroups)[0];
  }

  const voice = getAvailableVoice(group);
  if (!voice) return;

  const amp = map(vel, 1, 127, 0.06, 0.22);
  const rate = constrain(map(note, 36, 96, 0.6, 1.55), 0.45, 1.8);

  voice.rate(rate);
  voice.setVolume(amp, 0.02);
  voice.play();

  noteToVoice[note] = { sound: voice, group };

  const shapeType = note >= rightHandSplit ? "crystal" : "foundation";
  structures.push(new Structure(note, vel, shapeType));
}

function onNoteOff(note) {
  globalEnergy *= 0.88;

  const entry = noteToVoice[note];
  if (entry?.sound) fadeOutAndStop(entry.sound, 0.08);

  delete noteToVoice[note];
}

// -----------------------------
// MIDI
// -----------------------------
function setupMIDI() {
  if (!navigator.requestMIDIAccess) {
    setStatus("⚠️ No WebMIDI. Touch/keyboard enabled.");
    return;
  }

  navigator.requestMIDIAccess().then(
    (midi) => {
      midiAccess = midi;
      const inputs = Array.from(midiAccess.inputs.values());
      inputs.forEach((input) => (input.onmidimessage = handleMIDI));
      midiReady = true;
      setStatus("✅ MIDI connected.");
    },
    () => setStatus("⚠️ MIDI failed. Touch/keyboard enabled.")
  );
}

function handleMIDI(msg) {
  const [cmd, note, vel] = msg.data;
  const isNoteOn = cmd === 144 && vel > 0;
  const isNoteOff = cmd === 128 || (cmd === 144 && vel === 0);

  if (isNoteOn) onNoteOn(note, vel);
  if (isNoteOff) onNoteOff(note);
}

// -----------------------------
// KEYBOARD (PC)
// -----------------------------
function keyPressed() {
  if (!audioReady) return;
  const k = key.toLowerCase();
  if (!(k in keyboardMap)) return;
  if (pressedKeys[k]) return;

  pressedKeys[k] = true;
  onNoteOn(keyboardMap[k], 95);
}

function keyReleased() {
  if (!audioReady) return;
  const k = key.toLowerCase();
  if (!(k in keyboardMap)) return;

  pressedKeys[k] = false;
  onNoteOff(keyboardMap[k]);
}

// -----------------------------
// ✅ UNIVERSAL POINTER EVENTS (Android FIX)
// -----------------------------
function attachUniversalPointerEvents() {
  // El canvas real de p5:
  const c = document.querySelector("canvas");
  if (!c) {
    console.warn("⚠️ canvas not found for pointer events.");
    return;
  }

  // Desactiva gestos del navegador (zoom/scroll) sobre el canvas
  c.style.touchAction = "none";

  c.addEventListener("pointerdown", (e) => {
    if (!audioReady) return;

    // capturamos pointer para que siempre lleguen up/cancel
    try { c.setPointerCapture(e.pointerId); } catch (_) {}

    // nota aleatoria
    const note = random(randomNotesPool);
    const vel = floor(random(70, 120));

    pointerIdToNote[e.pointerId] = note;
    onNoteOn(note, vel);
  }, { passive: false });

  c.addEventListener("pointerup", (e) => {
    const note = pointerIdToNote[e.pointerId];
    if (note != null) {
      onNoteOff(note);
      delete pointerIdToNote[e.pointerId];
    }
  }, { passive: false });

  c.addEventListener("pointercancel", (e) => {
    const note = pointerIdToNote[e.pointerId];
    if (note != null) {
      onNoteOff(note);
      delete pointerIdToNote[e.pointerId];
    }
  }, { passive: false });

  setStatus("✅ Pointer events enabled (touch/mouse/pen).");
}

// -----------------------------
// VISUALS
// -----------------------------
class Structure {
  constructor(note, vel, type) {
    this.note = note;
    this.vel = vel;
    this.type = type;

    this.birth = millis();
    this.life = map(vel, 0, 127, 1200, 3600);

    this.size = map(vel, 0, 127, 18, 140);

    this.pos = createVector(
      random(-360, 360),
      random(-260, 260),
      random(-400, 400)
    );

    this.spin = createVector(
      random(-0.03, 0.03),
      random(-0.03, 0.03),
      random(-0.03, 0.03)
    );

    this.hue = (map(note, 21, 108, 210, 360) + vel * 2.2) % 360;
    this.alpha = 1.0;

    const pick = (note + vel) % 3;
    this.geom = pick === 0 ? "sphere" : pick === 1 ? "box" : "tetra";
  }

  isDead() {
    return millis() - this.birth > this.life;
  }

  update() {
    const t = (millis() - this.birth) / this.life;
    this.alpha = 1.0 - t;

    this.pos.x += sin(frameCount * 0.01 + this.note * 0.03) * 0.6;
    this.pos.y += cos(frameCount * 0.012 + this.note * 0.02) * 0.6;
    this.pos.z += sin(frameCount * 0.008 + this.note * 0.04) * 0.6;
  }

  draw() {
    push();
    translate(this.pos.x, this.pos.y, this.pos.z);

    rotateX(frameCount * this.spin.x);
    rotateY(frameCount * this.spin.y);
    rotateZ(frameCount * this.spin.z);

    ambientMaterial(this.hue, 45, 92, this.alpha * 0.9);
    specularMaterial(this.hue, 55, 100, this.alpha);
    shininess(90);

    const s = this.size * (0.55 + this.alpha * 0.7);

    if (this.geom === "sphere") sphere(s * 0.75, 18, 12);
    else if (this.geom === "box") box(s, s * 0.6, s * 0.8);
    else drawTetra(s * 0.9);

    pop();
  }
}

function drawTetra(sz) {
  beginShape(TRIANGLES);
  const v0 = createVector(0, -sz, 0);
  const v1 = createVector(-sz, sz, -sz);
  const v2 = createVector(sz, sz, -sz);
  const v3 = createVector(0, sz, sz);

  vertex(v0.x, v0.y, v0.z); vertex(v1.x, v1.y, v1.z); vertex(v2.x, v2.y, v2.z);
  vertex(v0.x, v0.y, v0.z); vertex(v2.x, v2.y, v2.z); vertex(v3.x, v3.y, v3.z);
  vertex(v0.x, v0.y, v0.z); vertex(v3.x, v3.y, v3.z); vertex(v1.x, v1.y, v1.z);
  vertex(v1.x, v1.y, v1.z); vertex(v3.x, v3.y, v3.z); vertex(v2.x, v2.y, v2.z);

  endShape();
}

// -----------------------------
// DRAW
// -----------------------------
function draw() {
  background(0, 0.14);

  ambientLight(30);
  directionalLight(255, 255, 255, -0.4, -0.6, -1);
  pointLight(120, 160, 255, 0, 0, 300);

  rotateY(frameCount * 0.0012);
  rotateX(Math.sin(frameCount * 0.001) * 0.12);

  const energyPulse = constrain(globalEnergy, 0, 2);
  const coreSize = 60 + energyPulse * 160;

  push();
  fill(220, 30, 40, 0.45);
  sphere(coreSize * 0.12);
  pop();

  for (let s of structures) {
    s.update();
    s.draw();
  }
  structures = structures.filter((s) => !s.isDead());

  globalEnergy *= 0.985;

  // HUD
  push();
  resetMatrix();
  fill(255);
  textAlign(LEFT, TOP);
  textSize(12);
  text("✅ Universal input: MIDI / Keyboard / Touch / Mouse / Pen", 14, 14);
  text("Touch Android fixed via Pointer Events", 14, 32);
  pop();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}



