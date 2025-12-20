<div align="center">

# ☀️ SOLAR DODGER // HYPER-MAX

### *Pure JavaScript. Procedural Audio. High-Performance Rendering.*
![Pure JS](https://img.shields.io/badge/Logic-Vanilla_JS-f7df1e?style=flat-square&logo=javascript&logoColor=black)


**[PLAY THE LIVE DEMO HERE](https://wall-e-code.github.io/SOLAR-DODGER-HYPER-MAX/)**

</div>

---

## 📡 SYSTEM TRANSMISSION

**Solar Dodger** is a rhythmic survival odyssey. Built with zero game engines and zero external assets, every synth lead and visual pulse is mathematically synthesized in real-time. Unlike frame-based games, Solar Dodger uses **Audio-Authoritative Architecture**: the rhythm determines the physics, ensuring you never die to an off-beat glitch.

---

## 🕹️ MISSION PARAMETERS

Navigate through three escalating phases of rhythmic pressure. Survival is determined by your ability to read the beat.

| PHASE | NAME | MECHANIC: "THE RHYTHM IS THE MAP" |
| --- | --- | --- |
| **01** | **SOLAR** | **Linear Drops:** Simple vertical lanes synced to the kick drum. |
| **02** | **NEON** | **Pressure Lanes:** Multi-lane patterns that leave exactly 1-2 safe zones. |
| **03** | **VOID** | **Music Seekers:** Enemies that snap-step toward you only on the beat. |

---

## ⚡ TECH SPECS (RHYTHM-SYNC ARCHITECTURE)

### 🔊 Audio-Authoritative Scheduling

The game bypasses standard `requestAnimationFrame` timing for gameplay logic, instead using the **Web Audio API scheduler**:

* **Lookahead Spawning:** The `AudioEngine` schedules notes 600ms in advance, allowing the `GameEngine` to queue obstacles before the sound even plays.
* **Deterministic Logic:** All "randomness" is calculated at the moment of audio scheduling, preventing frame-rate drops from desyncing the music.
* **Quantized Movement:** In Phase 3, enemies move in discrete "steps" calculated via `Math.floor(beat)`, mimicking a physical sequencer.

### 🛡️ God Mode (Showcase Logic)

The system includes a built-in `Game.godMode` flag for development and exhibition:

* **OFF (Standard):** One-hit death. Immediate audio suspension and terminal state.
* **ON (Debug):** Player survives collisions. Obstacles shatter on contact, triggering camera shake and particle FX without interrupting the sequence.

### 🎨 Visual Synthesis

* **Scanline Overlay:** CSS-based linear-gradient patterns for a retro CRT feel.
* **Dynamic Chromatic Aberration:** Visual layers shift intensity based on `bgPulse` intensity.
* **Reactive Grid:** The background grid's opacity and scale are linked to the Master Gain of the synthesizer.

---

## 🎮 CONTROLS

* **DESKTOP:** `[ A / D ]` or `[ ARROWS ]` to Strafe.
* **MOBILE:** Choose between **[ SWIPE ]** or **[ ON-SCREEN BUTTONS ]**.
* **GOAL:** Survival for **180 Seconds**.
* **SYSTEM LOCK:** Landscape orientation is strictly required on mobile devices.

---

## 🛠️ DEPLOYMENT

1. **Clone:** `git clone https://github.com/WaLL-E-code/SOLAR-DODGER-HYPER-MAX.git`
2. **Launch:** Open `index.html` in any modern browser.
3. **Hardware:** A high-polling rate mouse/keyboard and headphones are recommended for Phase 3.