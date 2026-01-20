// =====================================================
// DUROME · SURPRISE ENGINE FIELD
// Eduardo Romaguera · Generative System v1.0
// MIDI + Keyboard + Touch + Mouse + External Signals
// Cubes + Fast Particles + Random Worlds per Interaction
// =====================================================

// -------------------- AUDIO & INPUT --------------------
let midiAccess;
let midiReady = false;

let audioReady = false;
let started = false;

let soundBankJSON = null;
let soundGroups = {};
const VOICES_PER_FILE = 4;

let noteToVoice = {};      // note -> active sound
let pointerIdToNote = {};  // pointerId -> note
let pressedKeys = {};      // key -> bool

const rightHandSplit = 60;

// Notes pool for pointer interaction
const randomNotesPool = [36,38,40,43,45,48,50,52,55,57,60,62,64,67,69,71,72,74,76,79];

// Keyboard map -> notes
const keyboardMap = {
  "a": 48, "s": 50, "d": 52, "f": 53, "g": 55, "h": 57, "j": 59,
  "k": 60, "l": 62,
  "q": 60, "w": 62, "e": 64, "r": 65, "t": 67, "y": 69, "u": 71,
  "i": 72, "o": 74, "p": 76
};

// -------------------- EXTERNAL SIGNALS --------------------
let world = {
  temperature: 20,
  wind: 2,
  humidity: 50,
  isDay: 1,
  cloud: 25,

  issLat: 0,
  issLon: 0,
  issVel: 7700
};

// -------------------- VISUAL OBJECTS --------------------
let cubes = [];
let particles = [];
let connectors = []; // optional lines network

let maxCubes = 220;
let maxParticles = 8000;
let maxConnectors = 120;

// Global lighting
let lightPhase = 0;

// Global camera / world mood
let globalSpin = 0;

// Surprise system selection
let activeWorldMode = "nebula";
let activeWorldUntil = 0;

// History of interactions (for structure)
let interactionCount = 0;

// =====================================================
// PRELOAD
// =====================================================
function preload() {
  soundBankJSON = loadJSON("soundbank.json");
}

// =====================================================
// SETUP
// =====================================================
function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL);
  colorMode(HSB, 360, 100, 100, 1);
  noStroke();

  loadAllSoundsFromJSON();

  // External patterns
  fetchWeather();
  fetchISS();
  setInterval(fetchWeather, 120000);
  setInterval(fetchISS, 15000);

  // Seed base ambience: minimal particles so we always see something
  for (let i = 0; i < 1200; i++) {
    particles.push(new FastParticle(null, 60, "drift", "nebula"));
  }

  // Start button
  const btn = document.getElementById("startBtn");
  btn.addEventListener("click", async () => {
    await userStartAudio();
    audioReady = true;
    started = true;

    setupMIDI();
    attachUniversalPointerEvents();

    document.getElementById("overlay").style.display = "none";
    setStatus("✅ Ready. Play (MIDI / keyboard / touch). Surprise Engine active.");
  });
}

function setStatus(msg) {
  const el = document.getElementById("status");
  if (el) el.textContent = msg;
}

// =====================================================
// EXTERNAL SIGNALS
// =====================================================
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
  } catch (e) {
    // silent
  }
}

async function fetchISS() {
  try {
    const url = "https://api.wheretheiss.at/v1/satellites/25544";
    const res = await fetch(url);
    const data = await res.json();

    world.issLat = data.latitude ?? world.issLat;
    world.issLon = data.longitude ?? world.issLon;
    world.issVel = data.velocity ?? world.issVel;
  } catch (e) {
    // silent
  }
}

// =====================================================
// SOUND LOADER (POLY)
// =====================================================
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
  setTimeout(() => {
    try { snd.stop(); } catch(e) {}
  }, seconds * 1000 + 60);
}

function pickGroupForNote(note) {
  const isRight = note >= rightHandSplit;

  // external influences
  const humidityBias = constrain(map(world.humidity, 0, 100, 0, 1), 0, 1);
  const issEnergy = constrain(map(world.issVel, 7600, 7800, 0, 1), 0, 1);

  if (isRight) {
    if (soundGroups.shimmer && random() < (0.45 + issEnergy * 0.35)) return "shimmer";
    return "glass";
  } else {
    if (soundGroups.atmos && random() < (0.4 + humidityBias * 0.45)) return "atmos";
    return "glass";
  }
}

