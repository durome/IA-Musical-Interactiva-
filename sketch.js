let midiAccess;
let midiReady = false;

let audioReady = false;
let started = false;

let soundBankJSON = null;

// soundGroups[group] = [ SoundVoice, SoundVoice, ... ]
// Cada SoundVoice es { file, sound: [voice1, voice2, ...] }
let soundGroups = {};
const VOICES_PER_FILE = 5; // polifonía por archivo

// Nota -> voice actualmente sonando (para parar al soltar)
let noteToVoice = {};   // { 60: {sound: p5.SoundFile, group:"glass"} }
let noteToMeta = {};    // opcional

// Touch -> note
let touchIdToNote = {}; // { touchId: note }

let structures = [];
let globalEnergy = 0;

const rightHandSplit = 60; // C4

// ---------------------
// TECLADO -> NOTAS
// ---------------------
const keyboardMap = {
  "a": 48, "s": 50, "d": 52, "f": 53, "g": 55, "h": 57, "j": 59,
  "k": 60, "l": 62,
  "q": 60, "w": 62, "e": 64, "r": 65, "t": 67, "y": 69, "u": 71,
  "i": 72, "o": 74, "p": 76
};
let pressedKeys = {};

// Pool para ratón/táctil aleatorio
const randomNotesPool = [36,38,40,43,45,48,50,52,55,57,60,62,64,67,69,71,72,74,76,79];
let mouseActiveNote = null;

// ---------------------
// PRELOAD: carga JSON + audios
// ---------------------
function preload() {
  soundBankJSON = loadJSON("soundbank.json");
  // No cargamos aquí los audios porque primero necesitamos el JSON.
  // Pero p5 preload NO permite async fácil con JSON→audios,
  // así que lo resolvemos en setup con "loading screen" y callbacks.
}

// ---------------------
// Helpers
// ---------------------
function setStatus(msg) {
  const el = document.getElementById("status");
  if (el) el.textContent = msg;
}

function fadeOutAndStop(snd, seconds = 0.08) {
  if (!snd) return;
  try {
    snd.setVolume(0, seconds);
    setTimeout(() => {
      try { snd.stop(); } catch(e) {}
    }, Math.max(10, seconds * 1000 + 40));
  } catch(e) {
    try { snd.stop(); } catch(e2) {}
  }
}

function pickGroupForNote(note) {
  const isRight = note >= rightHandSplit;

  // Si existe shimmer/glass/atmos
  if (isRight) {
    // derecha: brillo y cristal
    return (random() < 0.65 && soundGroups.shimmer) ? "shimmer" : "glass";
  } else {
    // izquierda: base atmos y glass
    return (random() < 0.7 && soundGroups.atmos) ? "atmos" : "glass";
  }
}

function getAvailableVoice(groupName) {
  const files = soundGroups[groupName];
  if (!files || files.length === 0) return null;

  // Elegimos un archivo dentro del grupo
  const fileObj = random(files);
  if (!fileObj || !fileObj.voices || fileObj.voices.length === 0) return null;

  // Buscamos una voz libre (que no esté sonando)
  for (let v of fileObj.voices) {
    if (!v.isPlaying()) return v;
  }

  // Si todas están ocupadas: reciclamos una (paramos y devolvemos)
  const v = random(fileObj.voices);
  if (v && v.isPlaying()) v.stop();
  return v || null;
}

function loadAllSoundsFromJSON(onDone) {
  if (!soundBankJSON) {
    setStatus("❌ soundbank.json not found in root.");
    return;
  }

  const groups = Object.keys(soundBankJSON);
  let totalToLoad = 0;
  let loaded = 0;

  // Conteo total
  for (let g of groups) {
    totalToLoad += (soundBankJSON[g]?.length || 0) * VOICES_PER_FILE;
  }
  if (totalToLoad === 0) {
    setStatus("❌ soundbank.json is empty.");
    return;
  }

  setStatus(`⏳ Loading sounds... 0 / ${totalToLoad}`);

  // Estructura
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
              onDone?.();
            }
          },
          (err) => {
            loaded++;
            console.warn("Error loading", file, err);
            setStatus(`⚠️ Missing/blocked audio: ${file} (${loaded}/${totalToLoad})`);
            if (loaded >= totalToLoad) {
              setStatus("✅ Loading finished (with warnings). Press START.");
              onDone?.();
            }
          }
        );

        // Ajustes recomendados
        snd.playMode("sustain"); // permite que se mantenga hasta stop()
        snd.setVolume(0);

        fileEntry.voices.push(snd);
      }
    }
  }
}

// ---------------------
// SETUP
// ---------------------
function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL);
  colorMode(HSB, 360, 100, 100, 1);
  noStroke();

  // Carga de audios (con progreso)
  loadAllSoundsFromJSON(() => {});

  // Start button
  const btn = document.getElementById("startBtn");
  btn.addEventListener("click", async () => {
    await userStartAudio();
    audioReady = true;
    started = true;

    setupMIDI();

    document.getElementById("overlay").style.display = "none";
    setStatus("✅ Ready: MIDI + Keyboard + Mouse + Touch (multitouch).");
  });
}

