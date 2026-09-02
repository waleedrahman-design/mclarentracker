// McLaren Formula 1 Trackside Operations Console (go/formula1)
// Architect: Waleed Rahman (EFS / Implementation Engineering)

// 1. Driver State & Telemetry Profiles
const telemetryState = {
  norris: {
    name: "Lando Norris",
    code: "NOR",
    num: "4",
    pos: "P1",
    speed: 324,
    gear: 7,
    rpm: 11980,
    delta: "-0.184s",
    throttle: 96,
    brake: 0,
    ers: 78,
    s1: "27.124",
    s2: "26.892",
    s3: "27.416",
    tires: { fl: 102.4, fr: 104.1, rl: 98.6, rr: 99.2, wearFL: 88, wearFR: 86, wearRL: 91, wearRR: 89 },
    trackProgress: 0.12
  },
  piastri: {
    name: "Oscar Piastri",
    code: "PIA",
    num: "81",
    pos: "P2",
    speed: 319,
    gear: 7,
    rpm: 11820,
    delta: "+0.157s",
    throttle: 92,
    brake: 0,
    ers: 83,
    s1: "27.210",
    s2: "26.945",
    s3: "27.434",
    tires: { fl: 101.8, fr: 103.5, rl: 97.9, rr: 98.4, wearFL: 89, wearFR: 87, wearRL: 92, wearRR: 90 },
    trackProgress: 0.08
  }
};

let activeDriver = 'norris';
let audioMuted = false;

// 2. Audio Comms Engine (Web Audio API Synthesizer)
let audioCtx = null;

function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}

function playPitRadioTone() {
  if (audioMuted) return;
  try {
    initAudio();
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sine';
    const now = audioCtx.currentTime;

    osc.frequency.setValueAtTime(1950, now);
    osc.frequency.setValueAtTime(2400, now + 0.04);
    osc.frequency.setValueAtTime(1750, now + 0.08);

    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start(now);
    osc.stop(now + 0.16);
  } catch (e) {
    console.log("Audio not enabled yet:", e);
  }
}

// 3. Shift Lights Array Generator
const rpmLedBar = document.getElementById('rpmLedBar');
const TOTAL_LEDS = 18;
if (rpmLedBar) {
  rpmLedBar.innerHTML = '';
  for (let i = 0; i < TOTAL_LEDS; i++) {
    const led = document.createElement('div');
    led.classList.add('rpm-led');
    if (i < 6) led.classList.add('green');
    else if (i < 12) led.classList.add('yellow');
    else if (i < 16) led.classList.add('red');
    else led.classList.add('blue');
    rpmLedBar.appendChild(led);
  }
}

// 4. DOM Elements
const teleSpeed = document.getElementById('teleSpeed');
const teleGear = document.getElementById('teleGear');
const teleRpm = document.getElementById('teleRpm');
const teleDelta = document.getElementById('teleDelta');
const valThrottle = document.getElementById('valThrottle');
const fillThrottle = document.getElementById('fillThrottle');
const valBrake = document.getElementById('valBrake');
const fillBrake = document.getElementById('fillBrake');
const valErs = document.getElementById('valErs');
const fillErs = document.getElementById('fillErs');

const tempFL = document.getElementById('tempFL');
const tempFR = document.getElementById('tempFR');
const tempRL = document.getElementById('tempRL');
const tempRR = document.getElementById('tempRR');

const valS1 = document.getElementById('valS1');
const valS2 = document.getElementById('valS2');
const valS3 = document.getElementById('valS3');
const drsState = document.getElementById('drsState');
const latencyDisplay = document.getElementById('latencyDisplay');

// Driver Buttons & Rows
const btnLando = document.getElementById('btnLando');
const btnOscar = document.getElementById('btnOscar');
const rowNorris = document.getElementById('rowNorris');
const rowPiastri = document.getElementById('rowPiastri');

function setDriver(driverKey) {
  activeDriver = driverKey;
  if (driverKey === 'norris') {
    if (btnLando) btnLando.classList.add('active');
    if (btnOscar) btnOscar.classList.remove('active');
    if (rowNorris) rowNorris.classList.add('active');
    if (rowPiastri) rowPiastri.classList.remove('active');
  } else {
    if (btnOscar) btnOscar.classList.add('active');
    if (btnLando) btnLando.classList.remove('active');
    if (rowPiastri) rowPiastri.classList.add('active');
    if (rowNorris) rowNorris.classList.remove('active');
  }
  playPitRadioTone();
}

if (btnLando) btnLando.addEventListener('click', () => setDriver('norris'));
if (btnOscar) btnOscar.addEventListener('click', () => setDriver('piastri'));
if (rowNorris) rowNorris.addEventListener('click', () => setDriver('norris'));
if (rowPiastri) rowPiastri.addEventListener('click', () => setDriver('piastri'));

