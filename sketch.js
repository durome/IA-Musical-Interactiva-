let midiAccess;
let midiReady = false;

let audioReady = false;
let started = false;

let soundBankJSON = null;
let soundGroups = {};
const VOICES_PER_FILE = 4;

let noteToVoice = {};
let pointerIdToNote = {};
let pressedKeys = {};

const rightHandSplit = 60;
const randomNotesPool = [36,38,40,43,45,48,50,52,55,57,60,62,64,67,69,71,72,74,76,79];

const keyboardMap = {
  "a": 48, "s": 50, "d": 52, "f": 53, "g": 55, "h": 57, "j": 59,
  "k": 60, "l": 62,
  "q": 60, "w": 62, "e": 64, "r": 65, "t": 67, "y": 69, "u": 71,
  "i": 72, "o": 74, "p": 76
};

let cubes = [];
let particles = [];

let maxCubes = 160;
let maxParticles = 5000;  // ✅ miles de partículas sin problema

let lightPhase = 0;

// ---------------- EXTERNAL WORLD ----------------
let world = {
  temperature: 20,
  wind: 2,
  humidity: 50,
  isDay: 1,
  cloud: 30,
  issLat: 0,
  issLon: 0,
  issVel: 7700
};

function preload() {
  soundBankJSON = loadJSON("soundbank.json");
}

function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL);
  colorMode(HSB, 360, 100, 100, 1);
  noStroke();

  loadAllSoundsFromJSON();

  fetchWeather();
  fetchISS();
  setInterval(fetchWeather, 120000);
  setInterval(fetchISS, 15000);

  const btn = document.getElementById("startBtn");
  btn.addEventListener("click", async () => {
    await userStartAudio();
    audioReady = true;
    started = true;

    setupMIDI();
    attachUniversalPointerEvents();

    document.getElementById("overlay").style.display = "none";
    setStatus("✅ Ready: MIDI / Keyboard / Touch / Mouse · Hybrid Field ON");
  });

  // Creamos un “campo base” de partículas (aunque no toquen)
  for (let i = 0; i < 1200; i++) {
    particles.push(new FastParticle(null, 60, "drift"));
  }
}

function setStatus(msg) {
  const el = document.getElementById("status");
  if (el) el.textContent = msg;
}

// ------------------- APIs -------------------
async function fetchWeather() {
  try {
    const url =
      "https://api.open-meteo.com/v1/forecast?latitude=39.47&longitude=-0.38" +
      "&current=temperature_2m,wind_speed_10m,relative_humidity_2m,is_day,cloud_cover";
    const res = await fetch(url);
    const data = await res.json();
    const c = data.current;

    world.temperature = c.temperature_2m ?? world.temperature;
    world.wind = c.wind_speed_10m ?? world.wind;
    world.humidity = c.relative_humidity_2m ?? world.humidity;
    world.isDay = c.is_day ?? world.isDay;
    world.cloud = c.cloud_cover ?? world.cloud;
  } catch (e) {}
}

async function fetchISS() {
  try {
    const url = "https://api.wheretheiss.at/v1/satellites/25544";
    const res = await fetch(url);
    const data = await res.json();

    world.issLat = data.latitude ?? world.issLat;
    world.issLon = data.longitude ?? world.issLon;
    world.issVel = data.velocity ?? world.issVel;
  } catch (e) {}
}

// ------------------- SOUND -------------------
function loadAllSoundsFromJSON() {
  if (!soundBankJSON) {
    setStatus("❌ soundbank.json missing.");
    return;
  }

  soundGroups = {};
  const groups = Object.keys(soundBankJSON);

  for (let g of groups) {
    soundGroups[g] = [];
    for (let file of soundBankJSON[g]) {
      const fileEntry = { file, voices: [] };
      soundGroups[g].push(fileEntry);

      for (let i = 0; i < VOICES_PER_FILE; i++) {
        const snd = loadSound(file);
        snd.playMode("sustain");
        snd.setVolume(0);
        fileEntry.voices.push(snd);
      }
    }
  }

  setStatus("✅ Sounds loaded. Press START.");
}

function getAvailableVoice(groupName) {
  const files = soundGroups[groupName];
  if (!files || files.length === 0) return null;

  const fileObj = random(files);
  if (!fileObj?.voices?.length) return null;

  for (let v of fileObj.voices) {
    if (!v.isPlaying()) return v;
  }

  const v = random(fileObj.voices);
  if (v) v.stop();
  return v;
}

function fadeOutAndStop(snd, seconds = 0.08) {
  if (!snd) return;
  snd.setVolume(0, seconds);
  setTimeout(() => { try { snd.stop(); } catch(e) {} }, seconds * 1000 + 60);
}

