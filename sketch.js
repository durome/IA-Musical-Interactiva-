// =====================================================
// DUROME · Quantum Sky Field (Cubes + Particles)
// External signals: Weather + ISS position
// MIDI / Keyboard / Pointer Universal
// =====================================================

let midiAccess;
let midiReady = false;

let audioReady = false;
let started = false;

let soundBankJSON = null;
let soundGroups = {};
const VOICES_PER_FILE = 5;

let noteToVoice = {};
let pointerIdToNote = {};
let pressedKeys = {};

const rightHandSplit = 60;
const randomNotesPool = [36,38,40,43,45,48,50,52,55,57,60,62,64,67,69,71,72,74,76,79];

// --------------------------
// External World State
// --------------------------
let world = {
  temperature: 20,
  wind: 2,
  humidity: 50,
  isDay: 1,
  cloud: 30,
  lastWeatherUpdate: 0,

  issLat: 0,
  issLon: 0,
  issVel: 0,
  lastISSUpdate: 0
};

// --------------------------
// Visual world (hybrid)
// --------------------------
let cubes = [];
let particles = [];

let maxCubes = 220;
let maxParticles = 1200;

let lightPhase = 0;

// --------------------------
// Keyboard -> notes
// --------------------------
const keyboardMap = {
  "a": 48, "s": 50, "d": 52, "f": 53, "g": 55, "h": 57, "j": 59,
  "k": 60, "l": 62,
  "q": 60, "w": 62, "e": 64, "r": 65, "t": 67, "y": 69, "u": 71,
  "i": 72, "o": 74, "p": 76
};

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

  // Start fetching external signals
  fetchWeather();
  fetchISS();
  setInterval(fetchWeather, 120000); // cada 2 min
  setInterval(fetchISS, 15000);      // cada 15s (ISS cambia rápido)

  const btn = document.getElementById("startBtn");
  btn.addEventListener("click", async () => {
    await userStartAudio();
    audioReady = true;
    started = true;

    setupMIDI();
    attachUniversalPointerEvents();

    document.getElementById("overlay").style.display = "none";
    setStatus("✅ Ready: MIDI / Keyboard / Touch / Mouse · World-reactive ON");
  });
}

// =====================================================
// UI Status
// =====================================================
function setStatus(msg) {
  const el = document.getElementById("status");
  if (el) el.textContent = msg;
}

// =====================================================
// External Signals
// =====================================================
async function fetchWeather() {
  try {
    // Valencia (39.47, -0.38)
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
    world.lastWeatherUpdate = millis();

    // console.log("Weather:", world);
  } catch (e) {
    console.warn("Weather fetch failed:", e);
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
    world.lastISSUpdate = millis();

    // console.log("ISS:", world.issLat, world.issLon, world.issVel);
  } catch (e) {
    console.warn("ISS fetch failed:", e);
  }
}

// =====================================================
// SOUND SYSTEM (POLY)
// =====================================================
function loadAllSoundsFromJSON() {
  if (!soundBankJSON) {
    setStatus("❌ soundbank.json missing.");
    return;
  }

  soundGroups = {};
  const groups = Object.keys(soundBankJSON);

  let totalToLoad = 0;
  let loaded = 0;

  for (let g of groups) totalToLoad += (soundBankJSON[g]?.length || 0) * VOICES_PER_FILE;
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
            if (loaded >= totalToLoad) setStatus("✅ Sounds loaded. Press START.");
          },
          () => {
            loaded++;
            setStatus(`⚠️ Missing: ${file} (${loaded}/${totalToLoad})`);
            if (loaded >= totalToLoad) setStatus("✅ Loaded with warnings. Press START.");
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
  if (!fileObj?.voices?.length) return null;

  for (let v of fileObj.voices) {
    if (!v.isPlaying()) return v;
  }

  const v = random(fileObj.voices);
  if (v && v.isPlaying()) v.stop();
  return v;
}