// Radio Comms
const btnPlayRadio = document.getElementById('btnPlayRadio');
const radioLog = document.getElementById('radioLog');
const radioMuteBtn = document.getElementById('radioMuteBtn');
const radioDot = document.getElementById('radioDot');
const radioLabel = document.getElementById('radioLabel');

if (radioMuteBtn) {
  radioMuteBtn.addEventListener('click', () => {
    audioMuted = !audioMuted;
    if (audioMuted) {
      if (radioDot) radioDot.classList.remove('green');
      if (radioLabel) radioLabel.textContent = 'COMMS: MUTED';
    } else {
      if (radioDot) radioDot.classList.add('green');
      if (radioLabel) radioLabel.textContent = 'COMMS: ACTIVE';
      playPitRadioTone();
    }
  });
}

const commsFeed = [
  { ch: "WILL JOSEPH (RACE ENG) > LANDO", t: "LAP 16", msg: "Lando, radio check. DRS available out of Ascari. Strat 7 when ready." },
  { ch: "TOM STALLARD > OSCAR", t: "LAP 16", msg: "Oscar, pace in sector 2 is +0.2s to leader. Tyre temps optimal. Maintain delta." },
  { ch: "LANDO NORRIS > PIT WALL", t: "LAP 17", msg: "Understood Will. Balance feels sharp. Front axle biting well on entry." },
  { ch: "ANDREA STELLA (TEAM PRINCIPAL)", t: "LAP 18", msg: "Both cars executing Plan A. Strategy simulations indicate 95% victory window." }
];

let commIndex = 0;
if (btnPlayRadio) {
  btnPlayRadio.addEventListener('click', () => {
    playPitRadioTone();
    const c = commsFeed[commIndex % commsFeed.length];
    commIndex++;

    const row = document.createElement('div');
    row.className = 'radio-entry engineer-entry font-mono';
    row.innerHTML = `
      <div class="re-header">
        <span class="re-ch">${c.ch}</span>
        <span class="re-t">${c.t}</span>
      </div>
      <div class="re-msg">"${c.msg}"</div>
    `;

    if (radioLog) {
      radioLog.insertBefore(row, radioLog.firstChild);
      while (radioLog.children.length > 5) {
        radioLog.removeChild(radioLog.lastChild);
      }
    }
  });
}

// 5. Rolling Waveform Canvas (ATLAS Multi-Channel Telemetry)
const teleCanvas = document.getElementById('telemetryCanvas');
let teleCtx = null;
if (teleCanvas) teleCtx = teleCanvas.getContext('2d');

const HISTORY_LEN = 120;
const speedHistory = new Array(HISTORY_LEN).fill(320);
const throttleHistory = new Array(HISTORY_LEN).fill(95);
const brakeHistory = new Array(HISTORY_LEN).fill(0);

function renderWaveform() {
  if (!teleCtx || !teleCanvas) return;
  const w = teleCanvas.width;
  const h = teleCanvas.height;

  teleCtx.clearRect(0, 0, w, h);

  // Subtle Grid Lines
  teleCtx.strokeStyle = '#161A24';
  teleCtx.lineWidth = 1;
  for (let y = 25; y < h; y += 30) {
    teleCtx.beginPath();
    teleCtx.moveTo(0, y);
    teleCtx.lineTo(w, y);
    teleCtx.stroke();
  }

  // Speed Trace (Papaya)
  teleCtx.strokeStyle = '#FF8000';
  teleCtx.lineWidth = 1.8;
  teleCtx.beginPath();
  for (let i = 0; i < HISTORY_LEN; i++) {
    const x = (i / (HISTORY_LEN - 1)) * w;
    const y = h - ((speedHistory[i] / 350) * (h - 20) + 10);
    if (i === 0) teleCtx.moveTo(x, y);
    else teleCtx.lineTo(x, y);
  }
  teleCtx.stroke();

  // Throttle (Green)
  teleCtx.strokeStyle = '#10B981';
  teleCtx.lineWidth = 1.2;
  teleCtx.beginPath();
  for (let i = 0; i < HISTORY_LEN; i++) {
    const x = (i / (HISTORY_LEN - 1)) * w;
    const y = h - ((throttleHistory[i] / 100) * (h * 0.4) + 10);
    if (i === 0) teleCtx.moveTo(x, y);
    else teleCtx.lineTo(x, y);
  }
  teleCtx.stroke();

  // Brake (Red)
  teleCtx.strokeStyle = '#EA4335';
  teleCtx.lineWidth = 1.5;
  teleCtx.beginPath();
  for (let i = 0; i < HISTORY_LEN; i++) {
    const x = (i / (HISTORY_LEN - 1)) * w;
    const y = h - ((brakeHistory[i] / 100) * (h * 0.4) + 10);
    if (i === 0) teleCtx.moveTo(x, y);
    else teleCtx.lineTo(x, y);
  }
  teleCtx.stroke();
}

