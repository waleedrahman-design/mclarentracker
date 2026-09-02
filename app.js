// McLaren Formula 1 x Google Cloud Trackside Telemetry Portal (go/waleed-f1)
// Architect: Waleed Rahman (EFS / Implementation Engineering)

// 1. Driver Telemetry Data
const driverState = {
  norris: {
    name: "Lando Norris",
    number: "4",
    pos: "P1",
    speed: 324,
    gear: 7,
    rpm: 11980,
    delta: "-0.184s",
    throttle: 96,
    brake: 0,
    ers: 78,
    s1: "27.124s",
    s2: "26.892s",
    s3: "27.416s",
    tires: { fl: 102.4, fr: 104.1, rl: 98.6, rr: 99.2, wearFL: 88, wearFR: 86, wearRL: 91, wearRR: 89 },
    trackProgress: 0.12
  },
  piastri: {
    name: "Oscar Piastri",
    number: "81",
    pos: "P2",
    speed: 319,
    gear: 7,
    rpm: 11820,
    delta: "+0.157s",
    throttle: 92,
    brake: 0,
    ers: 83,
    s1: "27.210s",
    s2: "26.945s",
    s3: "27.434s",
    tires: { fl: 101.8, fr: 103.5, rl: 97.9, rr: 98.4, wearFL: 89, wearFR: 87, wearRL: 92, wearRR: 90 },
    trackProgress: 0.08
  }
};

let activeDriverKey = 'norris';
let audioEnabled = true;

// 2. Audio Comms Engine (Web Audio API Synthesizer)
let audioCtx = null;

function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}

function playF1RadioChirp() {
  if (!audioEnabled) return;
  try {
    initAudio();
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sine';
    const now = audioCtx.currentTime;

    // Iconic Formula 1 pit radio dual-frequency squelch tone
    osc.frequency.setValueAtTime(1950, now);
    osc.frequency.setValueAtTime(2400, now + 0.04);
    osc.frequency.setValueAtTime(1750, now + 0.08);

    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start(now);
    osc.stop(now + 0.18);
  } catch (e) {
    console.log("Audio not allowed yet:", e);
  }
}