function fadeOutAndStop(snd, seconds = 0.08) {
  if (!snd) return;
  try {
    snd.setVolume(0, seconds);
    setTimeout(() => { try { snd.stop(); } catch(e) {} }, seconds * 1000 + 70);
  } catch(e) {
    try { snd.stop(); } catch(e2) {}
  }
}

function pickGroupForNote(note) {
  const isRight = note >= rightHandSplit;

  // satélite + clima influyen sutilmente en la elección sonora
  const issEnergy = constrain(map(world.issVel, 7600, 7800, 0, 1), 0, 1);
  const humidityBias = constrain(map(world.humidity, 0, 100, 0, 1), 0, 1);

  if (isRight) {
    if (soundGroups.shimmer && random() < (0.55 + issEnergy * 0.25)) return "shimmer";
    return "glass";
  } else {
    if (soundGroups.atmos && random() < (0.55 + humidityBias * 0.3)) return "atmos";
    return "glass";
  }
}

// =====================================================
// NOTE ON / OFF
// =====================================================
function onNoteOn(note, vel) {
  if (!audioReady) return;

  // cut if already playing same note
  if (noteToVoice[note]?.sound) {
    fadeOutAndStop(noteToVoice[note].sound, 0.03);
    delete noteToVoice[note];
  }

  const group = pickGroupForNote(note);
  const voice = getAvailableVoice(group);
  if (!voice) return;

  // weather affects amplitude & shimmer speed
  const windBoost = map(world.wind, 0, 30, 0.95, 1.15);
  const amp = map(vel, 1, 127, 0.05, 0.22) * windBoost;

  // iss velocity affects pitch drift rate (rate)
  const issRateDrift = map(world.issVel, 7600, 7800, 0.9, 1.12);
  const baseRate = constrain(map(note, 36, 96, 0.6, 1.55), 0.45, 1.8);

  voice.rate(baseRate * issRateDrift);
  voice.setVolume(amp, 0.02);
  voice.play();

  noteToVoice[note] = { sound: voice, group };

  // hybrid spawn: cubes + particles + emergent forms
  spawnHybrid(note, vel);
}

function onNoteOff(note) {
  const entry = noteToVoice[note];
  if (entry?.sound) fadeOutAndStop(entry.sound, 0.08);
  delete noteToVoice[note];
}

// =====================================================
// HYBRID VISUAL SPAWNS (cubes + particles + forms)
// =====================================================
function spawnHybrid(note, vel) {
  // External energy controls density
  const windFactor = constrain(map(world.wind, 0, 30, 0.8, 2.2), 0.8, 2.2);
  const issFactor = constrain(map(world.issVel, 7600, 7800, 0.9, 1.5), 0.9, 1.5);

  // How many elements per note
  const cubeCount = floor(map(vel, 1, 127, 2, 12) * issFactor);
  const particleCount = floor(map(vel, 1, 127, 30, 170) * windFactor);

  // Mode emerges: ring / spiral / burst / drift
  const mode = pickEmergentMode(note, vel);

  // Anchor position influenced by ISS lat/lon
  const anchor = issAnchorPoint();

  for (let i = 0; i < cubeCount; i++) {
    cubes.push(new CubeShard(note, vel, mode, anchor));
  }

  for (let i = 0; i < particleCount; i++) {
    particles.push(new ParticleNode(note, vel, mode, anchor));
  }

  if (cubes.length > maxCubes) cubes.splice(0, cubes.length - maxCubes);
  if (particles.length > maxParticles) particles.splice(0, particles.length - maxParticles);
}

function pickEmergentMode(note, vel) {
  // “forma” influenciada por clima + pitch
  const t = (note + vel + floor(world.temperature)) % 4;
  if (t === 0) return "ring";
  if (t === 1) return "spiral";
  if (t === 2) return "burst";
  return "drift";
}

function issAnchorPoint() {
  // map ISS coordinates into scene space
  const x = map(world.issLon, -180, 180, -260, 260);
  const y = map(world.issLat, -90, 90, -170, 170);
  const z = map(world.cloud, 0, 100, 220, -220);
  return createVector(x, y, z);
}