// 6. Monza GPS Circuit Canvas
const circuitCanvas = document.getElementById('circuitCanvas');
let cCtx = null;
if (circuitCanvas) cCtx = circuitCanvas.getContext('2d');

const monzaCoords = [
  { x: 50, y: 50 },
  { x: 620, y: 50 },  // Main Straight
  { x: 650, y: 75 },  // Rettifilo
  { x: 670, y: 115 }, // Curva Grande
  { x: 630, y: 145 }, // Roggia
  { x: 560, y: 160 }, // Lesmo 1
  { x: 480, y: 165 }, // Lesmo 2
  { x: 340, y: 140 }, // Serraglio
  { x: 220, y: 125 }, // Ascari Entry
  { x: 160, y: 105 }, // Ascari Exit
  { x: 90, y: 80 },   // Parabolica Entry
  { x: 50, y: 50 }    // Finish
];

function getTrackPoint(progress) {
  const segments = monzaCoords.length - 1;
  const scaled = (progress % 1) * segments;
  const idx = Math.floor(scaled);
  const frac = scaled - idx;

  const p1 = monzaCoords[idx];
  const p2 = monzaCoords[idx + 1] || monzaCoords[0];

  return {
    x: p1.x + (p2.x - p1.x) * frac,
    y: p1.y + (p2.y - p1.y) * frac
  };
}

function renderCircuit() {
  if (!cCtx || !circuitCanvas) return;
  const w = circuitCanvas.width;
  const h = circuitCanvas.height;

  cCtx.clearRect(0, 0, w, h);

  // Road Base
  cCtx.strokeStyle = '#1A1F2C';
  cCtx.lineWidth = 10;
  cCtx.lineCap = 'round';
  cCtx.lineJoin = 'round';
  cCtx.beginPath();
  monzaCoords.forEach((pt, i) => {
    if (i === 0) cCtx.moveTo(pt.x, pt.y);
    else cCtx.lineTo(pt.x, pt.y);
  });
  cCtx.closePath();
  cCtx.stroke();

  // Racing Centerline
  cCtx.strokeStyle = '#273147';
  cCtx.lineWidth = 2;
  cCtx.stroke();

  // DRS Zone Main Straight
  cCtx.strokeStyle = '#10B981';
  cCtx.lineWidth = 3;
  cCtx.beginPath();
  cCtx.moveTo(80, 50);
  cCtx.lineTo(580, 50);
  cCtx.stroke();

  // Finish Line
  cCtx.strokeStyle = '#FFFFFF';
  cCtx.lineWidth = 3;
  cCtx.beginPath();
  cCtx.moveTo(50, 42);
  cCtx.lineTo(50, 58);
  cCtx.stroke();

  // Car Markers
  const lando = getTrackPoint(telemetryState.norris.trackProgress);
  const oscar = getTrackPoint(telemetryState.piastri.trackProgress);

  // Oscar #81
  cCtx.fillStyle = '#FCD34D';
  cCtx.beginPath();
  cCtx.arc(oscar.x, oscar.y, 6, 0, Math.PI * 2);
  cCtx.fill();
  cCtx.fillStyle = '#000000';
  cCtx.font = 'bold 7px JetBrains Mono';
  cCtx.textAlign = 'center';
  cCtx.textBaseline = 'middle';
  cCtx.fillText('81', oscar.x, oscar.y);

  // Lando #4
  cCtx.fillStyle = '#FF8000';
  cCtx.beginPath();
  cCtx.arc(lando.x, lando.y, 7, 0, Math.PI * 2);
  cCtx.fill();
  cCtx.fillStyle = '#FFFFFF';
  cCtx.font = 'bold 8px JetBrains Mono';
  cCtx.textAlign = 'center';
  cCtx.textBaseline = 'middle';
  cCtx.fillText('4', lando.x, lando.y);
}

