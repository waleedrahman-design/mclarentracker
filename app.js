// McLaren F1 x Google Cloud Trackside Telemetry Engine (go/waleed-f1)

// Driver Profiles & State
const driverProfiles = {
  norris: {
    name: "Lando Norris",
    number: "4",
    position: "P1",
    baseSpeed: 318,
    gear: 7,
    rpm: 11840,
    throttle: 94,
    brake: 0,
    ers: 76,
    bestLap: "1:21.432",
    delta: "-0.184s",
    s1: "27.124s",
    s2: "26.892s",
    s3: "27.416s",
    tires: { fl: 102, fr: 104, rl: 98, rr: 99 }
  },
  piastri: {
    name: "Oscar Piastri",
    number: "81",
    position: "P2",
    baseSpeed: 315,
    gear: 7,
    rpm: 11720,
    throttle: 91,
    brake: 0,
    ers: 82,
    bestLap: "1:21.589",
    delta: "+0.157s",
    s1: "27.210s",
    s2: "26.945s",
    s3: "27.434s",
    tires: { fl: 101, fr: 103, rl: 97, rr: 98 }
  }
};

let currentDriver = 'norris';

// DOM Elements
const teleSpeed = document.getElementById('teleSpeed');
const teleGear = document.getElementById('teleGear');
const teleRpm = document.getElementById('teleRpm');
const teleRpmFill = document.getElementById('teleRpmFill');
const valThrottle = document.getElementById('valThrottle');
const fillThrottle = document.getElementById('fillThrottle');
const valBrake = document.getElementById('valBrake');
const fillBrake = document.getElementById('fillBrake');
const fillErs = document.getElementById('fillErs');

const tempFL = document.getElementById('tempFL');
const tempFR = document.getElementById('tempFR');
const tempRL = document.getElementById('tempRL');
const tempRR = document.getElementById('tempRR');

const netLatency = document.getElementById('netLatency');
const goLinkChip = document.getElementById('goLinkChip');

// Driver Tabs
const tabLando = document.getElementById('tabLando');
const tabOscar = document.getElementById('tabOscar');

function switchDriver(driverKey) {
  currentDriver = driverKey;
  if (driverKey === 'norris') {
    tabLando.classList.add('active');
    tabOscar.classList.remove('active');
  } else {
    tabOscar.classList.add('active');
    tabLando.classList.remove('active');
  }
  updateTelemetryUI(driverProfiles[driverKey]);
}

tabLando.addEventListener('click', () => switchDriver('norris'));
tabOscar.addEventListener('click', () => switchDriver('piastri'));

function updateTelemetryUI(data) {
  teleSpeed.textContent = data.baseSpeed;
  teleGear.textContent = data.gear;
  teleRpm.textContent = Number(data.rpm).toLocaleString();
  teleRpmFill.style.width = `${(data.rpm / 12500) * 100}%`;

  valThrottle.textContent = `${data.throttle}%`;
  fillThrottle.style.width = `${data.throttle}%`;

  valBrake.textContent = `${data.brake}%`;
  fillBrake.style.width = `${data.brake}%`;

  fillErs.style.width = `${data.ers}%`;

  tempFL.textContent = `${data.tires.fl}°C`;
  tempFR.textContent = `${data.tires.fr}°C`;
  tempRL.textContent = `${data.tires.rl}°C`;
  tempRR.textContent = `${data.tires.rr}°C`;
}

// Live Realistic Telemetry Simulation Tick
let telemetryStep = 0;
setInterval(() => {
  telemetryStep++;
  const active = driverProfiles[currentDriver];

  // Dynamic fluctuations simulating high-speed straight vs braking zone
  const isBrakingZone = (telemetryStep % 35) > 28;

  if (isBrakingZone) {
    active.baseSpeed = Math.max(120, active.baseSpeed - 18);
    active.gear = active.baseSpeed > 200 ? 5 : 3;
    active.rpm = Math.max(7800, 8400 + Math.floor(Math.random() * 800));
    active.throttle = 0;
    active.brake = 95 - Math.floor(Math.random() * 15);
    active.ers = Math.min(95, active.ers + 0.4);
  } else {
    active.baseSpeed = Math.min(342, active.baseSpeed + Math.floor(Math.random() * 4) - 1);
    if (active.baseSpeed < 220) active.baseSpeed = 312;
    active.gear = active.baseSpeed > 300 ? 8 : 7;
    active.rpm = Math.min(12400, 11400 + Math.floor(Math.random() * 900));
    active.throttle = 94 + Math.floor(Math.random() * 6);
    active.brake = 0;
    active.ers = Math.max(45, active.ers - 0.2);
  }

  // Micro-fluctuations on tire temps
  active.tires.fl = Math.round((102 + Math.sin(telemetryStep * 0.1) * 2) * 10) / 10;
  active.tires.fr = Math.round((104 + Math.cos(telemetryStep * 0.1) * 2) * 10) / 10;
  active.tires.rl = Math.round((98 + Math.sin(telemetryStep * 0.08) * 1.5) * 10) / 10;
  active.tires.rr = Math.round((99 + Math.cos(telemetryStep * 0.08) * 1.5) * 10) / 10;

  // Trackside GDC Edge Latency Jitter (sub-millisecond)
  if (netLatency) {
    const lat = (0.74 + Math.random() * 0.12).toFixed(2);
    netLatency.textContent = `${lat} ms`;
  }

  updateTelemetryUI(active);
}, 250);

// Grand Prix Countdown Clock (Monza GP / Next Session)
function updateCountdown() {
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + 2);
  targetDate.setHours(13, 30, 0, 0);

  function tick() {
    const now = new Date();
    const diff = targetDate - now;

    if (diff <= 0) return;

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const mins = Math.floor((diff / (1000 * 60)) % 60);
    const secs = Math.floor((diff / 1000) % 60);

    const pad = (n) => String(n).padStart(2, '0');
    const dElem = document.getElementById('cdDays');
    const hElem = document.getElementById('cdHours');
    const mElem = document.getElementById('cdMins');
    const sElem = document.getElementById('cdSecs');

    if (dElem) dElem.textContent = pad(days);
    if (hElem) hElem.textContent = pad(hours);
    if (mElem) mElem.textContent = pad(mins);
    if (sElem) sElem.textContent = pad(secs);
  }

  tick();
  setInterval(tick, 1000);
}
updateCountdown();

// Click to Copy go/waleed-f1
if (goLinkChip) {
  goLinkChip.addEventListener('click', () => {
    navigator.clipboard.writeText('http://go/waleed-f1').then(() => {
      const originalHtml = goLinkChip.innerHTML;
      goLinkChip.innerHTML = '<span>✅ Copied!</span>';
      setTimeout(() => {
        goLinkChip.innerHTML = originalHtml;
      }, 1500);
    });
  });
}