// =====================================================
// Cube Shards
// =====================================================
class CubeShard {
  constructor(note, vel, mode, anchor) {
    this.note = note;
    this.vel = vel;
    this.mode = mode;

    this.birth = millis();
    this.life = map(vel, 0, 127, 1400, 5200);

    this.baseSize = map(vel, 0, 127, 10, 85) * random(0.55, 1.25);

    this.pos = anchor.copy();
    this.pos.add(createVector(random(-80, 80), random(-80, 80), random(-80, 80)));

    this.spin = createVector(random(-0.03, 0.03), random(-0.03, 0.03), random(-0.03, 0.03));

    // color influenced by day/night + humidity
    const dayShift = world.isDay ? 0 : 40;
    const humShift = map(world.humidity, 0, 100, 0, 30);

    this.hue = (map(note, 21, 108, 160, 360) + dayShift + humShift) % 360;
    this.alpha = 1.0;

    // direction depends on mode
    this.velVec = p5.Vector.random3D().mult(map(world.wind, 0, 30, 0.25, 2.2));
  }

  isDead() {
    return millis() - this.birth > this.life;
  }

  update() {
    const t = (millis() - this.birth) / this.life;
    this.alpha = 1.0 - t;

    // Different movement modes
    if (this.mode === "ring") {
      const a = frameCount * 0.015 + this.note * 0.01;
      this.pos.x += cos(a) * 0.9;
      this.pos.y += sin(a) * 0.6;
    } else if (this.mode === "spiral") {
      const a = frameCount * 0.013 + this.note * 0.02;
      this.pos.x += cos(a) * 1.2;
      this.pos.z += sin(a) * 1.2;
      this.pos.y += sin(a * 0.5) * 0.7;
    } else if (this.mode === "burst") {
      this.pos.add(this.velVec.copy().mult(1.35));
    } else {
      // drift
      this.pos.add(this.velVec.copy().mult(0.55));
      this.pos.x += sin(frameCount * 0.01 + this.note * 0.03) * 0.3;
      this.pos.y += cos(frameCount * 0.01 + this.note * 0.02) * 0.3;
    }

    this.velVec.mult(0.985);
  }

  draw() {
    push();
    translate(this.pos.x, this.pos.y, this.pos.z);

    rotateX(frameCount * this.spin.x);
    rotateY(frameCount * this.spin.y);
    rotateZ(frameCount * this.spin.z);

    ambientMaterial(this.hue, 55, 94, this.alpha * 0.85);
    specularMaterial(this.hue, 70, 100, this.alpha);
    shininess(170);

    const s = this.baseSize * (0.5 + this.alpha * 0.8);

    box(s, s * random(0.35, 1.25), s * random(0.35, 1.25));

    pop();
  }
}

// =====================================================
// Particle Nodes
// =====================================================
class ParticleNode {
  constructor(note, vel, mode, anchor) {
    this.note = note;
    this.vel = vel;
    this.mode = mode;

    this.birth = millis();
    this.life = map(vel, 0, 127, 900, 2800);

    this.pos = anchor.copy();
    this.pos.add(createVector(random(-120, 120), random(-120, 120), random(-120, 120)));

    // particles move with “atmospheric wind”
    this.velVec = p5.Vector.random3D().mult(map(world.wind, 0, 30, 0.15, 2.6));

    // hue follows ISS longitude + note
    const issHue = map(world.issLon, -180, 180, 180, 360);
    this.hue = (issHue + map(note, 20, 100, 0, 90)) % 360;

    this.alpha = 1.0;
    this.r = map(vel, 0, 127, 1.0, 4.0);
  }

  isDead() {
    return millis() - this.birth > this.life;
  }

