// -------------------- SOUND BANK (GitHub Assets via JSON) --------------------
let soundBankJSON = null;
let soundGroups = {};
let activeAtmos = null;
let atmosStarted = false;

// -------------------- QUANTUM --------------------
let quantumSeed = 137;
let seedBinary = "01010101";

// -------------------- MIDI / AUDIO --------------------
let midiAccess;
let midiReady = false;

let audioReady = false;

let synthCarrier, synthMetal, noiseBed;
let filterLP, reverb, delayFx;

let structures = [];
let globalEnergy = 0;

const rightHandSplit = 60; // C4 -> derecha >=60

// -------------------- PRELOAD --------------------
function preload() {
  // Cargar el JSON con las rutas de sonidos
  soundBankJSON = loadJSON("soundbank.json", () => {
    console.log("✅ soundbank.json loaded");
  }, () => {
    console.warn("⚠️ soundbank.json not found");
  });
}

// -------------------- UTILITIES --------------------
function rng(n) {
  const x = Math.sin((frameCount + 1) * 0.017 + quantumSeed * 0.113) * 10000;
  return (x - Math.floor(x)) * (n || 1);
}

function signedRng(n) {
  return (rng(1) * 2 - 1) * (n || 1);
}

async function loadQuantumSeed() {
  try {
    const res = await fetch("quantum_seed.json?nocache=" + Date.now());
    const data = await res.json();
    quantumSeed = Number(data.seed_int ?? 85);
    seedBinary = String(data.seed_binary ?? "01010101");
    setStatus(`✅ Quantum seed loaded: ${seedBinary} → ${quantumSeed}`);
  } catch (err) {
    setStatus("⚠️ quantum_seed.json not found (using default seed)");
  }
}

function setStatus(msg) {
  const el = document.getElementById("status");
  if (el) el.textContent = msg;
}

// -------------------- SOUND BANK BUILD --------------------
function buildSoundBankFromJSON() {
  if (!soundBankJSON) {
    console.warn("⚠️ No soundbank.json loaded.");
    return;
  }

  for (let group in soundBankJSON) {
    soundGroups[group] = [];

    for (let file of soundBankJSON[group]) {
      let snd = loadSound(
        file,
        () => console.log("✅ loaded:", file),
        () => console.warn("❌ failed:", file)
      );
      soundGroups[group].push(snd);
    }
  }

  console.log("✅ Sound groups:", Object.keys(soundGroups));
}

function startAtmosphereLoop() {
  if (atmosStarted) return;
  atmosStarted = true;

  if (!soundGroups.atmos || soundGroups.atmos.length === 0) {
    console.warn("⚠️ No atmos sounds available.");
    return;
  }

  playNewAtmosLayer();

  // Cambia la atmósfera cada 22–40 segundos
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

  // stop anterior si estaba sonando
  if (activeAtmos && activeAtmos.isPlaying()) {
    activeAtmos.stop();
  }

  activeAtmos = random(soundGroups.atmos);
  if (!activeAtmos) return;

  activeAtmos.setVolume(random(0.04, 0.12));
  activeAtmos.rate(random(0.85, 1.15));
  activeAtmos.play();
}

function playOneShot(groupName, vMin = 0.05, vMax = 0.15) {
  if (!soundGroups[groupName] || soundGroups[groupName].length === 0) return;

  let s = random(soundGroups[groupName]);
  if (!s) return;

  s.setVolume(random(vMin, vMax));
  s.rate(random(0.9, 1.2));
  s.play();
}

// -------------------- SETUP --------------------
function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL);
  colorMode(HSB, 360, 100, 100, 1);

  noStroke();
  background(0);

  loadQuantumSeed();

  // Construye banco de sonidos (después de preload)
  buildSoundBankFromJSON();

  // Cadena de sonido (se activa con click)
  filterLP = new p5.LowPass();
  filterLP.freq(2200);
  filterLP.res(8);

  reverb = new p5.Reverb();
  delayFx = new p5.Delay();

  // UI button (index.html)
  const btn = document.getElementById("startBtn");

  if (btn) {
    btn.addEventListener("click", async () => {
      await userStartAudio();
      audioReady = true;

      setupSynth();
      setupMIDI();

      startAtmosphereLoop(); // ✅ atmósfera viva SOLO tras click

      setStatus("✅ Audio + MIDI ready. Play the piano.");
      document.getElementById("overlay").style.display = "none";
    });
  } else {
    console.warn("⚠️ startBtn not found in HTML.");
  }
}

function setupSynth() {
  synthCarrier = new p5.Oscillator("triangle");
  synthMetal = new p5.Oscillator("sawtooth");
  noiseBed = new p5.Noise("pink");

  synthCarrier.disconnect();
  synthMetal.disconnect();
  noiseBed.disconnect();

  synthCarrier.connect(filterLP);
  synthMetal.connect(filterLP);
  noiseBed.connect(filterLP);

  reverb.process(filterLP, 6.5, 0.75);
  delayFx.process(filterLP, 0.25, 0.35, 2400);

  synthCarrier.amp(0);
  synthMetal.amp(0);
  noiseBed.amp(0);
}