// =====================================================
// SURPRISE ENGINE (WORLD MODES)
// =====================================================
const worldModes = [
  "nebula",
  "architecture",
  "synaptic",
  "orbital_ring",
  "spiral_city",
  "storm_field",
  "crystal_bloom",
  "gravity_well",
  "meteor_burst"
];

function chooseNewWorldMode(note, vel) {
  // Weighted randomness based on world conditions
  const w = world.wind;
  const h = world.humidity;
  const t = world.temperature;

  let pool = [];

  // base pool always
  pool.push("nebula", "architecture", "synaptic", "crystal_bloom");

  if (w > 12) pool.push("storm_field", "meteor_burst");
  if (h > 65) pool.push("nebula", "gravity_well");
  if (t < 10) pool.push("orbital_ring");
  if (t > 28) pool.push("spiral_city", "meteor_burst");

  // pitch effect
  if (note >= 72) pool.push("crystal_bloom", "orbital_ring");
  if (note <= 45) pool.push("gravity_well", "storm_field");

  // surprise factor
  pool.push(random(worldModes));

  return random(pool);
}

function setWorldMode(mode, durationMs = 9000) {
  activeWorldMode = mode;
  activeWorldUntil = millis() + durationMs;
}

// =====================================================
// NOTE ON/OFF
// =====================================================
function onNoteOn(note, vel) {
  if (!audioReady) return;

  interactionCount++;

  // surprise world change
  const newMode = chooseNewWorldMode(note, vel);
  setWorldMode(newMode, floor(random(6500, 12000)));

  // stop existing same note sound
  if (noteToVoice[note]?.sound) {
    fadeOutAndStop(noteToVoice[note].sound, 0.03);
    delete noteToVoice[note];
  }

  // play a voice
  const group = pickGroupForNote(note);
  const voice = getAvailableVoice(group);
  if (!voice) return;

  const windBoost = map(world.wind, 0, 30, 0.9, 1.25);
  const amp = map(vel, 1, 127, 0.05, 0.22) * windBoost;

  const issRateDrift = map(world.issVel, 7600, 7800, 0.92, 1.12);
  const baseRate = constrain(map(note, 36, 96, 0.6, 1.55), 0.45, 1.8);

  voice.rate(baseRate * issRateDrift);
  voice.setVolume(amp, 0.02);
  voice.play();

  noteToVoice[note] = { sound: voice, group };

  // spawn visual system based on active world mode
  spawnSurpriseSystem(note, vel, activeWorldMode);
}

function onNoteOff(note) {
  const entry = noteToVoice[note];
  if (entry?.sound) fadeOutAndStop(entry.sound, 0.08);
  delete noteToVoice[note];
}

// =====================================================
// SPAWN SYSTEMS (mix cubes + particles + forms)
// =====================================================
function spawnSurpriseSystem(note, vel, mode) {
  const cubeCount = floor(map(vel, 1, 127, 1, 10));
  const particleCount = floor(map(vel, 1, 127, 120, 520));

  // Anchor based on ISS
  const anchor = issAnchorPoint();

  if (mode === "nebula") {
    spawnNebula(anchor, note, vel, cubeCount, particleCount);
  } else if (mode === "architecture") {
    spawnArchitecture(anchor, note, vel, cubeCount, particleCount);
  } else if (mode === "synaptic") {
    spawnSynaptic(anchor, note, vel, cubeCount, particleCount);
  } else if (mode === "orbital_ring") {
    spawnOrbitalRing(anchor, note, vel, cubeCount, particleCount);
  } else if (mode === "spiral_city") {
    spawnSpiralCity(anchor, note, vel, cubeCount, particleCount);
  } else if (mode === "storm_field") {
    spawnStormField(anchor, note, vel, cubeCount, particleCount);
  } else if (mode === "crystal_bloom") {
    spawnCrystalBloom(anchor, note, vel, cubeCount, particleCount);
  } else if (mode === "gravity_well") {
    spawnGravityWell(anchor, note, vel, cubeCount, particleCount);
  } else if (mode === "meteor_burst") {
    spawnMeteorBurst(anchor, note, vel, cubeCount, particleCount);
  } else {
    // fallback
    spawnNebula(anchor, note, vel, cubeCount, particleCount);
  }

  // trimming
  if (cubes.length > maxCubes) cubes.splice(0, cubes.length - maxCubes);
  if (particles.length > maxParticles) particles.splice(0, particles.length - maxParticles);
  if (connectors.length > maxConnectors) connectors.splice(0, connectors.length - maxConnectors);
}