  update() {
    const t = (millis() - this.birth) / this.life;
    this.alpha = 1.0 - t;

    if (this.mode === "ring") {
      const a = frameCount * 0.02 + this.note * 0.05;
      this.pos.x += cos(a) * 0.7;
      this.pos.z += sin(a) * 0.7;
    } else if (this.mode === "spiral") {
      const a = frameCount * 0.015 + this.note * 0.03;
      this.pos.x += cos(a) * 0.9;
      this.pos.y += sin(a) * 0.6;
      this.pos.z += sin(a * 0.8) * 0.9;
    } else if (this.mode === "burst") {
      this.pos.add(this.velVec.copy().mult(1.6));
    } else {
      this.pos.add(this.velVec.copy().mult(0.55));
    }

    this.velVec.mult(0.992);
  }

  draw() {
    push();
    translate(this.pos.x, this.pos.y, this.pos.z);

    // particle as tiny glowing sphere
    ambientMaterial(this.hue, 65, 100, this.alpha * 0.65);
    sphere(this.r * (0.7 + this.alpha), 8, 6);

    pop();
  }
}

// =====================================================
// MIDI
// =====================================================
function setupMIDI() {
  if (!navigator.requestMIDIAccess) {
    setStatus("⚠️ No WebMIDI. Touch/keyboard works.");
    return;
  }
  navigator.requestMIDIAccess().then(
    (midi) => {
      midiAccess = midi;
      const inputs = Array.from(midiAccess.inputs.values());
      inputs.forEach((input) => (input.onmidimessage = handleMIDI));
      midiReady = true;
      setStatus("✅ MIDI connected. World-reactive ON.");
    },
    () => setStatus("⚠️ MIDI failed. Touch/keyboard works.")
  );
}

function handleMIDI(msg) {
  const [cmd, note, vel] = msg.data;
  const isNoteOn = cmd === 144 && vel > 0;
  const isNoteOff = cmd === 128 || (cmd === 144 && vel === 0);
  if (isNoteOn) onNoteOn(note, vel);
  if (isNoteOff) onNoteOff(note);
}

// =====================================================
// Keyboard
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
// Pointer events universal (touch/mouse/pen)
// =====================================================
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

// =====================================================
// DRAW (lights + hybrid world)
// =====================================================
function draw() {
  background(0, 0.16);

  // Light phase + world influence
  lightPhase += 0.008 + map(world.wind, 0, 30, 0, 0.01);

  // Day/night controls global ambiance
  const dayAmp = world.isDay ? 1.0 : 0.55;
  ambientLight(16 * dayAmp);

  // Invisible directional lights: they tint structures dynamically
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

  // ISS pointLight = “orbital core”
  const issX = map(world.issLon, -180, 180, -240, 240);
  const issY = map(world.issLat, -90, 90, -160, 160);
  const issZ = 350;

  pointLight(
    255 * dayAmp,
    200 * dayAmp,
    140 * dayAmp,
    issX, issY, issZ
  );

  // Camera drift (cloud cover influences softness)
  rotateY(frameCount * (0.001 + map(world.cloud, 0, 100, 0, 0.0008)));
  rotateX(sin(frameCount * 0.001) * 0.12);

  // Core field nucleus
  push();
  fill(map(world.temperature, -10, 40, 180, 320), 35, 35, 0.25);
  sphere(22 + sin(frameCount * 0.02) * 3);
  pop();

  // Update/draw particles first (depth feel)
  for (let p of particles) {
    p.update();
    p.draw();
  }
  particles = particles.filter((p) => !p.isDead());

  // Update/draw cubes
  for (let c of cubes) {
    c.update();
    c.draw();
  }
  cubes = cubes.filter((c) => !c.isDead());

  // HUD small
  push();
  resetMatrix();
  fill(255);
  textAlign(LEFT, TOP);
  textSize(12);
  text("Quantum Sky Field · cubes + particles · weather + ISS", 14, 14);
  text(`Valencia: ${world.temperature}°C · wind ${world.wind}km/h · humidity ${world.humidity}%`, 14, 32);
  pop();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}



