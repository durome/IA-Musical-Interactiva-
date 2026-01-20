let midiAccess;
let midiReady = false;

let audioReady = false;
let started = false;

let soundBankJSON = null;
let soundGroups = {};
const VOICES_PER_FILE = 5;

let noteToVoice = {};           // nota -> sonido activo
let pointerIdToNote = {};       // pointerId -> nota activa (touch/mouse/pen)
let pressedKeys = {};           // teclado pc -> activo

const rightHandSplit = 60;
const randomNotesPool = [36,38,40,43,45,48,50,52,55,57,60,62,64,67,69,71,72,74,76,79];

// Teclado ordenador -> notas
const keyboardMap = {
  "a": 48, "s": 50, "d": 52, "f": 53, "g": 55, "h": 57, "j": 59,
  "k": 60, "l": 62,
  "q": 60, "w": 62, "e": 64, "r": 65, "t": 67, "y": 69, "u": 71,
  "i": 72, "o": 74, "p": 76
};

// --------------------
// VISUAL WORLD (CUBES)
// --------------------
let cubes = [];
let maxCubes = 220;

// luces (sin objeto visible, solo iluminación)
let lightPhase = 0;

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
    await userStartAudio();
    audioReady = true;
    started = true;

    setupMIDI();
    attachUniversalPointerEvents();

    document.getElementById("overlay").style.display = "none";
    setStatus("✅ Ready: MIDI / Keyboard / Touch / Mouse / Pen");
  });
}

function setStatus(msg) {
  const el = document.getElementById("status");
  if (el) el.textContent = msg;
}

// --------------------
// SOUND SYSTEM (POLY)
// --------------------
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
  if (isRight) {
    if (soundGroups.shimmer && random() < 0.65) return "shimmer";
    return "glass";
  } else {
    if (soundGroups.atmos && random() < 0.7) return "atmos";
    return "glass";
  }
}

// --------------------
// NOTE ON / OFF
// --------------------
function onNoteOn(note, vel) {
  if (!audioReady) return;

  if (noteToVoice[note]?.sound) {
    fadeOutAndStop(noteToVoice[note].sound, 0.03);
    delete noteToVoice[note];
  }

  const group = pickGroupForNote(note);
  const voice = getAvailableVoice(group);
  if (!voice) return;

  const amp = map(vel, 1, 127, 0.06, 0.22);
  const rate = constrain(map(note, 36, 96, 0.6, 1.55), 0.45, 1.8);

  voice.rate(rate);
  voice.setVolume(amp, 0.02);
  voice.play();

  noteToVoice[note] = { sound: voice, group };

  // 🔥 aquí construimos cubos con el sonido
  spawnCubeCluster(note, vel);
}

function onNoteOff(note) {
  const entry = noteToVoice[note];
  if (entry?.sound) fadeOutAndStop(entry.sound, 0.08);
  delete noteToVoice[note];
}

// --------------------
// CUBE SYSTEM
// --------------------
function spawnCubeCluster(note, vel) {
  // cluster de cubos aleatorio (más vel => más cubos)
  const count = floor(map(vel, 1, 127, 2, 18));

  for (let i = 0; i < count; i++) {
    cubes.push(new CubeShard(note, vel));
  }

  // limit para que no explote
  if (cubes.length > maxCubes) {
    cubes.splice(0, cubes.length - maxCubes);
  }
}

class CubeShard {
  constructor(note, vel) {
    this.note = note;
    this.vel = vel;

    this.birth = millis();
    this.life = map(vel, 0, 127, 1100, 4200);

    // tamaño según nota y velocidad
    this.size = map(vel, 0, 127, 8, 70) * random(0.55, 1.25);

    // posición 3D expandida
    this.pos = createVector(
      random(-480, 480),
      random(-320, 320),
      random(-520, 520)
    );

    // velocidad “constructiva”
    const drift = map(note, 36, 84, 0.4, 2.1);
    this.velVec = p5.Vector.random3D().mult(drift);

    // rotación
    this.spin = createVector(
      random(-0.03, 0.03),
      random(-0.03, 0.03),
      random(-0.03, 0.03)
    );

    this.hue = (map(note, 21, 108, 180, 360) + vel * 1.4) % 360;
    this.alpha = 1.0;
  }

  isDead() {
    return millis() - this.birth > this.life;
  }

  update() {
    const t = (millis() - this.birth) / this.life;
    this.alpha = 1.0 - t;

    // movimiento como flujo de capital bifurcado
    this.pos.add(this.velVec);

    // suaviza drift
    this.velVec.mult(0.985);
  }

  draw() {
    push();
    translate(this.pos.x, this.pos.y, this.pos.z);

    rotateX(frameCount * this.spin.x);
    rotateY(frameCount * this.spin.y);
    rotateZ(frameCount * this.spin.z);

    // vidrio cromático
    ambientMaterial(this.hue, 55, 90, this.alpha * 0.85);
    specularMaterial(this.hue, 65, 100, this.alpha);
    shininess(140);

    box(this.size, this.size * random(0.4, 1.1), this.size * random(0.4, 1.1));

    pop();
  }
}

// --------------------
// MIDI
// --------------------
function setupMIDI() {
  if (!navigator.requestMIDIAccess) {
    setStatus("⚠️ No WebMIDI. Keyboard/Touch enabled.");
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
    () => setStatus("⚠️ MIDI failed. Keyboard/Touch enabled.")
  );
}

function handleMIDI(msg) {
  const [cmd, note, vel] = msg.data;
  const isNoteOn = cmd === 144 && vel > 0;
  const isNoteOff = cmd === 128 || (cmd === 144 && vel === 0);

  if (isNoteOn) onNoteOn(note, vel);
  if (isNoteOff) onNoteOff(note);
}

// --------------------
// Keyboard
// --------------------
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

// --------------------
// Pointer events universal (touch/mouse/pen)
// --------------------
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

// --------------------
// DRAW: luces direccionales coloreadas (invisibles)
// --------------------
function draw() {
  background(0, 0.16);

  // movimiento continuo de luz
  lightPhase += 0.007;

  // base
  ambientLight(18);

  // focos direccionales invisibles (solo luz)
  // 1 azul-violeta
  directionalLight(
    80 + 60 * sin(lightPhase),
    120,
    255,
    -0.6, -0.3, -1
  );

  // 2 magenta
  directionalLight(
    255,
    80 + 80 * sin(lightPhase * 1.3),
    180,
    0.7, 0.4, -1
  );

  // 3 verde / lima
  directionalLight(
    140,
    255,
    120 + 50 * sin(lightPhase * 0.9),
    0.2, -0.8, -1
  );

  // 4 foco cálido (como oro)
  pointLight(
    255,
    210,
    120,
    0,
    0,
    420
  );

  rotateY(frameCount * 0.0012);
  rotateX(sin(frameCount * 0.001) * 0.12);

  // núcleo (como campo energético)
  push();
  fill(220, 35, 35, 0.35);
  sphere(24 + sin(frameCount * 0.02) * 4);
  pop();

  // actualizar / dibujar cubos
  for (let c of cubes) {
    c.update();
    c.draw();
  }

  cubes = cubes.filter((c) => !c.isDead());

  // HUD minimal
  push();
  resetMatrix();
  fill(255);
  textAlign(LEFT, TOP);
  textSize(12);
  text("CUBES FIELD · MIDI / Keyboard / Touch / Mouse", 14, 14);
  text("Hold input = sound | Release = stop", 14, 32);
  pop();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}