function issAnchorPoint() {
  const x = map(world.issLon, -180, 180, -260, 260);
  const y = map(world.issLat, -90, 90, -170, 170);
  const z = map(world.cloud, 0, 100, 260, -260);
  return createVector(x, y, z);
}

// ---------------- SYSTEM 1: NEBULA ----------------
function spawnNebula(anchor, note, vel, cubeCount, particleCount) {
  for (let i = 0; i < particleCount; i++) {
    particles.push(new FastParticle(note, vel, "drift", "nebula", anchor));
  }
  for (let i = 0; i < floor(cubeCount * 0.35); i++) {
    cubes.push(new CubeShard(note, vel, "drift", "nebula", anchor));
  }
}

// ---------------- SYSTEM 2: ARCHITECTURE ----------------
function spawnArchitecture(anchor, note, vel, cubeCount, particleCount) {
  for (let i = 0; i < cubeCount * 2; i++) {
    cubes.push(new CubeShard(note, vel, "foundation", "architecture", anchor));
  }
  for (let i = 0; i < floor(particleCount * 0.4); i++) {
    particles.push(new FastParticle(note, vel, "drift", "architecture", anchor));
  }
}

// ---------------- SYSTEM 3: SYNAPTIC ----------------
function spawnSynaptic(anchor, note, vel, cubeCount, particleCount) {
  // particles + connection lines
  const points = [];
  const n = floor(map(vel, 1, 127, 8, 22));
  for (let i = 0; i < n; i++) {
    const p = createVector(
      anchor.x + random(-240, 240),
      anchor.y + random(-180, 180),
      anchor.z + random(-220, 220)
    );
    points.push(p);
    particles.push(new FastParticle(note, vel, "synapse", "synaptic", p));
  }

  // connectors
  for (let i = 0; i < points.length - 1; i++) {
    if (random() < 0.65) connectors.push(new Connector(points[i], points[i+1], note, vel));
  }

  // a few cubes as nodes
  for (let i = 0; i < floor(cubeCount * 0.75); i++) {
    cubes.push(new CubeShard(note, vel, "node", "synaptic", anchor));
  }
}

// ---------------- SYSTEM 4: ORBITAL RING ----------------
function spawnOrbitalRing(anchor, note, vel, cubeCount, particleCount) {
  const radius = map(note, 36, 84, 120, 320);
  const ringCount = floor(particleCount * 0.6);

  for (let i = 0; i < ringCount; i++) {
    const a = (i / ringCount) * TWO_PI;
    const p = createVector(
      anchor.x + cos(a) * radius,
      anchor.y + sin(a) * radius * 0.65,
      anchor.z + sin(a) * radius * 0.4
    );
    particles.push(new FastParticle(note, vel, "ring", "orbital", p));
  }

  for (let i = 0; i < cubeCount; i++) {
    cubes.push(new CubeShard(note, vel, "ring", "orbital", anchor));
  }
}

// ---------------- SYSTEM 5: SPIRAL CITY ----------------
function spawnSpiralCity(anchor, note, vel, cubeCount, particleCount) {
  const steps = floor(map(vel, 1, 127, 20, 60));
  let r = 40;

  for (let i = 0; i < steps; i++) {
    const a = i * 0.35;
    r += 3.2;
    const p = createVector(
      anchor.x + cos(a) * r,
      anchor.y + sin(a * 0.6) * 90,
      anchor.z + sin(a) * r
    );

    if (random() < 0.55) cubes.push(new CubeShard(note, vel, "spiral", "city", p));
    particles.push(new FastParticle(note, vel, "spiral", "city", p));
  }
}

// ---------------- SYSTEM 6: STORM FIELD ----------------
function spawnStormField(anchor, note, vel, cubeCount, particleCount) {
  const w = map(world.wind, 0, 30, 0.3, 3.2);
  const n = floor(particleCount * 1.1);

  for (let i = 0; i < n; i++) {
    particles.push(new FastParticle(note, vel, "storm", "storm", anchor));
  }
  for (let i = 0; i < floor(cubeCount * 0.5); i++) {
    cubes.push(new CubeShard(note, vel, "storm", "storm", anchor));
  }

  // extra: more connectors if stormy
  if (world.wind > 15 && random() < 0.8) {
    const a = anchor.copy();
    const b = anchor.copy().add(createVector(random(-260, 260), random(-180, 180), random(-220, 220)));
    connectors.push(new Connector(a, b, note, vel));
  }
}

