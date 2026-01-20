let midiAccess;
let midiReady = false;

let audioReady = false;
let started = false;

let soundBankJSON = null;
let soundGroups = {};

let activeAtmos = null;
let atmosStarted = false;

// Cada nota controla su sonido activo
let noteToSound = {}; // { 60: p5.SoundFile, 61: p5.SoundFile, ... }
let noteToGroup = {}; // { 60: "atmos", ... }

// Visuals
let structures = [];
let globalEnergy = 0;

const rightHandSplit = 60; // C4

// ------------------------------------
// 🎹 Keyboard mapping (PC keyboard -> MIDI notes)
// ------------------------------------
const keyboardMap = {
  "a": 48, "s": 50, "d": 52, "f": 53, "g": 55, "h": 57, "j": 59,
  "k": 60, "l": 62, "ñ": 64,
  "q": 60, "w": 62, "e": 64, "r": 65, "t": 67, "y": 69, "u": 71,
  "i": 72, "o": 74, "p": 76
};

// Evitar repetir NoteOn si tecla queda pulsada
let pressedKeys = {}; // { "a": true, ... }

// ------------------------------------
// 🎲 Random playing pool (for mouse/touch)
// ------------------------------------
const randomNotesPool = [
  36, 38, 40, 43, 45, 48, 50, 52, 55, 57,
  60, 62, 64, 67, 69, 71, 72, 74, 76, 79
];

// Nota activada por interacción "mouse/touch"
let mouseTouchActiveNote = null;

// ------------------------------------
// PRELOAD
// ------------------------------------
function preload() {
  soundBankJSON = loadJSON("soundbank.json");
}

// ------------------------------------
// BUILD SOUND BANK
// ------------------------------------
function buildSoundBankFromJSON() {
  if (!soundBankJSON) {
    console.warn("❌ soundbank.json not loaded.");
    return;
  }

  for (let group in soundBankJSON) {
    soundGroups[group] = [];
    for (let file of soundBankJSON[group]) {
      soundGroups[group].push(loadSound(file));
    }
  }

  console.log("✅ Sound bank ready:", Object.keys(soundGroups));
}

// ------------------------------------
// Atmosphere loop (fondo opcional)
// ------------------------------------
function startAtmosphereLoop() {
  if (atmosStarted) return;
  atmosStarted = true;

  if (!soundGroups.atmos || soundGroups.atmos.length === 0) return;

  playNewAtmosLayer();

  setInterval(() => {
    playNewAtmosLayer();
  }, floor(random(22000, 40000)));

  setInterval(() => {
    if (random() < 0.6) playOneShot("shimmer", 0.05, 0.16);
  }, floor(random(7000, 12000)));
}

function playNewAtmosLayer() {
  if (!soundGroups.atmos || soundGroups.atmos.length === 0) return;

  if (activeAtmos && activeAtmos.isPlaying()) activeAtmos.stop();

  activeAtmos = random(soundGroups.atmos);
  if (!activeAtmos) return;

  activeAtmos.setVolume(random(0.03, 0.08));
  activeAtmos.rate(random(0.85, 1.12));
  activeAtmos.loop();
}

function playOneShot(groupName, vMin = 0.05, vMax = 0.15) {
  if (!soundGroups[groupName] || soundGroups[groupName].length === 0) return;

  let s = random(soundGroups[groupName]);
  s.setVolume(random(vMin, vMax));
  s.rate(random(0.9, 1.2));
  s.play();
}

// ------------------------------------
// UI Status
// ------------------------------------
function setStatus(msg) {
  const el = document.getElementById("status");
  if (el) el.textContent = msg;
}

// ------------------------------------
// SETUP
// ------------------------------------
function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL);
  colorMode(HSB, 360, 100, 100, 1);
  noStroke();
  background(0);

  buildSoundBankFromJSON();

  const btn = document.getElementById("startBtn");

  btn.addEventListener("click", async () => {
    await userStartAudio();
    audioReady = true;

    setupMIDI();
    startAtmosphereLoop();

    started = true;
    document.getElementById("overlay").style.display = "none";
    setStatus("✅ Ready. MIDI / Keyboard / Mouse / Touch enabled.");
  });
}

// ------------------------------------
// MIDI SETUP
// ------------------------------------
function setupMIDI() {
  if (!navigator.requestMIDIAccess) {
    setStatus("⚠️ MIDI not available. Keyboard / Mouse / Touch enabled.");
    return;
  }

  navigator.requestMIDIAccess().then(
    (midi) => {
      midiAccess = midi;
      const inputs = Array.from(midiAccess.inputs.values());
      inputs.forEach((input) => (input.onmidimessage = handleMIDI));

      midiReady = true;
      setStatus("✅ MIDI connected. Play piano / keyboard / mouse / touch.");
    },
    () => setStatus("⚠️ MIDI failed. Keyboard / Mouse / Touch enabled.")
  );
}

// ------------------------------------
// MIDI HANDLER
// ------------------------------------
function handleMIDI(msg) {
  if (!audioReady) return;

  const [cmd, note, vel] = msg.data;

  const isNoteOn = cmd === 144 && vel > 0;
  const isNoteOff = cmd === 128 || (cmd === 144 && vel === 0);

  if (isNoteOn) onNoteOn(note, vel);
  if (isNoteOff) onNoteOff(note);
}

