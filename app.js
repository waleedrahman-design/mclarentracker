// McLaren Formula 1 Pit Wall Console (go/formula1)
// Architect: Waleed Rahman (EFS / Implementation Engineering)

// 1. Navigation & Page Routing System
const pageTitles = {
  'page-telemetry': '01. LIVE TELEMETRY & TIMING',
  'page-compare': '02. HEAD-TO-HEAD COMPARATOR',
  'page-strategy': '03. STRATEGY & PIT WALL RADIO',
  'page-broadcast': '04. WHERE TO WATCH & BROADCAST',
  'page-standings': '05. WORLD CHAMPIONSHIP STANDINGS',
  'page-archive': '06. HISTORICAL ARCHIVE (2024-2025)'
};

const burgerBtn = document.getElementById('burgerBtn');
const burgerDrawer = document.getElementById('burgerDrawer');
const burgerBackdrop = document.getElementById('burgerBackdrop');
const drawerCloseBtn = document.getElementById('drawerCloseBtn');
const activePageTitle = document.getElementById('activePageTitle');

function openDrawer() {
  if (burgerDrawer) burgerDrawer.classList.add('open');
  if (burgerBackdrop) burgerBackdrop.classList.add('open');
}

function closeDrawer() {
  if (burgerDrawer) burgerDrawer.classList.remove('open');
  if (burgerBackdrop) burgerBackdrop.classList.remove('open');
}

if (burgerBtn) burgerBtn.addEventListener('click', openDrawer);
if (drawerCloseBtn) drawerCloseBtn.addEventListener('click', closeDrawer);
if (burgerBackdrop) burgerBackdrop.addEventListener('click', closeDrawer);

function navigateToPage(targetId) {
  const allPages = document.querySelectorAll('.page-view');
  allPages.forEach(p => p.classList.remove('active'));

  const targetPage = document.getElementById(targetId);
  if (targetPage) {
    targetPage.classList.add('active');
  }

  // Update Drawer links
  const drawerLinks = document.querySelectorAll('.drawer-link');
  drawerLinks.forEach(dl => {
    if (dl.getAttribute('data-target') === targetId) {
      dl.classList.add('active');
    } else {
      dl.classList.remove('active');
    }
  });

  // Update Quick Nav items
  const qnItems = document.querySelectorAll('.qn-item');
  qnItems.forEach(qn => {
    if (qn.getAttribute('data-target') === targetId) {
      qn.classList.add('active');
    } else {
      qn.classList.remove('active');
    }
  });

  // Update Title
  if (activePageTitle && pageTitles[targetId]) {
    activePageTitle.textContent = pageTitles[targetId];
  }

  // Update Hash
  const hash = targetId.replace('page-', '');
  if (window.location.hash !== `#${hash}`) {
    window.location.hash = hash;
  }

  closeDrawer();
  playPitRadioTone();
}

// Bind Navigation Clicks
document.querySelectorAll('.drawer-link, .qn-item').forEach(el => {
  el.addEventListener('click', () => {
    const target = el.getAttribute('data-target');
    if (target) navigateToPage(target);
  });
});

// Handle URL Hash on load / change
function handleHash() {
  const hash = window.location.hash.replace('#', '');
  const candidate = `page-${hash}`;
  if (pageTitles[candidate]) {
    navigateToPage(candidate);
  } else {
    navigateToPage('page-telemetry');
  }
}
window.addEventListener('hashchange', handleHash);

// 2. Audio Engine (Web Audio API Synthesizer)
let audioCtx = null;
let audioMuted = false;

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

    gain.gain.setValueAtTime(0.04, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start(now);
    osc.stop(now + 0.15);
  } catch (e) {
    console.log("Audio not enabled yet:", e);
  }
}

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
      if (radioLabel) radioLabel.textContent = 'COMMS: ON';
      playPitRadioTone();
    }
  });
}

// 3. Driver State & Telemetry Profiles
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
    tires: { fl: 102.4, fr: 104.1, rl: 98.6, rr: 99.2 },
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
    tires: { fl: 101.8, fr: 103.5, rl: 97.9, rr: 98.4 },
    trackProgress: 0.08
  }
};