function pickGroupForNote(note) {
  const isRight = note >= rightHandSplit;
  if (isRight) return soundGroups.shimmer ? "shimmer" : "glass";
  return soundGroups.atmos ? "atmos" : "glass";
}

// ------------------- NOTE ON/OFF -------------------
function onNoteOn(note, vel) {
  if (!audioReady) return;

  if (noteToVoice[note]?.sound) {
    fadeOutAndStop(noteToVoice[note].sound, 0.03);
    delete noteToVoice[note];
  }

  const group = pickGroupForNote(note);
  const voice = getAvailableVoice(group);
  if (!voice) return;

  const windBoost = map(world.wind, 0, 30, 0.9, 1.2);
  const amp = map(vel, 1, 127, 0.05, 0.22) * windBoost;

  const issRateDrift = map(world.issVel, 7600, 7800, 0.9, 1.12);
  const baseRate = constrain(map(note, 36, 96, 0.6, 1.55), 0.45, 1.8);

  voice.rate(baseRate * issRateDrift);
  voice.setVolume(amp, 0.02);
  voice.play();

  noteToVoice[note] = { sound: voice, group };

  spawnHybrid(note, vel);
}

function onNoteOff(note) {
  const entry = noteToVoice[note];
  if (entry?.sound) fadeOutAndStop(entry.sound, 0.08);
  delete noteToVoice[note];
}

// ------------------- HYBRID SPAWN -------------------
function spawnHybrid(note, vel) {
  const mode = ["ring","spiral","burst","drift"][(note + vel) % 4];

  // Cubos: pocos (peso medio)
  const cubeCount = floor(map(vel, 1, 127, 1, 8));
  for (let i = 0; i < cubeCount; i++) {
    cubes.push(new CubeShard(note, vel, mode));
  }
  if (cubes.length > maxCubes) cubes.splice(0, cubes.length - maxCubes);

  // Partículas: muchas (peso bajo, rápidas)
  const pCount = floor(map(vel, 1, 127, 80, 380));
  for (let i = 0; i < pCount; i++) {
    particles.push(new FastParticle(note, vel, mode));
  }
  if (particles.length > maxParticles) particles.splice(0, particles.length - maxParticles);
}

// ------------------- CUBES -------------------
class CubeShard {
  constructor(note, vel, mode) {
    this.note = note;
    this.vel = vel;
    this.mode = mode;

    this.birth = millis();
    this.life = map(vel, 0, 127, 1400, 5200);

    this.size = map(vel, 0, 127, 10, 80) * random(0.6, 1.25);
    this.pos = createVector(random(-420, 420), random(-260, 260), random(-520, 520));
    this.spin = createVector(random(-0.03, 0.03), random(-0.03, 0.03), random(-0.03, 0.03));

    const dayShift = world.isDay ? 0 : 40;
    this.hue = (map(note, 21, 108, 160, 360) + dayShift + vel) % 360;
    this.alpha = 1.0;

    this.v = p5.Vector.random3D().mult(map(world.wind, 0, 30, 0.2, 2.0));
  }

  isDead() { return millis() - this.birth > this.life; }

  update() {
    const t = (millis() - this.birth) / this.life;
    this.alpha = 1 - t;

    if (this.mode === "burst") this.pos.add(this.v.copy().mult(1.3));
    else if (this.mode === "spiral") {
      const a = frameCount * 0.015 + this.note * 0.02;
      this.pos.x += cos(a) * 1.1;
      this.pos.z += sin(a) * 1.1;
      this.pos.y += sin(a * 0.5) * 0.6;
    } else this.pos.add(this.v.copy().mult(0.45));

    this.v.mult(0.985);
  }

  draw() {
    push();
    translate(this.pos.x, this.pos.y, this.pos.z);
    rotateX(frameCount * this.spin.x);
    rotateY(frameCount * this.spin.y);
    rotateZ(frameCount * this.spin.z);

    ambientMaterial(this.hue, 55, 94, this.alpha * 0.9);
    specularMaterial(this.hue, 70, 100, this.alpha);
    shininess(140);

    const s = this.size * (0.55 + this.alpha * 0.8);
    box(s, s * random(0.35, 1.25), s * random(0.35, 1.25));
    pop();
  }
}