// ---------------- SYSTEM 7: CRYSTAL BLOOM ----------------
function spawnCrystalBloom(anchor, note, vel, cubeCount, particleCount) {
  // high notes bloom into bright structures
  const n = floor(map(note, 48, 84, 12, 40));
  for (let i = 0; i < n; i++) {
    const p = anchor.copy().add(p5.Vector.random3D().mult(random(40, 220)));
    cubes.push(new CubeShard(note, vel, "crystal", "bloom", p));
  }

  for (let i = 0; i < floor(particleCount * 0.65); i++) {
    particles.push(new FastParticle(note, vel, "spark", "bloom", anchor));
  }
}

// ---------------- SYSTEM 8: GRAVITY WELL ----------------
function spawnGravityWell(anchor, note, vel, cubeCount, particleCount) {
  for (let i = 0; i < particleCount; i++) {
    particles.push(new FastParticle(note, vel, "gravity", "well", anchor));
  }

  for (let i = 0; i < floor(cubeCount * 0.8); i++) {
    cubes.push(new CubeShard(note, vel, "gravity", "well", anchor));
  }
}

// ---------------- SYSTEM 9: METEOR BURST ----------------
function spawnMeteorBurst(anchor, note, vel, cubeCount, particleCount) {
  for (let i = 0; i < floor(particleCount * 1.1); i++) {
    particles.push(new FastParticle(note, vel, "meteor", "meteor", anchor));
  }
  for (let i = 0; i < floor(cubeCount * 0.6); i++) {
    cubes.push(new CubeShard(note, vel, "meteor", "meteor", anchor));
  }

  // connectors as trajectories
  if (random() < 0.7) {
    const a = anchor.copy();
    const b = anchor.copy().add(createVector(random(-420, 420), random(-260, 260), random(-520, 520)));
    connectors.push(new Connector(a, b, note, vel));
  }
}

// =====================================================
// VISUAL CLASSES
// =====================================================
class CubeShard {
  constructor(note, vel, moveMode, paletteMode, anchor = null) {
    this.note = note;
    this.vel = vel;
    this.moveMode = moveMode;
    this.paletteMode = paletteMode;

    this.birth = millis();
    this.life = map(vel, 0, 127, 1400, 5200);

    this.size = map(vel, 0, 127, 12, 85) * random(0.55, 1.25);

    const base = anchor ? anchor.copy() : createVector(0,0,0);
    this.pos = base.add(createVector(random(-260, 260), random(-180, 180), random(-320, 320)));

    this.spin = createVector(random(-0.03, 0.03), random(-0.03, 0.03), random(-0.03, 0.03));
    this.alpha = 1.0;

    // palette driven by climate + note
    const dayShift = world.isDay ? 0 : 40;
    const humShift = map(world.humidity, 0, 100, 0, 30);
    let baseHue = map(note, 21, 108, 160, 360);

    if (paletteMode === "storm") baseHue = 200;
    if (paletteMode === "bloom") baseHue = 300;
    if (paletteMode === "well") baseHue = 180;
    if (paletteMode === "meteor") baseHue = 30;

    this.hue = (baseHue + dayShift + humShift + vel * 0.7) % 360;

    this.v = p5.Vector.random3D().mult(map(world.wind, 0, 30, 0.2, 2.5));
  }

  isDead() {
    return millis() - this.birth > this.life;
  }

  update() {
    const t = (millis() - this.birth) / this.life;
    this.alpha = 1 - t;

    // movement variety
    if (this.moveMode === "ring") {
      const a = frameCount * 0.014 + this.note * 0.02;
      this.pos.x += cos(a) * 0.9;
      this.pos.z += sin(a) * 0.9;
    } else if (this.moveMode === "spiral") {
      const a = frameCount * 0.016 + this.note * 0.02;
      this.pos.x += cos(a) * 1.2;
      this.pos.z += sin(a) * 1.2;
      this.pos.y += sin(a * 0.5) * 0.7;
    } else if (this.moveMode === "storm") {
      this.pos.x += this.v.x * 2.2;
      this.pos.y += sin(frameCount * 0.04 + this.note * 0.05) * 0.7;
      this.pos.z += this.v.z * 1.2;
    } else if (this.moveMode === "gravity") {
      // fall towards center
      const toCenter = p5.Vector.mult(this.pos.copy(), -0.006);
      this.pos.add(toCenter);
      this.pos.add(this.v.copy().mult(0.25));
    } else if (this.moveMode === "meteor") {
      this.pos.add(this.v.copy().mult(2.6));
    } else {
      // drift
      this.pos.add(this.v.copy().mult(0.45));
      this.pos.x += sin(frameCount * 0.01 + this.note * 0.03) * 0.3;
      this.pos.y += cos(frameCount * 0.01 + this.note * 0.02) * 0.3;
    }

    this.v.mult(0.985);
  }