let activeDriver = 'norris';

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

  // Sync comparator buttons
  document.querySelectorAll('.comp-mcl-btn').forEach(b => {
    if (b.getAttribute('data-mcl') === driverKey) b.classList.add('active');
    else b.classList.remove('active');
  });

  playPitRadioTone();
  updateHeadToHeadComparator();
}

if (btnLando) btnLando.addEventListener('click', () => setDriver('norris'));
if (btnOscar) btnOscar.addEventListener('click', () => setDriver('piastri'));
if (rowNorris) rowNorris.addEventListener('click', () => setDriver('norris'));
if (rowPiastri) rowPiastri.addEventListener('click', () => setDriver('piastri'));

// Comparator McLaren buttons
document.querySelectorAll('.comp-mcl-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const d = btn.getAttribute('data-mcl');
    if (d) setDriver(d);
  });
});

// 4. Head-to-Head Comparator Engine
const rivalData = {
  verstappen: {
    name: "MAX VERSTAPPEN #1",
    team: "RED BULL RACING",
    lap: "1:21.720",
    lapSec: 81.720,
    s1: "27.198",
    s2: "27.042",
    s3: "27.480",
    speed: 343.2,
    apex: 139.6,
    tire: "HARD (19L)"
  },
  leclerc: {
    name: "CHARLES LECLERC #16",
    team: "SCUDERIA FERRARI",
    lap: "1:21.854",
    lapSec: 81.854,
    s1: "27.240",
    s2: "27.088",
    s3: "27.526",
    speed: 345.6,
    apex: 138.9,
    tire: "HARD (18L)"
  },
  hamilton: {
    name: "LEWIS HAMILTON #44",
    team: "SCUDERIA FERRARI",
    lap: "1:22.012",
    lapSec: 82.012,
    s1: "27.312",
    s2: "27.140",
    s3: "27.560",
    speed: 341.0,
    apex: 140.2,
    tire: "MEDIUM (12L)"
  },
  russell: {
    name: "GEORGE RUSSELL #63",
    team: "MERCEDES-AMG",
    lap: "1:22.180",
    lapSec: 82.180,
    s1: "27.345",
    s2: "27.195",
    s3: "27.640",
    speed: 340.4,
    apex: 139.8,
    tire: "MEDIUM (15L)"
  },
  sainz: {
    name: "CARLOS SAINZ #55",
    team: "WILLIAMS RACING",
    lap: "1:22.460",
    lapSec: 82.460,
    s1: "27.410",
    s2: "27.320",
    s3: "27.730",
    speed: 339.8,
    apex: 138.2,
    tire: "HARD (21L)"
  },
  alonso: {
    name: "FERNANDO ALONSO #14",
    team: "ASTON MARTIN",
    lap: "1:22.610",
    lapSec: 82.610,
    s1: "27.480",
    s2: "27.380",
    s3: "27.750",
    speed: 338.5,
    apex: 137.9,
    tire: "HARD (22L)"
  }
};

let activeRivalKey = 'verstappen';

