let soundBankJSON = null;
let soundGroups = {};
let activeAtmos = null;
let atmosStarted = false;


let quantumSeed = 137;
let seedBinary = "01010101";

let midiAccess;
let midiReady = false;

let audioReady = false;
let started = false;

let synthCarrier, synthMetal, noiseBed;
let filterLP, reverb, delayFx;

let structures = [];
let globalEnergy = 0;

const rightHandSplit = 60; // C4 -> derecha >=60

// --------- Utilities ----------
function rng(n) {
  // pseudo random deterministic-ish using seed
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
    setStatus("⚠️ quantum_seed.json not found (using default seed 85)");
  }
}

function setStatus(msg) {
  const el = document.getElementById("status");
  if (el) el.textContent = msg;
}

// --------- p5 Setup ----------
function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL);
  colorMode(HSB, 360, 100, 100, 1);

  noStroke();
  background(0);

  loadQuantumSeed();

  // Prepare sound chain (starts on user interaction)
  filterLP = new p5.LowPass();
  filterLP.freq(2200);
  filterLP.res(8);

  reverb = new p5.Reverb();
  delayFx = new p5.Delay();

  // UI button
  const btn = document.getElementById("startBtn");
  btn.addEventListener("click", async () => {
    await userStartAudio();
    audioReady = true;

    setupSynth();
    setupMIDI();

    started = true;
    document.getElementById("overlay").style.display = "none";
  });
}

function setupSynth() {
  // Bright carrier + metallic partials
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

  setStatus("✅ Audio ready. Touch MIDI keys.");
}

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

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

// --------- MIDI Handling ----------
function handleMIDI(msg) {
  if (!audioReady) return;

  const [cmd, note, vel] = msg.data;
  const isNoteOn = cmd === 144 && vel > 0;
  const isNoteOff = cmd === 128 || (cmd === 144 && vel === 0);

  if (isNoteOn) onNoteOn(note, vel);
  if (isNoteOff) onNoteOff(note);
}

function onNoteOn(note, vel) {
  globalEnergy = constrain(globalEnergy + vel / 127, 0, 4);

  const freq = midiToFreq(note);
  const amp = map(vel, 1, 127, 0.03, 0.22);

  // Split: left hand builds harmony foundation, right hand melodic crystals
  const isRight = note >= rightHandSplit;

  // --- Sonic response ---
  // A "brilliant floral" sound: bright + airy noise + gentle detune
  const detune = map((quantumSeed % 17), 0, 16, 0.1, 0.9);

  synthCarrier.freq(freq);
  synthMetal.freq(freq * (isRight ? 2.01 : 1.5) + detune);

  // sub-structure: low movement (not medical claim—just sub-LFO aesthetic)
  const lfoRate = map((quantumSeed % 97), 0, 96, 0.06, 0.18);
  const breath = 0.6 + Math.sin(frameCount * lfoRate) * 0.35;

  synthCarrier.amp(amp * (isRight ? 1.0 : 0.65) * breath, 0.04);
  synthMetal.amp(amp * (isRight ? 0.75 : 0.55) * breath, 0.05);

  noiseBed.amp(amp * 0.15 * (isRight ? 1.0 : 0.65), 0.08);

  // Filter follows pitch
  filterLP.freq(constrain(freq * 2.2, 500, 4500));
  filterLP.res(isRight ? 10 : 7);

  // --- Visual structure ---
  const shapeType = isRight ? "crystal" : "foundation";
  structures.push(new Structure(note, vel, shapeType));
}

function onNoteOff(note) {
  // Fade sound gently when keys released (not fully silent if other notes are active)
  globalEnergy *= 0.85;

  if (globalEnergy < 0.05) {
    synthCarrier.amp(0, 0.25);
    synthMetal.amp(0, 0.3);
    noiseBed.amp(0, 0.3);
  }
}

