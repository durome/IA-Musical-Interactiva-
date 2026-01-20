// =====================================================
// DUROME · CLEAN SCULPTURAL FIELD 3.0
// Eduardo Romaguera · Cubes + Circles + Triangles + Particles
// Clean motion: forward/back + size lifecycle (no jitter)
// MIDI + Keyboard + Touch + Mouse + External Signals
// =====================================================

// -------------------- AUDIO & INPUT --------------------
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
let solids = [];      // Clean sculptures: cube / circle / triangle
let particles = [];   // Atmosphere
let connectors = [];  // Optional: elegant lines

let maxSolids = 240;
let maxParticles = 9000;
let maxConnectors = 100;

let lightPhase = 0;
let globalSpin = 0;

let activeMode = "cleanfield";
let modeUntil = 0;

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

  loadAllSoundsFromJSON();

  fetchWeather();
  fetchISS();
  setInterval(fetchWeather, 120000);
  setInterval(fetchISS, 15000);

  // base atmospheric particles always alive
  for (let i = 0; i < 1600; i++) {
    particles.push(new CleanParticle(null, 60, createVector(0,0,0)));
  }

  const btn = document.getElementById("startBtn");
  btn.addEventListener("click", async () => {
    await userStartAudio();
    audioReady = true;
    started = true;

    setupMIDI();
    attachUniversalPointerEvents();

    document.getElementById("overlay").style.display = "none";
    setStatus("✅ Ready. Play MIDI / keyboard / touch. Clean field active.");
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

// =====================================================
// SOUND SYSTEM
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
  }, seconds * 1000 + 50);
}

function pickGroupForNote(note) {
  const isRight = note >= rightHandSplit;
  const humidityBias = constrain(map(world.humidity, 0, 100, 0, 1), 0, 1);
  const issEnergy = constrain(map(world.issVel, 7600, 7800, 0, 1), 0, 1);

  if (isRight) {
    if (soundGroups.shimmer && random() < (0.42 + issEnergy * 0.35)) return "shimmer";
    return "glass";
  } else {
    if (soundGroups.atmos && random() < (0.35 + humidityBias * 0.5)) return "atmos";
    return "glass";
  }
}

// =====================================================
// INPUT EVENTS -> NOTE ON/OFF
// =====================================================
function onNoteOn(note, vel) {
  if (!audioReady) return;

  // stop previous voice for same note
  if (noteToVoice[note]?.sound) {
    fadeOutAndStop(noteToVoice[note].sound, 0.03);
    delete noteToVoice[note];
  }

  // play sound
  const group = pickGroupForNote(note);
  const voice = getAvailableVoice(group);
  if (voice) {
    const windBoost = map(world.wind, 0, 30, 0.9, 1.25);
    const amp = map(vel, 1, 127, 0.05, 0.22) * windBoost;

    const issRateDrift = map(world.issVel, 7600, 7800, 0.92, 1.12);
    const baseRate = constrain(map(note, 36, 96, 0.65, 1.5), 0.5, 1.7);

    voice.rate(baseRate * issRateDrift);
    voice.setVolume(amp, 0.02);
    voice.play();

    noteToVoice[note] = { sound: voice, group };
  }

  spawnCleanSculpture(note, vel);
  spawnParticleHalo(note, vel);

  trimAll();
}

function onNoteOff(note) {
  const entry = noteToVoice[note];
  if (entry?.sound) fadeOutAndStop(entry.sound, 0.08);
  delete noteToVoice[note];
}

function trimAll() {
  if (solids.length > maxSolids) solids.splice(0, solids.length - maxSolids);
  if (particles.length > maxParticles) particles.splice(0, particles.length - maxParticles);
  if (connectors.length > maxConnectors) connectors.splice(0, connectors.length - maxConnectors);
}

// =====================================================
// GEOMETRY SPAWNS (CLEAN)
// =====================================================
function issAnchorPoint() {
  const x = map(world.issLon, -180, 180, -260, 260);
  const y = map(world.issLat, -90, 90, -170, 170);
  const z = map(world.cloud, 0, 100, 240, -240);
  return createVector(x, y, z);
}