function updateHeadToHeadComparator() {
  const mcl = telemetryState[activeDriver];
  const riv = rivalData[activeRivalKey];
  if (!mcl || !riv) return;

  const mclLapSec = activeDriver === 'norris' ? 81.432 : 81.589;
  const delta = (mclLapSec - riv.lapSec).toFixed(3);

  const compDriver1Name = document.getElementById('compDriver1Name');
  const compLap1 = document.getElementById('compLap1');
  const compTire1 = document.getElementById('compTire1');
  const compS1_1 = document.getElementById('compS1_1');
  const compS2_1 = document.getElementById('compS2_1');
  const compS3_1 = document.getElementById('compS3_1');

  const compDriver2Name = document.getElementById('compDriver2Name');
  const compTeam2 = document.getElementById('compTeam2');
  const compLap2 = document.getElementById('compLap2');
  const compTire2 = document.getElementById('compTire2');
  const compS2_1_val = document.getElementById('compS2_1_val');
  const compS2_2_val = document.getElementById('compS2_2_val');
  const compS2_3_val = document.getElementById('compS2_3_val');

  const compNetDelta = document.getElementById('compNetDelta');
  const compSpeed1 = document.getElementById('compSpeed1');
  const compSpeed2 = document.getElementById('compSpeed2');
  const compSpeedDiff = document.getElementById('compSpeedDiff');
  const compApex1 = document.getElementById('compApex1');
  const compApex2 = document.getElementById('compApex2');
  const compApexDiff = document.getElementById('compApexDiff');
  const compBarFill = document.getElementById('compBarFill');

  if (compDriver1Name) compDriver1Name.textContent = `${mcl.name.toUpperCase()} #${mcl.num}`;
  if (compLap1) compLap1.textContent = activeDriver === 'norris' ? '1:21.432' : '1:21.589';
  if (compTire1) compTire1.textContent = 'MEDIUM (14L)';
  if (compS1_1) compS1_1.textContent = mcl.s1;
  if (compS2_1) compS2_1.textContent = mcl.s2;
  if (compS3_1) compS3_1.textContent = mcl.s3;

  if (compDriver2Name) compDriver2Name.textContent = riv.name;
  if (compTeam2) compTeam2.textContent = riv.team;
  if (compLap2) compLap2.textContent = riv.lap;
  if (compTire2) compTire2.textContent = riv.tire;
  if (compS2_1_val) compS2_1_val.textContent = riv.s1;
  if (compS2_2_val) compS2_2_val.textContent = riv.s2;
  if (compS2_3_val) compS2_3_val.textContent = riv.s3;

  if (compNetDelta) {
    compNetDelta.textContent = `${delta}s`;
    compNetDelta.className = delta < 0 ? 'text-green' : 'text-red';
  }

  const mclSpeed = activeDriver === 'norris' ? 344.8 : 342.1;
  const mclApex = activeDriver === 'norris' ? 142.4 : 141.8;
  const speedDiff = (mclSpeed - riv.speed).toFixed(1);
  const apexDiff = (mclApex - riv.apex).toFixed(1);

  if (compSpeed1) compSpeed1.textContent = mclSpeed.toFixed(1);
  if (compSpeed2) compSpeed2.textContent = riv.speed.toFixed(1);
  if (compSpeedDiff) {
    compSpeedDiff.textContent = `${speedDiff > 0 ? '+' : ''}${speedDiff} KM/H`;
    compSpeedDiff.className = speedDiff >= 0 ? 'cdm-diff text-green' : 'cdm-diff text-red';
  }

  if (compApex1) compApex1.textContent = mclApex.toFixed(1);
  if (compApex2) compApex2.textContent = riv.apex.toFixed(1);
  if (compApexDiff) {
    compApexDiff.textContent = `${apexDiff > 0 ? '+' : ''}${apexDiff} KM/H`;
    compApexDiff.className = apexDiff >= 0 ? 'cdm-diff text-green' : 'cdm-diff text-red';
  }

  if (compBarFill) {
    const ratio = Math.max(30, Math.min(75, 50 - (parseFloat(delta) * 35)));
    compBarFill.style.width = `${ratio}%`;
  }
}

// Attach Rival buttons & timing tower row listeners
function selectRival(key) {
  activeRivalKey = key;
  document.querySelectorAll('.comp-riv-btn').forEach(b => {
    if (b.getAttribute('data-rival') === key) b.classList.add('active');
    else b.classList.remove('active');
  });
  document.querySelectorAll('.rival-row').forEach(r => {
    if (r.getAttribute('data-rival') === key) r.classList.add('active-rival');
    else r.classList.remove('active-rival');
  });
  playPitRadioTone();
  updateHeadToHeadComparator();
}

document.querySelectorAll('.comp-riv-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const r = btn.getAttribute('data-rival');
    if (r) selectRival(r);
  });
});

document.querySelectorAll('.rival-row').forEach(row => {
  row.addEventListener('click', () => {
    const r = row.getAttribute('data-rival');
    if (r) {
      selectRival(r);
      navigateToPage('page-compare');
    }
  });
});

// 5. Shift Lights Array Generator
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