// ---------------------
// MIDI
// ---------------------
function setupMIDI() {
  if (!navigator.requestMIDIAccess) {
    setStatus("⚠️ WebMIDI not supported. Keyboard/Mouse/Touch ok.");
    return;
  }
  navigator.requestMIDIAccess().then(
    (midi) => {
      midiAccess = midi;
      const inputs = Array.from(midiAccess.inputs.values());
      inputs.forEach((input) => (input.onmidimessage = handleMIDI));
      midiReady = true;
      setStatus("✅ MIDI connected. Play.");
    },
    () => setStatus("⚠️ MIDI failed. Keyboard/Mouse/Touch ok.")
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

// ---------------------
// Keyboard
// ---------------------
function keyPressed() {
  if (!audioReady) return;

  const k = key.toLowerCase();
  if (!(k in keyboardMap)) return;
  if (pressedKeys[k]) return;

  pressedKeys[k] = true;
  const note = keyboardMap[k];
  const vel = 95;
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

// ---------------------
// Mouse
// ---------------------
function mousePressed() {
  if (!audioReady || !started) return;
  if (mouseActiveNote !== null) return;

  const note = random(randomNotesPool);
  const vel = floor(random(70, 120));
  mouseActiveNote = note;
  onNoteOn(note, vel);
}

function mouseReleased() {
  if (!audioReady || !started) return;
  if (mouseActiveNote === null) return;

  onNoteOff(mouseActiveNote);
  mouseActiveNote = null;
}

// ---------------------
// Touch (multitouch real)
// ---------------------
function touchStarted() {
  if (!audioReady || !started) return false;

  // Activamos un note por cada touch nuevo
  for (let t of touches) {
    const id = t.id ?? `${t.x}_${t.y}`; // fallback
    if (touchIdToNote[id] != null) continue;

    const note = random(randomNotesPool);
    const vel = floor(random(70, 120));
    touchIdToNote[id] = note;
    onNoteOn(note, vel);
  }
  return false;
}

function touchEnded() {
  if (!audioReady || !started) return false;

  // Cuando se levantan dedos, liberamos notas que ya no están en touches
  const stillIds = new Set(touches.map(t => (t.id ?? `${t.x}_${t.y}`)));

  for (let id in touchIdToNote) {
    if (!stillIds.has(id)) {
      onNoteOff(touchIdToNote[id]);
      delete touchIdToNote[id];
    }
  }
  return false;
}

// ---------------------
// NOTE ON/OFF
// ---------------------
function onNoteOn(note, vel) {
  // Si ya sonaba esa nota, la paramos y reiniciamos
  if (noteToVoice[note]?.sound) {
    fadeOutAndStop(noteToVoice[note].sound, 0.03);
    delete noteToVoice[note];
  }

  globalEnergy = constrain(globalEnergy + vel / 127, 0, 4);

  // elegir grupo
  let group = pickGroupForNote(note);
  if (!soundGroups[group] || soundGroups[group].length === 0) {
    // fallback
    group = soundGroups.glass ? "glass" : Object.keys(soundGroups)[0];
  }

  const voice = getAvailableVoice(group);
  if (!voice) return;

  // volumen/rate
  const amp = map(vel, 1, 127, 0.06, 0.22);
  const rate = constrain(map(note, 36, 96, 0.6, 1.55), 0.45, 1.8);

  voice.rate(rate);
  voice.setVolume(amp, 0.02);

  // Sustain hasta soltar:
  voice.play();

  noteToVoice[note] = { sound: voice, group };

  const shapeType = note >= rightHandSplit ? "crystal" : "foundation";
  structures.push(new Structure(note, vel, shapeType));
}

function onNoteOff(note) {
  globalEnergy *= 0.88;

  const entry = noteToVoice[note];
  if (entry?.sound) {
    // fade out + stop
    fadeOutAndStop(entry.sound, 0.08);
  }
  delete noteToVoice[note];
}

// ---------------------
// VISUALS
// ---------------------
class Structure {
  constructor(note, vel, type) {
    this.note = note;
    this.vel = vel;
    this.type = type;

    this.birth = millis();
    this.life = map(vel, 0, 127, 1100, 3400);

    this.size = map(vel, 0, 127, 18, 120);

    this.pos = createVector(
      random(-340, 340),
      random(-240, 240),
      random(-360, 360)
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

    // drift “constructivo”
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

// ---------------------
// DRAW LOOP
// ---------------------
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
  text("🎹 MIDI / Keyboard / Mouse / Touch (multitouch)", 14, 14);
  text("Keyboard: A S D F G H J K / Q W E R T Y U I O P", 14, 32);
  text("Mouse: click-hold → sound | release → stop", 14, 50);
  text("Touch: press → sound | lift finger → stop", 14, 68);
  pop();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}