// ------------------------------------
// KEYBOARD HANDLER
// ------------------------------------
function keyPressed() {
  if (!audioReady) return;

  const k = key.toLowerCase();
  if (!(k in keyboardMap)) return;
  if (pressedKeys[k]) return;

  pressedKeys[k] = true;

  const note = keyboardMap[k];
  const vel = 90;

  onNoteOn(note, vel);
}

function keyReleased() {
  if (!audioReady) return;

  const k = key.toLowerCase();
  if (!(k in keyboardMap)) return;

  pressedKeys[k] = false;

  const note = keyboardMap[k];
  onNoteOff(note);
}

// ------------------------------------
// 🖱️ MOUSE + 📱 TOUCH INPUT
// ------------------------------------
function mousePressed() {
  if (!audioReady) return;
  if (mouseTouchActiveNote !== null) return;

  let note = random(randomNotesPool);
  let vel = floor(random(60, 120));

  mouseTouchActiveNote = note;
  onNoteOn(note, vel);
}

function mouseReleased() {
  if (!audioReady) return;
  if (mouseTouchActiveNote === null) return;

  onNoteOff(mouseTouchActiveNote);
  mouseTouchActiveNote = null;
}

// En móviles: touchStarted dispara sonido
function touchStarted() {
  if (!audioReady) return;

  // si no se ha pulsado el botón Start, no hacemos nada
  if (!started) return false;

  if (mouseTouchActiveNote !== null) return false;

  let note = random(randomNotesPool);
  let vel = floor(random(60, 120));

  mouseTouchActiveNote = note;
  onNoteOn(note, vel);

  return false;
}

function touchEnded() {
  if (!audioReady) return false;

  if (mouseTouchActiveNote === null) return false;

  onNoteOff(mouseTouchActiveNote);
  mouseTouchActiveNote = null;

  return false;
}

// ------------------------------------
// NOTE ON
// ------------------------------------
function onNoteOn(note, vel) {
  globalEnergy = constrain(globalEnergy + vel / 127, 0, 4);

  const isRight = note >= rightHandSplit;

  let groupChoice;
  if (isRight) {
    groupChoice = random() < 0.65 ? "shimmer" : "glass";
  } else {
    groupChoice = random() < 0.7 ? "atmos" : "glass";
  }

  if (!soundGroups[groupChoice] || soundGroups[groupChoice].length === 0) {
    groupChoice = "glass";
  }
  if (!soundGroups[groupChoice] || soundGroups[groupChoice].length === 0) return;

  // Si ya sonaba la misma nota, cortamos antes
  if (noteToSound[note] && noteToSound[note].isPlaying()) {
    noteToSound[note].stop();
  }

  let s = random(soundGroups[groupChoice]);
  if (!s) return;

  noteToSound[note] = s;
  noteToGroup[note] = groupChoice;

  const amp = map(vel, 1, 127, 0.06, 0.22);
  const rate = constrain(map(note, 36, 96, 0.6, 1.5), 0.45, 1.8);

  s.setVolume(amp);
  s.rate(rate);

  // Atmos loop, los demás one-shot
  if (groupChoice === "atmos") {
    s.loop();
  } else {
    s.play();
  }

  const shapeType = isRight ? "crystal" : "foundation";
  structures.push(new Structure(note, vel, shapeType));
}

// ------------------------------------
// NOTE OFF (STOP al soltar)
// ------------------------------------
function onNoteOff(note) {
  globalEnergy *= 0.85;

  if (noteToSound[note]) {
    noteToSound[note].stop();
    delete noteToSound[note];
    delete noteToGroup[note];
  }
}

// ------------------------------------
// VISUAL CLASS
// ------------------------------------
class Structure {
  constructor(note, vel, type) {
    this.note = note;
    this.vel = vel;
    this.type = type;

    this.birth = millis();
    this.life = map(vel, 0, 127, 900, 3000);

    this.size = map(vel, 0, 127, 18, 120);

    this.pos = createVector(
      random(-320, 320),
      random(-220, 220),
      random(-340, 340)
    );

    this.spin = createVector(
      random(-0.03, 0.03),
      random(-0.03, 0.03),
      random(-0.03, 0.03)
    );

    this.hue = (map(note, 21, 108, 210, 360) + vel * 2) % 360;
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

    ambientMaterial(this.hue, 45, 90, this.alpha * 0.9);
    specularMaterial(this.hue, 55, 100, this.alpha);
    shininess(80);

    const s = this.size * (0.55 + this.alpha * 0.65);

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

// ------------------------------------
// DRAW LOOP
// ------------------------------------
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

  // HUD text simple
  push();
  resetMatrix();
  fill(255);
  textAlign(LEFT, TOP);
  textSize(12);
  text("🎹 MIDI / Keyboard / Mouse / Touch enabled", 14, 14);
  text("Keys: A S D F G H J K / Q W E R T Y U I O P", 14, 32);
  text("Mouse: click-hold to play, release to stop", 14, 50);
  text("Touch: press to play, release to stop", 14, 68);
  pop();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