// 6. Rolling Waveform Canvas (ATLAS)
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

  teleCtx.strokeStyle = '#161A24';
  teleCtx.lineWidth = 1;
  for (let y = 25; y < h; y += 30) {
    teleCtx.beginPath();
    teleCtx.moveTo(0, y);
    teleCtx.lineTo(w, y);
    teleCtx.stroke();
  }

  // Speed
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

  // Throttle
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

  // Brake
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

// 7. Monza GPS Circuit Canvas
const circuitCanvas = document.getElementById('circuitCanvas');
let cCtx = null;
if (circuitCanvas) cCtx = circuitCanvas.getContext('2d');

const monzaCoords = [
  { x: 50, y: 50 },
  { x: 650, y: 50 },  // Main Straight
  { x: 680, y: 75 },  // Rettifilo
  { x: 700, y: 110 }, // Curva Grande
  { x: 650, y: 140 }, // Roggia
  { x: 580, y: 155 }, // Lesmo 1
  { x: 500, y: 160 }, // Lesmo 2
  { x: 360, y: 135 }, // Serraglio
  { x: 230, y: 120 }, // Ascari Entry
  { x: 170, y: 100 }, // Ascari Exit
  { x: 95, y: 75 },   // Parabolica Entry
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

  // Base asphalt
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

  // Centerline
  cCtx.strokeStyle = '#273147';
  cCtx.lineWidth = 2;
  cCtx.stroke();

  // DRS Zone
  cCtx.strokeStyle = '#10B981';
  cCtx.lineWidth = 3;
  cCtx.beginPath();
  cCtx.moveTo(80, 50);
  cCtx.lineTo(600, 50);
  cCtx.stroke();

  // Finish Line
  cCtx.strokeStyle = '#FFFFFF';
  cCtx.lineWidth = 3;
  cCtx.beginPath();
  cCtx.moveTo(50, 42);
  cCtx.lineTo(50, 58);
  cCtx.stroke();

  // Cars
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

// 8. Main Telemetry Ingest Loop (20Hz)
let cycle = 0;
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
const drsState = document.getElementById('drsState');
const latencyDisplay = document.getElementById('latencyDisplay');

const tempFL = document.getElementById('tempFL');
const tempFR = document.getElementById('tempFR');
const tempRL = document.getElementById('tempRL');
const tempRR = document.getElementById('tempRR');

setInterval(() => {
  cycle++;
  const active = telemetryState[activeDriver];

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

  speedHistory.push(active.speed);
  speedHistory.shift();
  throttleHistory.push(active.throttle);
  throttleHistory.shift();
  brakeHistory.push(active.brake);
  brakeHistory.shift();

  active.tires.fl = Math.round((102.4 + Math.sin(cycle * 0.15) * 2.1) * 10) / 10;
  active.tires.fr = Math.round((104.1 + Math.cos(cycle * 0.15) * 2.3) * 10) / 10;
  active.tires.rl = Math.round((98.6 + Math.sin(cycle * 0.1) * 1.5) * 10) / 10;
  active.tires.rr = Math.round((99.2 + Math.cos(cycle * 0.1) * 1.7) * 10) / 10;

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

  if (rpmLedBar) {
    const pct = (active.rpm - 7500) / (12500 - 7500);
    const activeLeds = Math.floor(pct * TOTAL_LEDS);
    const leds = rpmLedBar.children;
    for (let i = 0; i < leds.length; i++) {
      if (i <= activeLeds) leds[i].classList.add('active');
      else leds[i].classList.remove('active');
    }
  }

  if (latencyDisplay) {
    const lat = (0.72 + Math.random() * 0.08).toFixed(2);
    latencyDisplay.textContent = `EDGE ${lat}ms`;
  }

  renderWaveform();
  renderCircuit();
}, 200);

// 9. Radio Transmit Intercept
const btnPlayRadio = document.getElementById('btnPlayRadio');
const radioLog = document.getElementById('radioLog');
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
      while (radioLog.children.length > 6) {
        radioLog.removeChild(radioLog.lastChild);
      }
    }
  });
}