  draw() {
    push();
    translate(this.pos.x, this.pos.y, this.pos.z);

    rotateX(frameCount * this.spin.x);
    rotateY(frameCount * this.spin.y);
    rotateZ(frameCount * this.spin.z);

    // glass vibe
    ambientMaterial(this.hue, 55, 94, this.alpha * 0.85);
    specularMaterial(this.hue, 70, 100, this.alpha);
    shininess(160);

    const s = this.size * (0.55 + this.alpha * 0.85);

    box(s, s * random(0.35, 1.3), s * random(0.35, 1.3));

    pop();
  }
}

// Fast particles as point sprites (mobile safe)
class FastParticle {
  constructor(note, vel, moveMode, paletteMode, anchor = null) {
    this.note = note;
    this.vel = vel || 60;
    this.moveMode = moveMode;
    this.paletteMode = paletteMode;

    this.birth = millis();
    this.life = note ? map(this.vel, 0, 127, 900, 2800) : random(2500, 7000);

    const base = anchor ? anchor.copy() : createVector(0,0,0);

    this.pos = base.add(createVector(
      random(-320, 320),
      random(-240, 240),
      random(-420, 420)
    ));

    this.v = p5.Vector.random3D().mult(map(world.wind, 0, 30, 0.2, 2.8));
    this.alpha = 1.0;

    const issHue = map(world.issLon, -180, 180, 180, 360);
    let hue = (issHue + map(this.vel, 0, 127, 0, 110)) % 360;

    if (paletteMode === "storm") hue = 200;
    if (paletteMode === "bloom") hue = 300;
    if (paletteMode === "meteor") hue = 30;
    if (paletteMode === "synaptic") hue = 160;

    this.hue = hue;

    this.r = note ? map(this.vel, 0, 127, 1.2, 5.4) : random(1.0, 3.0);
  }

  isDead() {
    return millis() - this.birth > this.life;
  }

  update() {
    const t = (millis() - this.birth) / this.life;
    this.alpha = 1 - t;

    if (this.moveMode === "ring") {
      const a = frameCount * 0.02 + (this.note || 50) * 0.04;
      this.pos.x += cos(a) * 0.7;
      this.pos.z += sin(a) * 0.7;
    } else if (this.moveMode === "spiral") {
      const a = frameCount * 0.015 + (this.note || 50) * 0.03;
      this.pos.x += cos(a) * 0.9;
      this.pos.y += sin(a) * 0.6;
      this.pos.z += sin(a * 0.8) * 0.9;
    } else if (this.moveMode === "storm") {
      this.pos.x += this.v.x * 2.7;
      this.pos.y += sin(frameCount * 0.05 + (this.note || 60) * 0.04) * 0.55;
      this.pos.z += this.v.z * 1.2;
    } else if (this.moveMode === "gravity") {
      const toCenter = p5.Vector.mult(this.pos.copy(), -0.01);
      this.pos.add(toCenter);
      this.pos.add(this.v.copy().mult(0.18));
    } else if (this.moveMode === "meteor") {
      this.pos.add(this.v.copy().mult(3.1));
    } else if (this.moveMode === "synapse") {
      this.pos.add(this.v.copy().mult(0.35));
      this.pos.x += sin(frameCount * 0.03 + (this.note || 60)) * 0.25;
      this.pos.y += cos(frameCount * 0.03 + (this.note || 60)) * 0.25;
    } else {
      this.pos.add(this.v.copy().mult(0.55));
    }

    this.v.mult(0.992);
  }

  draw() {
    push();
    stroke(this.hue, 75, 100, this.alpha * 0.75);
    strokeWeight(this.r);
    point(this.pos.x, this.pos.y, this.pos.z);
    pop();
  }
}