function spawnCleanSculpture(note, vel) {
  const anchor = issAnchorPoint();

  // clean position: no jitter later, fixed at birth
  const pos = anchor.copy().add(createVector(
    random(-240, 240),
    random(-180, 180),
    random(-180, 180)
  ));

  // choose shape by pitch / surprise
  const pick = (note + vel + floor(random(0, 3))) % 3;
  const shape = pick === 0 ? "cube" : pick === 1 ? "circle" : "triangle";

  solids.push(new CleanSolid(shape, pos, note, vel));
}

function spawnParticleHalo(note, vel) {
  const anchor = issAnchorPoint();

  const count = floor(map(vel, 1, 127, 120, 520));
  for (let i = 0; i < count; i++) {
    particles.push(new CleanParticle(note, vel, anchor));
  }
}

// =====================================================
// CLEAN SOLID (NO VIBRATION, ONLY Z MOTION + SIZE LIFE)
// =====================================================
class CleanSolid {
  constructor(shape, pos, note, vel) {
    this.shape = shape;
    this.pos = pos.copy();
    this.note = note;
    this.vel = vel;

    this.birth = millis();
    this.life = map(vel, 0, 127, 2000, 6500);

    // no rotation jitter: fixed angles
    this.rot = createVector(
      map(note % 12, 0, 11, 0, PI),
      map((note + 3) % 12, 0, 11, 0, PI),
      map((vel + 7) % 12, 0, 11, 0, PI)
    );

    // clean depth movement (forward/back)
    this.zSpeed = map(world.wind, 0, 30, 0.18, 1.1) * random(0.7, 1.25);
    this.zDir = random() < 0.5 ? 1 : -1;

    // sizes: birth -> grow -> vanish
    this.sizeMin = map(vel, 0, 127, 8, 22);
    this.sizeMax = map(vel, 0, 127, 40, 140);

    // color: weather + note
    const humShift = map(world.humidity, 0, 100, 0, 40);
    const tempShift = map(world.temperature, -10, 40, 180, 330);
    this.hue = (map(note, 21, 108, 160, 360) + humShift + tempShift * 0.15) % 360;
  }

  isDead() {
    return millis() - this.birth > this.life;
  }

  update() {
    const t = constrain((millis() - this.birth) / this.life, 0, 1);

    // clean ease in/out for size
    const ease = t < 0.5
      ? (t * 2) * (t * 2)
      : 1 - pow((1 - t) * 2, 2);

    this.size = lerp(this.sizeMin, this.sizeMax, ease);

    // clean forward/back motion only on z
    this.pos.z += this.zDir * this.zSpeed;

    // if too far, reverse gently (gives oscillation without jitter)
    if (this.pos.z > 520) this.zDir = -1;
    if (this.pos.z < -520) this.zDir = 1;

    // alpha fades at end
    this.alpha = 1 - t;
  }

  draw() {
    push();
    translate(this.pos.x, this.pos.y, this.pos.z);

    // fixed, smooth rotation (no vibration)
    rotateX(this.rot.x);
    rotateY(this.rot.y);
    rotateZ(this.rot.z);

    // glass-ish clean material
    noStroke();
    ambientMaterial(this.hue, 55, 95, this.alpha * 0.9);
    specularMaterial(this.hue, 60, 100, this.alpha);
    shininess(180);

    const s = this.size;

    if (this.shape === "cube") {
      box(s, s, s);
    } else if (this.shape === "circle") {
      // circle plate in 3D (disc-like)
      drawDisc(s * 0.8, s * 0.25);
    } else if (this.shape === "triangle") {
      drawTrianglePlate(s * 0.9);
    }

    pop();
  }
}

// Disc in 3D
function drawDisc(radius, thickness) {
  push();
  rotateX(HALF_PI);
  cylinder(radius, thickness, 18, 1, true, true);
  pop();
}