// 10. Historical Archive Data
const archiveSessions = {
  miami2024: {
    title: "2024 MIAMI GRAND PRIX • LAP 57 (NORRIS P1)",
    speed: "341.8 KM/H",
    apex: "142.4 KM/H",
    brake: "134 BAR",
    throttle: "0.18s ADVANCE",
    chassis: "SPEC: MCL38 MIAMI UPGRADE PKG",
    debrief: "Lando Norris managed the safety car restart on Lap 33 with exceptional thermal tire retention. The revised front floor edge wing delivered +14 points of downforce through high-speed turns 4-7, eliminating the mid-corner understeer seen in previous races. Pull-rod front suspension geometry reduced pitch under braking into Turn 17, enabling 0.22s gain per lap in Sector 3 alone. Final victory margin: +7.612s over Max Verstappen."
  },
  baku2024: {
    title: "2024 AZERBAIJAN GRAND PRIX • LAP 51 (PIASTRI P1)",
    speed: "348.6 KM/H",
    apex: "118.2 KM/H",
    brake: "142 BAR",
    throttle: "0.24s BRAKING DEPTH",
    chassis: "SPEC: MCL38 BAKU LOW-DRAG PKG",
    debrief: "Oscar Piastri executed an iconic 30-lap defensive drive against Charles Leclerc at 340+ km/h without making a single lock-up. Low-drag rear wing beam design generated high top-end straight-line speed into Turn 1, neutralizing Ferrari DRS overtake attempts. Front brake temperature balance remained below 620°C throughout the critical battle window."
  },
  singapore2024: {
    title: "2024 SINGAPORE GRAND PRIX • LAP 62 (NORRIS P1)",
    speed: "306.4 KM/H",
    apex: "136.8 KM/H",
    brake: "130 BAR",
    throttle: "+0.35s TRACTION ADVANTAGE",
    chassis: "SPEC: MCL38 MAXIMUM DOWNFORCE SPEC",
    debrief: "Lando Norris delivered an undisputed masterclass at Marina Bay under the night lights, pulling an astonishing +20.945s gap to Max Verstappen. Rear tyre thermal management in Sector 3 (turns 16-19) was over 3°C cooler than the Red Bull RB20, allowing full throttle application 12 meters earlier out of slow traction zones."
  },
  monza2025: {
    title: "2025 ITALIAN GRAND PRIX • QUALIFYING (1-2 LOCKOUT)",
    speed: "354.2 KM/H",
    apex: "178.5 KM/H",
    brake: "145 BAR",
    throttle: "0.12s EARLIER EXIT",
    chassis: "SPEC: MCL39 MONZA SPECIAL SPEC",
    debrief: "Front row lockout for McLaren at the Temple of Speed. Lando Norris (1:19.327) and Oscar Piastri (1:19.412) locked out P1 and P2 with sub-1:19.5 lap times. Slipstream synergy through Curva Grande and superior aerodynamic efficiency through the Ascari chicane yielded a 0.38s margin over Ferrari and Mercedes."
  }
};

const ahTabs = document.querySelectorAll('.ah-tab');
const archSessionTitle = document.getElementById('archSessionTitle');
const archSpeed = document.getElementById('archSpeed');
const archApex = document.getElementById('archApex');
const archBrake = document.getElementById('archBrake');
const archThrottle = document.getElementById('archThrottle');
const archChassis = document.getElementById('archChassis');
const archDebriefText = document.getElementById('archDebriefText');

if (ahTabs.length > 0) {
  ahTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      ahTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      playPitRadioTone();

      const key = tab.getAttribute('data-archive');
      const data = archiveSessions[key];
      if (data) {
        if (archSessionTitle) archSessionTitle.textContent = data.title;
        if (archSpeed) archSpeed.textContent = data.speed;
        if (archApex) archApex.textContent = data.apex;
        if (archBrake) archBrake.textContent = data.brake;
        if (archThrottle) archThrottle.textContent = data.throttle;
        if (archChassis) archChassis.textContent = data.chassis;
        if (archDebriefText) archDebriefText.textContent = data.debrief;
      }
    });
  });
}

// 11. Session Countdown Clock
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

// 12. Copy go/formula1
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

// Initial comparator sync
updateHeadToHeadComparator();
handleHash();