// Connector lines
class Connector {
  constructor(a, b, note, vel) {
    this.a = a.copy();
    this.b = b.copy();
    this.note = note;
    this.vel = vel;

    this.birth = millis();
    this.life = map(vel, 0, 127, 800, 2200);

    this.hue = map(note, 20, 100, 160, 360) % 360;
  }

  isDead() { return millis() - this.birth > this.life; }

  draw() {
    const t = (millis() - this.birth) / this.life;
    const alpha = 1 - t;

    push();
    stroke(this.hue, 70, 100, alpha * 0.55);
    strokeWeight(1.2);
    line(this.a.x, this.a.y, this.a.z, this.b.x, this.b.y, this.b.z);
    pop();
  }
}

// =====================================================
// MIDI SETUP
// =====================================================
function setupMIDI() {
  if (!navigator.requestMIDIAccess) {
    setStatus("⚠️ No WebMIDI. Keyboard / touch works.");
    return;
  }

  navigator.requestMIDIAccess().then(
    (midi) => {
      midiAccess = midi;
      const inputs = Array.from(midiAccess.inputs.values());
      inputs.forEach((input) => (input.onmidimessage = handleMIDI));
      midiReady = true;
      setStatus("✅ MIDI connected. Surprise Engine ON.");
    },
    () => setStatus("⚠️ MIDI failed. Keyboard / touch works.")
  );
}

function handleMIDI(msg) {
  const [cmd, note, vel] = msg.data;
  const isOn = cmd === 144 && vel > 0;
  const isOff = cmd === 128 || (cmd === 144 && vel === 0);
  if (isOn) onNoteOn(note, vel);
  if (isOff) onNoteOff(note);
}

// =====================================================
// KEYBOARD INPUT
// =====================================================
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

// =====================================================
// POINTER (TOUCH/MOUSE/PEN) UNIVERSAL
// =====================================================
function attachUniversalPointerEvents() {
  const c = document.querySelector("canvas");
  if (!c) return;

  c.style.touchAction = "none";

  c.addEventListener("pointerdown", (e) => {
    if (!audioReady) return;
    try { c.setPointerCapture(e.pointerId); } catch(_) {}

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

// =====================================================
// DRAW: LIGHTS + WORLD
// =====================================================
function draw() {
  // soft trail
  background(0, 0.12);

  // lights with external modulation
  lightPhase += 0.009 + map(world.wind, 0, 30, 0, 0.011);

  const dayAmp = world.isDay ? 1.0 : 0.55;

  ambientLight(14 * dayAmp);

  // invisible directional lights (colour shifting)
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

  // ISS point light (orbital)
  const issX = map(world.issLon, -180, 180, -240, 240);
  const issY = map(world.issLat, -90, 90, -160, 160);
  pointLight(255 * dayAmp, 200 * dayAmp, 140 * dayAmp, issX, issY, 360);

  // camera motion depends on mode
  const cloudSpin = map(world.cloud, 0, 100, 0.001, 0.0022);
  globalSpin += cloudSpin * 0.7;

  rotateY(globalSpin);
  rotateX(sin(frameCount * 0.001) * 0.12);

  // nucleus - gives spatial reference always
  push();
  const coreHue = map(world.temperature, -10, 40, 180, 330);
  fill(coreHue, 35, 35, 0.22);
  sphere(22 + sin(frameCount * 0.02) * 3);
  pop();

  // connectors
  for (let cn of connectors) cn.draw();
  connectors = connectors.filter(cn => !cn.isDead());

  // particles first (depth)
  for (let p of particles) {
    p.update();
    p.draw();
  }
  particles = particles.filter(p => !p.isDead());

  // cubes second
  for (let c of cubes) {
    c.update();
    c.draw();
  }
  cubes = cubes.filter(c => !c.isDead());

  // If no recent interactions, slowly shift world mode to keep alive
  if (millis() > activeWorldUntil && random() < 0.01) {
    setWorldMode(random(worldModes), floor(random(5000, 9000)));
  }

  // minimal HUD
  push();
  resetMatrix();
  fill(255);
  textAlign(LEFT, TOP);
  textSize(12);
  text("DUROME · Surprise Engine Field · Cubes + Particles + Satellites + Weather", 14, 14);
  text(`Mode: ${activeWorldMode} · Valencia: ${world.temperature}°C wind:${world.wind} humidity:${world.humidity}%`, 14, 32);
  pop();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}