// Triangle plate in 3D
function drawTrianglePlate(sz) {
  beginShape(TRIANGLES);
  const h = sz * 0.9;

  // 2 layers (front/back) to look solid-ish
  const zFront = sz * 0.12;
  const zBack = -sz * 0.12;

  const v1 = createVector(0, -h, zFront);
  const v2 = createVector(-sz, h * 0.65, zFront);
  const v3 = createVector(sz, h * 0.65, zFront);

  const v1b = createVector(0, -h, zBack);
  const v2b = createVector(-sz, h * 0.65, zBack);
  const v3b = createVector(sz, h * 0.65, zBack);

  // front
  vertex(v1.x, v1.y, v1.z); vertex(v2.x, v2.y, v2.z); vertex(v3.x, v3.y, v3.z);
  // back
  vertex(v1b.x, v1b.y, v1b.z); vertex(v3b.x, v3b.y, v3b.z); vertex(v2b.x, v2b.y, v2b.z);

  endShape();
}

// =====================================================
// PARTICLES (ATMOSPHERE, LIGHTWEIGHT)
// =====================================================
class CleanParticle {
  constructor(note, vel, anchor = null) {
    this.note = note;
    this.vel = vel || 60;

    this.birth = millis();
    this.life = note ? map(this.vel, 0, 127, 900, 2400) : random(3200, 8200);

    const base = anchor ? anchor.copy() : createVector(0,0,0);

    this.pos = base.add(createVector(
      random(-360, 360),
      random(-240, 240),
      random(-520, 520)
    ));

    // particles move, but soft
    const wind = map(world.wind, 0, 30, 0.2, 1.25);
    this.v = p5.Vector.random3D().mult(wind);

    // color tuned to environment
    const cloudHue = map(world.cloud, 0, 100, 180, 320);
    this.hue = (cloudHue + map(this.vel, 0, 127, 0, 90)) % 360;

    this.r = note ? map(this.vel, 0, 127, 1.2, 4.2) : random(1.0, 2.2);
  }

  isDead() {
    return millis() - this.birth > this.life;
  }

  update() {
    const t = constrain((millis() - this.birth) / this.life, 0, 1);
    this.alpha = (1 - t) * 0.65;

    // soft drift
    this.pos.add(this.v);

    // small wave to feel alive (but no jitter on solids)
    this.pos.y += sin(frameCount * 0.01 + this.pos.x * 0.01) * 0.12;

    // damp
    this.v.mult(0.995);
  }

  draw() {
    push();
    stroke(this.hue, 65, 100, this.alpha);
    strokeWeight(this.r);
    point(this.pos.x, this.pos.y, this.pos.z);
    pop();
  }
}

// =====================================================
// MIDI
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
      setStatus("✅ MIDI connected. Clean sculptural field ON.");
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
// POINTER EVENTS (Touch/Mouse/Pen)
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
// DRAW LOOP (CLEAN, SPACE, LIGHT)
// =====================================================
function draw() {
  background(0, 0.14);

  // Lights (invisible, but affecting shapes)
  lightPhase += 0.008 + map(world.wind, 0, 30, 0, 0.01);
  const dayAmp = world.isDay ? 1.0 : 0.55;

  ambientLight(12 * dayAmp);

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

  // ISS point light
  const issX = map(world.issLon, -180, 180, -240, 240);
  const issY = map(world.issLat, -90, 90, -160, 160);
  pointLight(255 * dayAmp, 200 * dayAmp, 140 * dayAmp, issX, issY, 360);

  // camera slow motion
  const cloudSpin = map(world.cloud, 0, 100, 0.0009, 0.0018);
  globalSpin += cloudSpin;

  rotateY(globalSpin);
  rotateX(sin(frameCount * 0.001) * 0.08);

  // particles (background energy)
  for (let p of particles) {
    p.update();
    p.draw();
  }
  particles = particles.filter(p => !p.isDead());

  // solids (clean sculpture)
  for (let s of solids) {
    s.update();
    s.draw();
  }
  solids = solids.filter(s => !s.isDead());

  // keep it alive
  if (particles.length < 1400) {
    particles.push(new CleanParticle(null, 60, createVector(0,0,0)));
  }

  // HUD small
  push();
  resetMatrix();
  fill(255);
  textAlign(LEFT, TOP);
  textSize(12);
  text("DUROME · Clean Sculptural Field 3.0 · Cubes / Circles / Triangles + Particles", 14, 14);
  pop();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