// 7. Telemetry Engine Loop (20Hz)
let cycle = 0;
setInterval(() => {
  cycle++;
  const active = telemetryState[activeDriver];

  // Advance Cars
  telemetryState.norris.trackProgress += 0.0035;
  telemetryState.piastri.trackProgress += 0.0034;

  const isBraking = (cycle % 38) > 30;

  if (isBraking) {
    active.speed = Math.max(115, active.speed - 22);
    active.gear = active.speed > 210 ? 5 : active.speed > 150 ? 4 : 3;
    active.rpm = Math.max(7600, 8500 + Math.floor(Math.random() * 800));
    active.throttle = 0;
    active.brake = 95 - Math.floor(Math.random() * 10);
    active.ers = Math.min(95, active.ers + 0.25);
    if (drsState) {
      drsState.textContent = "DRS CLOSED";
      drsState.className = "tf-drs text-red font-mono";
    }
  } else {
    active.speed = Math.min(346, active.speed + Math.floor(Math.random() * 5) - 1);
    if (active.speed < 230) active.speed = 318;
    active.gear = active.speed > 310 ? 8 : 7;
    active.rpm = Math.min(12450, 11600 + Math.floor(Math.random() * 750));
    active.throttle = 94 + Math.floor(Math.random() * 6);
    active.brake = 0;
    active.ers = Math.max(48, active.ers - 0.2);
    if (drsState) {
      drsState.textContent = "DRS AVAILABLE";
      drsState.className = "tf-drs text-green font-mono";
    }
  }

  // History shift
  speedHistory.push(active.speed);
  speedHistory.shift();
  throttleHistory.push(active.throttle);
  throttleHistory.shift();
  brakeHistory.push(active.brake);
  brakeHistory.shift();

  // Tyre Thermal Oscillations
  active.tires.fl = Math.round((102.4 + Math.sin(cycle * 0.15) * 2.1) * 10) / 10;
  active.tires.fr = Math.round((104.1 + Math.cos(cycle * 0.15) * 2.3) * 10) / 10;
  active.tires.rl = Math.round((98.6 + Math.sin(cycle * 0.1) * 1.5) * 10) / 10;
  active.tires.rr = Math.round((99.2 + Math.cos(cycle * 0.1) * 1.7) * 10) / 10;

  // DOM Updates
  if (teleSpeed) teleSpeed.textContent = active.speed;
  if (teleGear) teleGear.textContent = active.gear;
  if (teleRpm) teleRpm.textContent = Number(active.rpm).toLocaleString();
  if (teleDelta) teleDelta.textContent = active.delta;

  if (valThrottle) valThrottle.textContent = `${active.throttle}%`;
  if (fillThrottle) fillThrottle.style.width = `${active.throttle}%`;

  if (valBrake) valBrake.textContent = `${active.brake}%`;
  if (fillBrake) fillBrake.style.width = `${active.brake}%`;

  if (valErs) valErs.textContent = `${Math.round(active.ers)}%`;
  if (fillErs) fillErs.style.width = `${active.ers}%`;

  if (tempFL) tempFL.textContent = `${active.tires.fl}°C`;
  if (tempFR) tempFR.textContent = `${active.tires.fr}°C`;
  if (tempRL) tempRL.textContent = `${active.tires.rl}°C`;
  if (tempRR) tempRR.textContent = `${active.tires.rr}°C`;

  // Shift LEDs
  if (rpmLedBar) {
    const pct = (active.rpm - 7500) / (12500 - 7500);
    const activeLeds = Math.floor(pct * TOTAL_LEDS);
    const leds = rpmLedBar.children;
    for (let i = 0; i < leds.length; i++) {
      if (i <= activeLeds) leds[i].classList.add('active');
      else leds[i].classList.remove('active');
    }
  }

  // Edge Ping Jitter
  if (latencyDisplay) {
    const lat = (0.72 + Math.random() * 0.08).toFixed(2);
    latencyDisplay.textContent = `EDGE ${lat}ms`;
  }

  renderWaveform();
  renderCircuit();
}, 200);

// 8. Session Countdown Clock
function initCountdown() {
  const target = new Date();
  target.setDate(target.getDate() + 2);
  target.setHours(13, 30, 0, 0);

  function tick() {
    const diff = target - new Date();
    if (diff <= 0) return;
    const d = Math.floor(diff / (1000 * 60 * 60 * 24));
    const h = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const m = Math.floor((diff / (1000 * 60)) % 60);
    const s = Math.floor((diff / 1000) % 60);

    const pad = (n) => String(n).padStart(2, '0');
    const elem = document.getElementById('headerCountdown');
    if (elem) elem.textContent = `${pad(d)}D ${pad(h)}H ${pad(m)}M ${pad(s)}S`;
  }

  tick();
  setInterval(tick, 1000);
}
initCountdown();

// 9. Copy go/formula1
const goLinkChip = document.getElementById('goLinkChip');
if (goLinkChip) {
  goLinkChip.addEventListener('click', () => {
    navigator.clipboard.writeText('http://go/formula1').then(() => {
      const orig = goLinkChip.innerHTML;
      goLinkChip.innerHTML = '<code>COPIED</code>';
      playPitRadioTone();
      setTimeout(() => {
        goLinkChip.innerHTML = orig;
      }, 1400);
    });
  });
}