// ------------------- FAST PARTICLES (VERY LIGHT) -------------------
class FastParticle {
  constructor(note, vel, mode) {
    this.note = note;
    this.vel = vel;
    this.mode = mode;

    this.birth = millis();
    this.life = vel ? map(vel, 0, 127, 900, 2600) : random(2500, 7000);

    const issX = map(world.issLon, -180, 180, -240, 240);
    const issY = map(world.issLat, -90, 90, -160, 160);

    this.pos = createVector(
      issX + random(-240, 240),
      issY + random(-180, 180),
      random(-420, 420)
    );

    this.v = p5.Vector.random3D().mult(map(world.wind, 0, 30, 0.2, 2.8));
    this.alpha = 1.0;

    const issHue = map(world.issLon, -180, 180, 180, 360);
    const nHue = note ? map(note, 20, 100, 0, 80) : random(0, 40);
    this.hue = (issHue + nHue) % 360;

    // Tamaño partícula
    this.r = vel ? map(vel, 0, 127, 1.2, 5.0) : random(1.0, 3.0);
  }

  isDead() { return millis() - this.birth > this.life; }

  update() {
    const t = (millis() - this.birth) / this.life;
    this.alpha = 1 - t;

    if (this.mode === "ring") {
      const a = frameCount * 0.02 + (this.note || 50) * 0.04;
      this.pos.x += cos(a) * 0.7;
      this.pos.z += sin(a) * 0.7;
    } else if (this.mode === "spiral") {
      const a = frameCount * 0.015 + (this.note || 50) * 0.03;
      this.pos.x += cos(a) * 0.9;
      this.pos.y += sin(a) * 0.6;
      this.pos.z += sin(a * 0.8) * 0.9;
    } else {
      this.pos.add(this.v.copy().mult(0.55));
    }

    this.v.mult(0.992);
  }

  draw() {
    // ✅ PARTÍCULA COMO POINT (BARATÍSIMA)
    push();
    stroke(this.hue, 75, 100, this.alpha * 0.7);
    strokeWeight(this.r);
    point(this.pos.x, this.pos.y, this.pos.z);
    pop();
  }
}

// ------------------- MIDI -------------------
function setupMIDI() {
  if (!navigator.requestMIDIAccess) {
    setStatus("⚠️ No MIDI. Touch/keyboard enabled.");
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
  const on = cmd === 144 && vel > 0;
  const off = cmd === 128 || (cmd === 144 && vel === 0);
  if (on) onNoteOn(note, vel);
  if (off) onNoteOff(note);
}

// ------------------- Keyboard -------------------
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

// ------------------- Universal pointer -------------------
function attachUniversalPointerEvents() {
  const c = document.querySelector("canvas");
  if (!c) return;
  c.style.touchAction = "none";

  c.addEventListener("pointerdown", (e) => {
    if (!audioReady) return;
    try { c.setPointerCapture(e.pointerId); } catch (_) {}
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
}

// ------------------- DRAW -------------------
function draw() {
  // Fondo más suave
  background(0, 0.12);

  // luces: invisibles, proyectan color
  lightPhase += 0.009 + map(world.wind, 0, 30, 0, 0.01);

  const dayAmp = world.isDay ? 1.0 : 0.55;
  ambientLight(14 * dayAmp);

  directionalLight(
    (80 + 60 * sin(lightPhase)) * dayAmp,
    120 * dayAmp,
    255 * dayAmp,
    -0.6, -0.3, -1
  );

  directionalLight(
    255 * dayAmp,
    (80 + 80 * sin(lightPhase * 1.3)) * dayAmp,
    180 * dayAmp,
    0.7, 0.4, -1
  );

  directionalLight(
    140 * dayAmp,
    255 * dayAmp,
    (120 + 50 * sin(lightPhase * 0.9)) * dayAmp,
    0.2, -0.8, -1
  );

  // luz ISS (orbital)
  const issX = map(world.issLon, -180, 180, -240, 240);
  const issY = map(world.issLat, -90, 90, -160, 160);
  pointLight(255 * dayAmp, 200 * dayAmp, 140 * dayAmp, issX, issY, 360);

  rotateY(frameCount * (0.001 + map(world.cloud, 0, 100, 0, 0.0008)));
  rotateX(sin(frameCount * 0.001) * 0.1);

  // Actualiza partículas (primero)
  // ✅ Esto sí aparece en móvil
  for (let p of particles) {
    p.update();
    p.draw();
  }
  particles = particles.filter(p => !p.isDead());

  // Cubos (después)
  for (let c of cubes) {
    c.update();
    c.draw();
  }
  cubes = cubes.filter(c => !c.isDead());

  // HUD
  push();
  resetMatrix();
  fill(255);
  textAlign(LEFT, TOP);
  textSize(12);
  text("Hybrid Field: Cubes + FAST Particles (mobile safe)", 14, 14);
  text(`Valencia: ${world.temperature}°C · wind ${world.wind} km/h · humidity ${world.humidity}%`, 14, 32);
  pop();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}



