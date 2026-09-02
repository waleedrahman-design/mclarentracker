# McLaren F1 &bull; Google Cloud Trackside Telemetry Portal

[![FIA Formula 1](https://img.shields.io/badge/FIA-Formula_1-E10600?style=flat&logo=formula1)](https://www.formula1.com)
[![Google Cloud](https://img.shields.io/badge/Google_Cloud-Edge_Operations-4285F4?style=flat&logo=googlecloud)](https://cloud.google.com)
[![McLaren Racing](https://img.shields.io/badge/McLaren-MCL38-FF8000?style=flat)](https://www.mclaren.com/racing/)

> **Internal Go Link:** `go/formula1` • `go/mclaren-edge`  
> **Architect:** Waleed Rahman (`waleedrahman`) — Google Technical Operations / Engineering Field Services (EFS)

An interactive, real-time trackside telemetry dashboard simulating the **McLaren Formula 1 Team (MCL38)** race operations, vehicle dynamics, pit garage **Google Distributed Cloud (GDC) Edge computing**, and **Google Cloud Vertex AI** race strategy models.

---

## Core Features

- **Real-Time Vehicle Dynamics Engine:** Live simulated telemetry traces for **Lando Norris (#4)** and **Oscar Piastri (#81)** including Speed (km/h), RPM with dynamic redline, Gear selection, Throttle/Brake traces, ERS battery deployment, and 4-corner tire temperatures (FL/FR/RL/RR).
- **Sector Deltas & Lap Comparisons:** Live tracking of Sector 1, 2, and 3 deltas featuring overall fastest (purple) and personal best (green) telemetry flags.
- **Implementation Engineer / Edge Systems View:**
  - Real-time sub-millisecond telemetry ingestion latency (`~0.78ms`) from 300+ on-car sensors.
  - Trackside Google Distributed Cloud (GDC) pit garage edge cluster health status.
  - Redundant 10Gbps bonded 5G/Satellite uplink monitoring with encrypted failover to the McLaren Technology Centre (MTC) in Woking, UK.
  - Android 15 pit wall tablet fleet synchronization (24/24 devices online).
- **Vertex AI Race Strategy Simulator:** Over 140,000 strategy simulations/sec calculating optimal pit windows, tire degradation offsets, and undercut confidence scores.
- **2026 Grand Prix Calendar:** Live session countdown clock and season schedule with targeted focus on the **North American Grand Prix Corridor** (Miami GP, Austin COTA, Las Vegas GP).

---

## Tech Stack

- **Frontend:** Semantic HTML5, Vanilla CSS Design System (custom properties, dark-mode McLaren Papaya `#FF8000` and Anthracite `#1E2229`), and JavaScript (ES6+).
- **Design Principles:** Function-driven, zero external dependencies, responsive grid, sub-second telemetry tick loop.

---

## Local Development

```bash
# Clone the repository
git clone https://github.com/<username>/mclaren-f1-tracker.git
cd mclaren-f1-tracker

# Start lightweight HTTP server
python3 -m http.server 8080

# Open in browser
open http://localhost:8080
```

---

## License
Internal technical demonstration and portfolio asset. All trademarks, logos, and brand names are property of their respective owners.