// 3. Shift Lights / RPM LEDs Generator
const rpmLedBar = document.getElementById('rpmLedBar');
const TOTAL_LEDS = 18;
if (rpmLedBar) {
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

// 4. DOM References
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
const edgeLatencyVal = document.getElementById('edgeLatencyVal');
const latencyDisplay = document.getElementById('latencyDisplay');

// Driver Buttons
const btnLando = document.getElementById('btnLando');
const btnOscar = document.getElementById('btnOscar');

function switchDriver(driver) {
  activeDriverKey = driver;
  if (driver === 'norris') {
    btnLando.classList.add('active');
    btnOscar.classList.remove('active');
  } else {
    btnOscar.classList.add('active');
    btnLando.classList.remove('active');
  }
  playF1RadioChirp();
}

btnLando.addEventListener('click', () => switchDriver('norris'));
btnOscar.addEventListener('click', () => switchDriver('piastri'));

// Radio Comms Button
const btnPlayRadio = document.getElementById('btnPlayRadio');
const radioLog = document.getElementById('radioLog');

const radioArchive = [
  {
    speaker: "WILL JOSEPH (RACE ENG) → LANDO",
    time: "LAP 16 • 13:44:02",
    msg: "Lando, radio check. DRS available down the main straight. Push to pass mode 8 is primed.",
    type: "mclaren-msg"
  },
  {
    speaker: "TOM STALLARD → OSCAR",
    time: "LAP 16 • 13:44:15",
    msg: "Oscar, tire delta to Verstappen is +0.4s. Great exit out of Parabolica. Maintain strat 3.",
    type: "mclaren-msg"
  },
  {
    speaker: "LANDO NORRIS → PIT WALL",
    time: "LAP 17 • 13:45:10",
    msg: "Understood Will. Front wing balance is spot on. Rear tires are in the sweet spot.",
    type: "driver-msg"
  },
  {
    speaker: "ANDREA STELLA (TEAM PRINCIPAL)",
    time: "LAP 18 • 13:46:22",
    msg: "Both cars are running P1 and P2 with clean air. Google Cloud simulations show 95% victory window.",
    type: "mclaren-msg"
  }
];

let radioIndex = 0;
function triggerRadioBroadcast() {
  playF1RadioChirp();
  const comm = radioArchive[radioIndex % radioArchive.length];
  radioIndex++;

  const entry = document.createElement('div');
  entry.className = `radio-msg ${comm.type}`;
  entry.innerHTML = `
    <div class="rm-header">
      <span class="rm-speaker">${comm.speaker}</span>
      <span class="rm-time">${comm.time}</span>
    </div>
    <p class="rm-body">"${comm.msg}"</p>
  `;

  if (radioLog) {
    radioLog.insertBefore(entry, radioLog.firstChild);
    while (radioLog.children.length > 5) {
      radioLog.removeChild(radioLog.lastChild);
    }
  }
}

if (btnPlayRadio) {
  btnPlayRadio.addEventListener('click', triggerRadioBroadcast);
}

// Comms Audio Toggle
const radioMuteBtn = document.getElementById('radioMuteBtn');
const radioIcon = document.getElementById('radioIcon');
const radioLabel = document.getElementById('radioLabel');

if (radioMuteBtn) {
  radioMuteBtn.addEventListener('click', () => {
    audioEnabled = !audioEnabled;
    if (audioEnabled) {
      radioIcon.textContent = '🔊';
      radioLabel.textContent = 'PIT COMMS: ON';
      playF1RadioChirp();
    } else {
      radioIcon.textContent = '🔇';
      radioLabel.textContent = 'PIT COMMS: MUTED';
    }
  });
}

// 5. Real-Time Rolling Waveform Canvas (ATLAS-Style Telemetry)
const teleCanvas = document.getElementById('telemetryCanvas');
let teleCtx = null;
if (teleCanvas) {
  teleCtx = teleCanvas.getContext('2d');
}

const HISTORY_LENGTH = 120;
const speedHistory = new Array(HISTORY_LENGTH).fill(315);
const throttleHistory = new Array(HISTORY_LENGTH).fill(90);
const brakeHistory = new Array(HISTORY_LENGTH).fill(0);

function drawTelemetryWaveform() {
  if (!teleCtx || !teleCanvas) return;
  const w = teleCanvas.width;
  const h = teleCanvas.height;

  teleCtx.clearRect(0, 0, w, h);

  // Background Grid Lines
  teleCtx.strokeStyle = '#1C2433';
  teleCtx.lineWidth = 1;
  for (let y = 30; y < h; y += 35) {
    teleCtx.beginPath();
    teleCtx.moveTo(0, y);
    teleCtx.lineTo(w, y);
    teleCtx.stroke();
  }

  // Draw Speed (Papaya) - Normalized 0 to 350 km/h
  teleCtx.strokeStyle = '#FF8000';
  teleCtx.lineWidth = 2;
  teleCtx.beginPath();
  for (let i = 0; i < HISTORY_LENGTH; i++) {
    const x = (i / (HISTORY_LENGTH - 1)) * w;
    const y = h - ((speedHistory[i] / 350) * (h - 20) + 10);
    if (i === 0) teleCtx.moveTo(x, y);
    else teleCtx.lineTo(x, y);
  }
  teleCtx.stroke();

  // Draw Throttle (Green) - Normalized 0 to 100%
  teleCtx.strokeStyle = '#10B981';
  teleCtx.lineWidth = 1.5;
  teleCtx.beginPath();
  for (let i = 0; i < HISTORY_LENGTH; i++) {
    const x = (i / (HISTORY_LENGTH - 1)) * w;
    const y = h - ((throttleHistory[i] / 100) * (h * 0.4) + 10);
    if (i === 0) teleCtx.moveTo(x, y);
    else teleCtx.lineTo(x, y);
  }
  teleCtx.stroke();

  // Draw Brake (Red)
  teleCtx.strokeStyle = '#EF4444';
  teleCtx.lineWidth = 2;
  teleCtx.beginPath();
  for (let i = 0; i < HISTORY_LENGTH; i++) {
    const x = (i / (HISTORY_LENGTH - 1)) * w;
    const y = h - ((brakeHistory[i] / 100) * (h * 0.4) + 10);
    if (i === 0) teleCtx.moveTo(x, y);
    else teleCtx.lineTo(x, y);
  }
  teleCtx.stroke();
}

// 6. Interactive 2D Monza Circuit GPS Tracker
const circuitCanvas = document.getElementById('circuitCanvas');
let cCtx = null;
if (circuitCanvas) {
  cCtx = circuitCanvas.getContext('2d');
}

// Monza Circuit Coordinates (Normalized Path)
const monzaPath = [
  { x: 50, y: 70 },    // Start/Finish Straight
  { x: 380, y: 70 },   // End of Main Straight
  { x: 400, y: 95 },   // Variante del Rettifilo Chicane T1/T2
  { x: 410, y: 140 },  // Curva Biassono / Curva Grande T4
  { x: 390, y: 190 },  // Variante della Roggia T5
  { x: 360, y: 220 },  // Lesmo 1 T6
  { x: 300, y: 245 },  // Lesmo 2 T7
  { x: 220, y: 220 },  // Curva del Serraglio T8
  { x: 150, y: 200 },  // Variante Ascari Entrance
  { x: 110, y: 175 },  // Ascari Exit
  { x: 70, y: 130 },   // Parabolica (Curva Alboreto)
  { x: 50, y: 70 }     // Back to Start/Finish
];

function getPointOnTrack(progress) {
  const numSegments = monzaPath.length - 1;
  const scaled = (progress % 1) * numSegments;
  const index = Math.floor(scaled);
  const frac = scaled - index;

  const p1 = monzaPath[index];
  const p2 = monzaPath[index + 1] || monzaPath[0];

  return {
    x: p1.x + (p2.x - p1.x) * frac,
    y: p1.y + (p2.y - p1.y) * frac
  };
}

function drawMonzaCircuit() {
  if (!cCtx || !circuitCanvas) return;
  const w = circuitCanvas.width;
  const h = circuitCanvas.height;

  cCtx.clearRect(0, 0, w, h);

  // Draw Circuit Road
  cCtx.strokeStyle = '#263147';
  cCtx.lineWidth = 14;
  cCtx.lineCap = 'round';
  cCtx.lineJoin = 'round';
  cCtx.beginPath();
  monzaPath.forEach((pt, idx) => {
    if (idx === 0) cCtx.moveTo(pt.x, pt.y);
    else cCtx.lineTo(pt.x, pt.y);
  });
  cCtx.closePath();
  cCtx.stroke();

  // Draw Racing Line (Subtle Gray Inner Line)
  cCtx.strokeStyle = '#374663';
  cCtx.lineWidth = 2;
  cCtx.stroke();

  // DRS Zones Highlighting (Main Straight: x=50 to 380, y=70)
  cCtx.strokeStyle = '#10B981';
  cCtx.lineWidth = 4;
  cCtx.beginPath();
  cCtx.moveTo(70, 70);
  cCtx.lineTo(360, 70);
  cCtx.stroke();

  // Start / Finish Line Checkered Bar
  cCtx.strokeStyle = '#FFFFFF';
  cCtx.lineWidth = 4;
  cCtx.beginPath();
  cCtx.moveTo(50, 60);
  cCtx.lineTo(50, 80);
  cCtx.stroke();

  // Draw Car Markers
  const landoPos = getPointOnTrack(driverState.norris.trackProgress);
  const oscarPos = getPointOnTrack(driverState.piastri.trackProgress);

  // Draw Oscar #81 (Yellow)
  cCtx.fillStyle = '#FCD34D';
  cCtx.beginPath();
  cCtx.arc(oscarPos.x, oscarPos.y, 7, 0, Math.PI * 2);
  cCtx.fill();
  cCtx.fillStyle = '#080A0F';
  cCtx.font = 'bold 8px JetBrains Mono';
  cCtx.textAlign = 'center';
  cCtx.textBaseline = 'middle';
  cCtx.fillText('81', oscarPos.x, oscarPos.y);

  // Draw Lando #4 (McLaren Papaya)
  cCtx.fillStyle = '#FF8000';
  cCtx.beginPath();
  cCtx.arc(landoPos.x, landoPos.y, 8, 0, Math.PI * 2);
  cCtx.fill();
  cCtx.fillStyle = '#FFFFFF';
  cCtx.font = 'bold 9px JetBrains Mono';
  cCtx.textAlign = 'center';
  cCtx.textBaseline = 'middle';
  cCtx.fillText('4', landoPos.x, landoPos.y);
}

// 7. Master Simulation Loop (20Hz Telemetry Tick)
let tickCounter = 0;
setInterval(() => {
  tickCounter++;
  const active = driverState[activeDriverKey];

  // Move cars on track
  driverState.norris.trackProgress += 0.0035;
  driverState.piastri.trackProgress += 0.0034;

  // Telemetry physics state machine
  const cyclePos = tickCounter % 40;
  const isHeavyBraking = cyclePos > 32;

  if (isHeavyBraking) {
    active.speed = Math.max(110, active.speed - 22);
    active.gear = active.speed > 220 ? 5 : active.speed > 160 ? 4 : 3;
    active.rpm = Math.max(7600, 8400 + Math.floor(Math.random() * 900));
    active.throttle = 0;
    active.brake = 96 - Math.floor(Math.random() * 12);
    active.ers = Math.min(96, active.ers + 0.3);
    if (drsState) {
      drsState.textContent = "CLOSED • BRAKING ZONE";
      drsState.classList.remove('active');
    }
  } else {
    active.speed = Math.min(348, active.speed + Math.floor(Math.random() * 6) - 1);
    if (active.speed < 230) active.speed = 318;
    active.gear = active.speed > 310 ? 8 : 7;
    active.rpm = Math.min(12450, 11500 + Math.floor(Math.random() * 850));
    active.throttle = 94 + Math.floor(Math.random() * 6);
    active.brake = 0;
    active.ers = Math.max(48, active.ers - 0.25);
    if (drsState) {
      drsState.textContent = "AVAILABLE • DEPLOYED";
      drsState.classList.add('active');
    }
  }

  // Rolling history update
  speedHistory.push(active.speed);
  speedHistory.shift();
  throttleHistory.push(active.throttle);
  throttleHistory.shift();
  brakeHistory.push(active.brake);
  brakeHistory.shift();

  // Dynamic tire temperatures
  active.tires.fl = Math.round((102.4 + Math.sin(tickCounter * 0.15) * 2.2) * 10) / 10;
  active.tires.fr = Math.round((104.1 + Math.cos(tickCounter * 0.15) * 2.4) * 10) / 10;
  active.tires.rl = Math.round((98.6 + Math.sin(tickCounter * 0.1) * 1.6) * 10) / 10;
  active.tires.rr = Math.round((99.2 + Math.cos(tickCounter * 0.1) * 1.8) * 10) / 10;

  // Sub-millisecond latency jitter
  if (edgeLatencyVal && latencyDisplay) {
    const lat = (0.72 + Math.random() * 0.09).toFixed(2);
    edgeLatencyVal.textContent = `${lat} ms`;
    latencyDisplay.textContent = `GDC EDGE • ${lat}ms`;
  }

  // Update UI Elements
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

  // Update Shift Lights (LEDs)
  if (rpmLedBar) {
    const pct = (active.rpm - 7500) / (12500 - 7500);
    const activeLeds = Math.floor(pct * TOTAL_LEDS);
    const leds = rpmLedBar.children;
    for (let i = 0; i < leds.length; i++) {
      if (i <= activeLeds) leds[i].classList.add('active');
      else leds[i].classList.remove('active');
    }
  }

  // Render Graphics
  drawTelemetryWaveform();
  drawMonzaCircuit();
}, 200);

// 8. Grand Prix Countdown Timer
function startCountdown() {
  const target = new Date();
  target.setDate(target.getDate() + 2);
  target.setHours(13, 30, 0, 0);

  function update() {
    const now = new Date();
    const diff = target - now;
    if (diff <= 0) return;

    const d = Math.floor(diff / (1000 * 60 * 60 * 24));
    const h = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const m = Math.floor((diff / (1000 * 60)) % 60);
    const s = Math.floor((diff / 1000) % 60);

    const pad = (n) => String(n).padStart(2, '0');
    const cdD = document.getElementById('cdDays');
    const cdH = document.getElementById('cdHours');
    const cdM = document.getElementById('cdMins');
    const cdS = document.getElementById('cdSecs');

    if (cdD) cdD.textContent = pad(d);
    if (cdH) cdH.textContent = pad(h);
    if (cdM) cdM.textContent = pad(m);
    if (cdS) cdS.textContent = pad(s);
  }

  update();
  setInterval(update, 1000);
}
startCountdown();

// 9. Interactive Strategy Simulator Logic
const pitLapInput = document.getElementById('pitLapInput');
const pitLapDisplay = document.getElementById('pitLapDisplay');
const rejoinPos = document.getElementById('rejoinPos');

if (pitLapInput) {
  pitLapInput.addEventListener('input', (e) => {
    const lap = e.target.value;
    if (pitLapDisplay) pitLapDisplay.textContent = `Lap ${lap}`;
    if (rejoinPos) {
      if (lap < 25) rejoinPos.textContent = "P5 (Traffic / Dirty Air)";
      else if (lap <= 34) rejoinPos.textContent = "P3 (Clean Air / Optimal)";
      else rejoinPos.textContent = "P2 (Overcut / Risk of Deg)";
    }
  });
}

// 10. Copy go/waleed-f1 Chip
const goLinkChip = document.getElementById('goLinkChip');
if (goLinkChip) {
  goLinkChip.addEventListener('click', () => {
    navigator.clipboard.writeText('http://go/waleed-f1').then(() => {
      const original = goLinkChip.innerHTML;
      goLinkChip.innerHTML = '<span>✅ Copied!</span>';
      playF1RadioChirp();
      setTimeout(() => {
        goLinkChip.innerHTML = original;
      }, 1500);
    });
  });
}
