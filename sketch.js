let midiAccess;
let midiReady = false;

let audioReady = false;
let started = false;

let soundBankJSON = null;
let soundGroups = {};

let activeAtmos = null;
let atmosStarted = false;

// 🎹 Cada tecla MIDI tendrá su propio sonido asociado
let noteToSound = {}; // { 60: p5.SoundFile, 61: p5.SoundFile, ... }
let noteToGroup = {}; // { 60: "atmos", ... }

// Visuals
let structures = [];
let globalEnergy = 0;

const rightHandSplit = 60; // C4

// ------------------------------
// PRELOAD
// ------------------------------
function preload() {
  soundBankJSON = loadJSON("soundbank.json");
}

// ------------------------------
// BUILD SOUND BANK
// ------------------------------
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

// ------------------------------
// START ATMOSPHERE LOOP (optional background)
// ------------------------------
function startAtmosphereLoop() {
  if (atmosStarted) return;
  atmosStarted = true;

  if (!soundGroups.atmos || soundGroups.atmos.length === 0) return;

  playNewAtmosLayer();

  // Cambios de atmósfera cada 22–40s
  setInterval(() => {
    playNewAtmosLayer();
  }, floor(random(22000, 40000)));

  // Brillos ocasionales
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

// ------------------------------
// UI STATUS
// ------------------------------
function setStatus(msg) {
  const el = document.getElementById("status");
  if (el) el.textContent = msg;
}

// ------------------------------
// SETUP
// ------------------------------
function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL);
  colorMode(HSB, 360, 100, 100, 1);
  noStroke();
  background(0);

  buildSoundBankFromJSON();

  const btn = document.getElementById("startBtn");

  btn.addEventListener("click", async () => {
    await userStartAudio(); // ✅ obligatorio en navegador
    audioReady = true;

    setupMIDI();
    startAtmosphereLoop();

    started = true;
    document.getElementById("overlay").style.display = "none";
    setStatus("✅ Audio ready + MIDI waiting...");
  });
}

// ------------------------------
// MIDI SETUP
// ------------------------------
function setupMIDI() {
  if (!navigator.requestMIDIAccess) {
    setStatus("❌ WebMIDI not supported. Use Chrome / Edge.");
    return;
  }

  navigator.requestMIDIAccess().then(
    (midi) => {
      midiAccess = midi;
      const inputs = Array.from(midiAccess.inputs.values());
      inputs.forEach((input) => (input.onmidimessage = handleMIDI));

      midiReady = true;
      setStatus("✅ MIDI connected. Play your piano.");
    },
    () => setStatus("❌ MIDI access failed.")
  );
}

// ------------------------------
// MIDI HANDLER
// ------------------------------
function handleMIDI(msg) {
  if (!audioReady) return;

  const [cmd, note, vel] = msg.data;

  const isNoteOn = cmd === 144 && vel > 0;
  const isNoteOff = cmd === 128 || (cmd === 144 && vel === 0);

  if (isNoteOn) onNoteOn(note, vel);
  if (isNoteOff) onNoteOff(note);
}

// ------------------------------
// NOTE ON
// ------------------------------
function onNoteOn(note, vel) {
  globalEnergy = constrain(globalEnergy + vel / 127, 0, 4);

  const isRight = note >= rightHandSplit;

  // 🎼 Elegimos grupo según mano
  // derecha → shimmer + glass brillante
  // izquierda → atmos + glass grave
  let groupChoice;
  if (isRight) {
    groupChoice = random() < 0.65 ? "shimmer" : "glass";
  } else {
    groupChoice = random() < 0.7 ? "atmos" : "glass";
  }

  // Si el grupo no existe, fallback
  if (!soundGroups[groupChoice] || soundGroups[groupChoice].length === 0) {
    groupChoice = "glass";
  }
  if (!soundGroups[groupChoice] || soundGroups[groupChoice].length === 0) return;

  // Si esa nota ya tenía sonido, lo cortamos (para evitar doble loop)
  if (noteToSound[note] && noteToSound[note].isPlaying()) {
    noteToSound[note].stop();
  }

  // Seleccionamos sample aleatorio de ese grupo
  let s = random(soundGroups[groupChoice]);
  if (!s) return;

  noteToSound[note] = s;
  noteToGroup[note] = groupChoice;

  // Volumen por velocidad
  const amp = map(vel, 1, 127, 0.06, 0.22);

  // Pitch del sample siguiendo la nota (sube/baja rate)
  // 60(C4) → rate 1.0
  const rate = constrain(map(note, 36, 96, 0.6, 1.5), 0.45, 1.8);

  s.setVolume(amp);
  s.rate(rate);

  // 🔥 IMPORTANTE:
  // loop solo para "atmos", los otros solo golpe
  if (groupChoice === "atmos") {
    s.loop();
  } else {
    s.play();
  }

  // Visual structure
  const shapeType = isRight ? "crystal" : "foundation";
  structures.push(new Structure(note, vel, shapeType));
}

// ------------------------------
// NOTE OFF  ✅ AQUÍ ESTÁ LA CLAVE
// ------------------------------
function onNoteOff(note) {
  globalEnergy *= 0.85;

  // ✅ detener el sonido asociado a ESA tecla
  if (noteToSound[note]) {
    // stop directo (corte seco)
    noteToSound[note].stop();

    // limpiar
    delete noteToSound[note];
    delete noteToGroup[note];
  }
}

// ------------------------------
// VISUAL CLASS
// ------------------------------
class Structure {
  constructor(note, vel, type) {
    this.note = note;
    this.vel = vel;
    this.type = type;

    this.birth = millis();
    this.life = map(vel, 0, 127, 700, 2600);

    this.size = map(vel, 0, 127, 16, 110);

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

// ------------------------------
// DRAW LOOP
// ------------------------------
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
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