// --------- Visual Structure Class ----------
class Structure {
  constructor(note, vel, type) {
    this.note = note;
    this.vel = vel;
    this.type = type;

    this.birth = millis();
    this.life = map(vel, 0, 127, 700, 2600);

    this.freq = midiToFreq(note);
    this.size = map(vel, 0, 127, 16, 110);

    this.spin = createVector(signedRng(0.02), signedRng(0.02), signedRng(0.02));
    this.pos = createVector(
      signedRng(320) * (0.8 + rng(0.4)),
      signedRng(220) * (0.8 + rng(0.5)),
      signedRng(340) * (0.8 + rng(0.5))
    );

    // HSB palette driven by quantum seed + pitch
    this.hue = (map(note, 21, 108, 210, 360) + quantumSeed * 2.2) % 360;
    this.alpha = 1.0;

    // shape complexity (triangles, cubes, spheres)
    const pick = (quantumSeed + note + vel) % 3;
    this.geom = pick === 0 ? "sphere" : pick === 1 ? "box" : "tetra";
  }

  isDead() {
    return millis() - this.birth > this.life;
  }

  update() {
    const t = (millis() - this.birth) / this.life;
    this.alpha = 1.0 - t;

    // motion: "network drift"
    const drift = 0.4 + rng(0.8);
    this.pos.x += Math.sin(frameCount * 0.01 + this.note * 0.11) * drift;
    this.pos.y += Math.cos(frameCount * 0.012 + this.note * 0.07) * drift;
    this.pos.z += Math.sin(frameCount * 0.008 + this.note * 0.09) * drift;

    // gentle rotation
    this.spin.mult(0.99);
  }

  draw() {
    push();
    translate(this.pos.x, this.pos.y, this.pos.z);

    rotateX(frameCount * this.spin.x);
    rotateY(frameCount * this.spin.y);
    rotateZ(frameCount * this.spin.z);

    const glow = this.type === "crystal" ? 1.0 : 0.75;
    const sat = this.type === "crystal" ? 55 : 35;
    const bri = this.type === "crystal" ? 95 : 75;

    // glass-like feel
    ambientMaterial(this.hue, sat, bri, this.alpha * 0.95);
    specularMaterial(this.hue, sat, 100, this.alpha);
    shininess(80);

    // Draw geometry
    const s = this.size * (0.55 + this.alpha * 0.65);

    if (this.geom === "sphere") {
      sphere(s * 0.75, 18, 12);
    } else if (this.geom === "box") {
      box(s, s * 0.6, s * 0.8);
    } else if (this.geom === "tetra") {
      drawTetra(s * 0.9);
    }

    // connection lines (network metaphor)
    pop();
  }
}

// simple tetra shape (triangular vibe)
function drawTetra(sz) {
  beginShape(TRIANGLES);

  // vertices
  const v0 = createVector(0, -sz, 0);
  const v1 = createVector(-sz, sz, -sz);
  const v2 = createVector(sz, sz, -sz);
  const v3 = createVector(0, sz, sz);

  // faces
  vertex(v0.x, v0.y, v0.z); vertex(v1.x, v1.y, v1.z); vertex(v2.x, v2.y, v2.z);
  vertex(v0.x, v0.y, v0.z); vertex(v2.x, v2.y, v2.z); vertex(v3.x, v3.y, v3.z);
  vertex(v0.x, v0.y, v0.z); vertex(v3.x, v3.y, v3.z); vertex(v1.x, v1.y, v1.z);
  vertex(v1.x, v1.y, v1.z); vertex(v3.x, v3.y, v3.z); vertex(v2.x, v2.y, v2.z);

  endShape();
}

// --------- Draw Loop ----------
function draw() {
  background(0, 0.14);

  // cinematic lighting
  ambientLight(35);
  directionalLight(255, 255, 255, -0.4, -0.6, -1);
  pointLight(100, 120, 255, 0, 0, 300);

  rotateY(frameCount * 0.0016 + quantumSeed * 0.0009);
  rotateX(Math.sin(frameCount * 0.001) * 0.1);

  // network pulse (only when playing)
  const energyPulse = constrain(globalEnergy, 0, 2);
  const coreSize = 80 + energyPulse * 160;

  push();
  noStroke();
  fill((220 + quantumSeed) % 360, 40, 40, 0.6);
  sphere(coreSize * 0.1);
  pop();

  // update/draw structures
  for (let s of structures) {
    s.update();
    s.draw();
  }

  structures = structures.filter((s) => !s.isDead());

  // gentle fade out if no activity
  globalEnergy *= 0.985;
}