// -------------------- MIDI --------------------
function setupMIDI() {
  if (!navigator.requestMIDIAccess) {
    setStatus("❌ WebMIDI not supported. Use Chrome/Edge.");
    return;
  }

  navigator.requestMIDIAccess().then(
    (midi) => {
      midiAccess = midi;
      const inputs = Array.from(midiAccess.inputs.values());
      inputs.forEach((input) => (input.onmidimessage = handleMIDI));
      midiReady = true;
      setStatus("✅ MIDI connected. Play the piano.");
    },
    () => setStatus("❌ MIDI access failed.")
  );
}

function handleMIDI(msg) {
  if (!audioReady) return;

  const [cmd, note, vel] = msg.data;

  const isNoteOn = cmd === 144 && vel > 0;
  const isNoteOff = cmd === 128 || (cmd === 144 && vel === 0);

  if (isNoteOn) onNoteOn(note, vel);
  if (isNoteOff) onNoteOff(note);
}

// -------------------- NOTE EVENTS --------------------
function onNoteOn(note, vel) {
  globalEnergy = constrain(globalEnergy + vel / 127, 0, 4);

  const freq = midiToFreq(note);
  const amp = map(vel, 1, 127, 0.03, 0.22);

  const isRight = note >= rightHandSplit;

  // --- SYNTH SOUND ---
  const detune = map((quantumSeed % 17), 0, 16, 0.1, 0.9);

  synthCarrier.freq(freq);
  synthMetal.freq(freq * (isRight ? 2.01 : 1.5) + detune);

  const lfoRate = map((quantumSeed % 97), 0, 96, 0.06, 0.18);
  const breath = 0.6 + Math.sin(frameCount * lfoRate) * 0.35;

  synthCarrier.amp(amp * (isRight ? 1.0 : 0.65) * breath, 0.04);
  synthMetal.amp(amp * (isRight ? 0.75 : 0.55) * breath, 0.05);
  noiseBed.amp(amp * 0.15 * (isRight ? 1.0 : 0.65), 0.08);

  filterLP.freq(constrain(freq * 2.2, 500, 4500));
  filterLP.res(isRight ? 10 : 7);

  // --- OPTIONAL: GLASS HITS ---
  if (soundGroups.glass && soundGroups.glass.length > 0) {
    if (random() < 0.35) playOneShot("glass", 0.06, 0.20);
  }

  // --- VISUAL ---
  const shapeType = isRight ? "crystal" : "foundation";
  structures.push(new Structure(note, vel, shapeType));
}

function onNoteOff(note) {
  globalEnergy *= 0.85;

  if (globalEnergy < 0.05) {
    synthCarrier.amp(0, 0.25);
    synthMetal.amp(0, 0.3);
    noiseBed.amp(0, 0.3);
  }
}

// -------------------- VISUAL STRUCTURES --------------------
class Structure {
  constructor(note, vel, type) {
    this.note = note;
    this.vel = vel;
    this.type = type;

    this.birth = millis();
    this.life = map(vel, 0, 127, 700, 2600);

    this.size = map(vel, 0, 127, 16, 110);

    this.spin = createVector(signedRng(0.02), signedRng(0.02), signedRng(0.02));
    this.pos = createVector(
      signedRng(320) * (0.8 + rng(0.4)),
      signedRng(220) * (0.8 + rng(0.5)),
      signedRng(340) * (0.8 + rng(0.5))
    );

    this.hue = (map(note, 21, 108, 210, 360) + quantumSeed * 2.2) % 360;
    this.alpha = 1.0;

    const pick = (quantumSeed + note + vel) % 3;
    this.geom = pick === 0 ? "sphere" : pick === 1 ? "box" : "tetra";
  }

  isDead() {
    return millis() - this.birth > this.life;
  }

  update() {
    const t = (millis() - this.birth) / this.life;
    this.alpha = 1.0 - t;

    const drift = 0.4 + rng(0.8);
    this.pos.x += Math.sin(frameCount * 0.01 + this.note * 0.11) * drift;
    this.pos.y += Math.cos(frameCount * 0.012 + this.note * 0.07) * drift;
    this.pos.z += Math.sin(frameCount * 0.008 + this.note * 0.09) * drift;

    this.spin.mult(0.99);
  }

  draw() {
    push();
    translate(this.pos.x, this.pos.y, this.pos.z);

    rotateX(frameCount * this.spin.x);
    rotateY(frameCount * this.spin.y);
    rotateZ(frameCount * this.spin.z);

    const sat = this.type === "crystal" ? 55 : 35;
    const bri = this.type === "crystal" ? 95 : 75;

    ambientMaterial(this.hue, sat, bri, this.alpha * 0.95);
    specularMaterial(this.hue, sat, 100, this.alpha);
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

// -------------------- DRAW LOOP --------------------
function draw() {
  background(0, 0.14);

  ambientLight(35);
  directionalLight(255, 255, 255, -0.4, -0.6, -1);
  pointLight(100, 120, 255, 0, 0, 300);

  rotateY(frameCount * 0.0016 + quantumSeed * 0.0009);
  rotateX(Math.sin(frameCount * 0.001) * 0.1);

  const energyPulse = constrain(globalEnergy, 0, 2);
  const coreSize = 80 + energyPulse * 160;

  push();
  fill((220 + quantumSeed) % 360, 40, 40, 0.6);
  sphere(coreSize * 0.1);
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
