/* * SOLAR DODGER | HYPER-MAX
 * ARCHITECTURE: Audio-First / Rhythm-Synced / Hybrid Audio Engine
 */

const CONFIG = {
    // Phase Timings (Seconds)
    PHASE_2_START: 45,
    PHASE_3_START: 90,
    TOTAL_DURATION: 180,

    // BPM Per Phase
    BPM_P1: 130,
    BPM_P2: 150,
    BPM_P3: 180,

    // Mechanics
    LANE_COUNT: 5,
    PLAYER_SPEED: 0.18,
    BASE_SCROLL_SPEED: 700,

    // Visuals
    COLORS: {
        player: '#ffcc00',
        p1: '#ff0055',
        p2: '#00ffea',
        p3: '#ff0000',
        white: '#ffffff'
    },

    // Audio
    MUSIC_CROSSFADE: 2.0, // Seconds
    DUCK_GAIN: 0.4,       // Gain of synth when music is playing

    // Music Start Offsets (Skip intros)
    MUSIC_OFFSETS: {
        p1: 16.0, // Forward by 16s
        p2: 25.0, // Forward by 25s
        p3: 0.0   // No change
    }
};


/* --- AUDIO ENGINE --- */
const AudioEngine = {
    ctx: null,
    masterGain: null,
    bgGain: null, // Sub-mix for background music
    synthGain: null, // Sub-mix for generated SFX

    // Scheduling
    currentBPM: CONFIG.BPM_P1,
    nextNoteTime: 0,
    beatCount: 0,
    isPlaying: false,
    lookahead: 25.0,
    scheduleAheadTime: 0.6,

    // Music Tracks
    audioMode: 'hybrid', // 'hybrid' (Music+Synth), 'synth' (Synth Only)
    tracks: { p1: null, p2: null, p3: null },
    activeSource: null,
    activeGainNode: null,

    init() {
        if (this.ctx) {
            if (this.ctx.state === 'suspended') this.ctx.resume();
            return;
        }
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContext();

        // Master Chain
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.5;
        this.masterGain.connect(this.ctx.destination);

        // Sub-mixes
        this.bgGain = this.ctx.createGain();
        this.bgGain.connect(this.masterGain);

        this.synthGain = this.ctx.createGain();
        this.synthGain.connect(this.masterGain);

        // Pre-load music if available (Hybrid mode)
        this.loadTracks();
    },

    loadTracks() {
        // Looks for <audio> tags or files. Since we can't upload files here, 
        // this logic supports standard HTMLAudioElements if they existed.
        const ids = ['track-p1', 'track-p2', 'track-p3'];
        const phases = ['p1', 'p2', 'p3'];

        ids.forEach((id, i) => {
            const el = document.getElementById(id);
            if (el) {
                // If element exists, create source node
                const source = this.ctx.createMediaElementSource(el);
                this.tracks[phases[i]] = { element: el, source: source };
            }
        });
    },

    setBPM(newBPM) {
        if (this.currentBPM === newBPM) return;

        // SAFE BPM TRANSITION
        // 1. Calculate how far we are into the current beat
        const currentTime = this.ctx.currentTime;
        const beatDuration = 60.0 / this.currentBPM;

        // If nextNoteTime is far ahead, pull it back to re-align with new BPM
        // strictly speaking, we just update the BPM and the scheduler 
        // uses the new BPM for the *next* increment.
        this.currentBPM = newBPM;

        // Update HUD immediately
        const bpmDisplay = document.getElementById('bpm-value');
        if (bpmDisplay) bpmDisplay.innerText = newBPM;

        console.log(`[AUDIO] BPM SET TO ${newBPM}`);
    },

    crossfadeMusic(phase) {
        if (this.audioMode === 'synth') return; // Synth mode ignores MP3s

        const phaseKey = 'p' + phase;
        const trackData = this.tracks[phaseKey];

        // If we don't have a file, trigger a synth drone fallback instead?
        // For this demo, we will generate a Synth Drone if no track exists.
        if (!trackData) {
            this.playSynthDrone(phase);
            return;
        }

        const now = this.ctx.currentTime;
        const fadeTime = CONFIG.MUSIC_CROSSFADE;

        // 1. Fade out current
        if (this.activeGainNode) {
            this.activeGainNode.gain.cancelScheduledValues(now);
            this.activeGainNode.gain.setValueAtTime(this.activeGainNode.gain.value, now);
            this.activeGainNode.gain.linearRampToValueAtTime(0, now + fadeTime);
            const oldSource = this.activeSource;
            setTimeout(() => { if (oldSource && oldSource.stop) oldSource.stop(); }, fadeTime * 1000);
        }

        // 2. Fade in new
        const newGain = this.ctx.createGain();
        newGain.gain.value = 0;
        newGain.connect(this.bgGain);

        trackData.source.connect(newGain);

        // APPLY OFFSET: Jump to specific start time
        const startOffset = CONFIG.MUSIC_OFFSETS[phaseKey] || 0;
        trackData.element.currentTime = startOffset;

        trackData.element.play();

        newGain.gain.linearRampToValueAtTime(1.0, now + fadeTime);

        this.activeSource = trackData.element; // store ref
        this.activeGainNode = newGain;
    },

    // FALLBACK: If no mp3 files, we play a procedurally generated drone
    playSynthDrone(phase) {
        // Stop previous drone
        if (this.droneOsc) {
            const now = this.ctx.currentTime;
            this.droneGain.gain.exponentialRampToValueAtTime(0.001, now + 2);
            this.droneOsc.stop(now + 2);
        }

        // Setup new drone
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.bgGain);

        if (phase === 1) {
            osc.type = 'sawtooth';
            osc.frequency.value = 55; // Low A
            filter.type = 'lowpass';
            filter.frequency.value = 400;
        } else if (phase === 2) {
            osc.type = 'square';
            osc.frequency.value = 110; // A2
            filter.type = 'lowpass';
            filter.frequency.value = 800;
            // LFO effect simulated by detune?
            osc.detune.value = 10;
        } else {
            osc.type = 'sawtooth';
            osc.frequency.value = 40; // Deep bass
            filter.type = 'highpass'; // Thin, harsh
            filter.frequency.value = 1000;
        }

        const now = this.ctx.currentTime;
        osc.start(now);
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.3, now + 2);

        this.droneOsc = osc;
        this.droneGain = gain;
    },

    playTone(freq, type, duration, time, vol = 0.5) {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        osc.connect(gain);
        gain.connect(this.synthGain);
        osc.start(time);
        gain.gain.setValueAtTime(vol, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
        osc.stop(time + duration);
    },

    playKick(time) {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain);
        gain.connect(this.synthGain);
        osc.frequency.setValueAtTime(150, time);
        osc.frequency.exponentialRampToValueAtTime(0.01, time + 0.5);
        gain.gain.setValueAtTime(1, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.5);
        osc.start(time);
        osc.stop(time + 0.5);
    },

    playHiHat(time) {
        if (!this.ctx) return;
        const bufferSize = this.ctx.sampleRate * 0.05;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 5000;

        const gain = this.ctx.createGain();
        gain.gain.value = 0.3;

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.synthGain);
        noise.start(time);
    },

    scheduler() {
        if (!this.isPlaying) return;

        // While there are notes that will need to play before the next interval,
        // schedule them and advance the pointer.
        while (this.nextNoteTime < this.ctx.currentTime + this.scheduleAheadTime) {
            this.scheduleNote(this.beatCount, this.nextNoteTime);

            // DYNAMIC BPM ADVANCE
            const secondsPerBeat = 60.0 / this.currentBPM;
            this.nextNoteTime += secondsPerBeat;

            this.beatCount++;
        }
        window.setTimeout(() => this.scheduler(), this.lookahead);
    },

    scheduleNote(beat, time) {
        // --- MUSIC GENERATION (SYNTH LAYER) ---
        // Even in 'hybrid' mode, we play kicks/hats for game feedback

        // Duck synth gain if music is loud? 
        // No, actually we duck the background music on impacts, 
        // but here we keep synth levels constant.

        this.playKick(time);
        if (beat % 1 === 0) this.playHiHat(time + (30 / this.currentBPM));

        const measure = Math.floor(beat / 4);
        let freq;
        const elapsed = Game ? Game.elapsed : 0;

        // Dynamic Synth Progression
        if (elapsed < CONFIG.PHASE_2_START) {
            freq = measure % 8 < 4 ? 55 : (measure % 8 < 6 ? 65 : 49);
        } else if (elapsed < CONFIG.PHASE_3_START) {
            freq = measure % 4 < 2 ? 45 : 90;
        } else {
            freq = 40 + (Math.random() * 40);
        }

        // Only play melody synth if in Synth mode OR if needed for texture
        if (this.audioMode === 'synth' || this.audioMode === 'hybrid') {
            if (beat % 2 === 0) this.playTone(freq, 'sawtooth', 0.2, time, 0.3);
            if (beat % 4 === 2) this.playTone(freq * 1.5, 'square', 0.1, time, 0.2);
        }

        // --- GAMEPLAY SYNC ---
        // 1. Logic: Decide what spawns (Lookahead)
        if (Game && Game.isRunning) Game.scheduleEvent(beat, time);

        // 2. Visuals: Schedule the visual beat pulse (Exact Time)
        const delay = (time - this.ctx.currentTime) * 1000;
        setTimeout(() => {
            if (Game && Game.isRunning) Game.onBeat(beat);
        }, Math.max(0, delay));
    },

    start() {
        this.init();
        if (this.ctx.state === 'suspended') this.ctx.resume();
        this.isPlaying = true;
        this.beatCount = 0;
        this.nextNoteTime = this.ctx.currentTime + 0.1;

        // Start Initial Drone/Music
        this.crossfadeMusic(1);

        this.scheduler();
    },

    stop() {
        this.isPlaying = false;
        // Stop drones/music
        if (this.droneOsc) this.droneOsc.stop();
        if (this.activeSource && this.activeSource.pause) this.activeSource.pause();
        if (this.ctx) this.ctx.suspend();
    },


    resume() {
        if (this.ctx) {
            this.ctx.resume().then(() => {
                // IMPORTANT: Reset nextNoteTime to prevent "catch-up" burst
                this.nextNoteTime = this.ctx.currentTime + 0.1;
                this.isPlaying = true;
                this.scheduler();
            });
        }
    }
};

/* --- GAME ENGINE --- */
const Game = {
    godMode: false,

    // SAFETY TUNING
    safetyWindowSec: 0.5,
    reservationDuration: 1.0,
    throttleWindow: 3.0,
    maxPerWindow: 12,

    invincibleTime: 0,
    canvas: document.getElementById('gameCanvas'),
    ctx: null,
    width: 0,
    height: 0,
    lastTime: 0,
    isRunning: false,
    isPaused: false,
    elapsed: 0,
    phase: 1,
    controlMode: 'swipe',
    isMobile: false,

    player: { x: 0.5, targetX: 0.5, w: 30, h: 30, y: 0, tilt: 0 },

    obstacles: [],
    particles: [],
    pendingSpawns: [],
    laneReservations: [],
    preWarns: [],

    cameraShake: 0,
    bgPulse: 1,
    activeColor: CONFIG.COLORS.p1,

    // --- SAFETY & THROTTLING ---

    isLaneSafeAtTime(lane, checkTime) {
        // 1. Check Pending Spawns (using Audio Time)
        const pendingConflict = this.pendingSpawns.some(p =>
            p.val === lane && Math.abs(p.time - checkTime) < this.safetyWindowSec
        );
        if (pendingConflict) return false;

        // 2. Check Reservations
        const reservationConflict = this.laneReservations.some(r =>
            r.lane === lane && checkTime >= r.time && checkTime < r.expire
        );
        if (reservationConflict) return false;

        // 3. Check Active Obstacles (Conservative)
        // Check if any obstacle is currently "occupying" the lane in a dangerous way
        // We estimate arrival at player y to see if it conflicts
        // This is a rough check for active objects falling right now
        const activeConflict = this.obstacles.some(o =>
            !o.passed && o.lane === lane && o.y < this.height - 100
        );
        if (activeConflict) return false;

        return true;
    },

    getPendingCountInWindow(windowSec) {
        const now = (AudioEngine.ctx) ? AudioEngine.ctx.currentTime : 0;
        return this.pendingSpawns.filter(p => p.time >= now && p.time <= now + windowSec).length;
    },

    ensureCoverage(spawnAnchor, windowSec) {
        const beatSec = 60 / AudioEngine.currentBPM; // Use current BPM
        const limitTime = spawnAnchor + windowSec;
        const coveredLanes = new Set();

        this.pendingSpawns.forEach(p => {
            if (p.time >= spawnAnchor && p.time <= limitTime) coveredLanes.add(p.val);
        });

        this.obstacles.forEach(o => {
            if (!o.passed && typeof o.lane === 'number') coveredLanes.add(o.lane);
        });

        const missingLanes = [];
        for (let i = 0; i < CONFIG.LANE_COUNT; i++) {
            if (!coveredLanes.has(i)) missingLanes.push(i);
        }

        if (this.getPendingCountInWindow(windowSec) >= this.maxPerWindow) return;

        missingLanes.forEach(lane => {
            if (!this.isLaneSafeAtTime(lane, spawnAnchor)) return;
            const maxBeats = Math.max(1, Math.floor(windowSec / beatSec));
            const randomBeatOffset = Math.floor(Math.random() * maxBeats) * beatSec;
            let targetTime = spawnAnchor + randomBeatOffset;
            this.queueObstacle(targetTime, lane, 'normal');
        });
    },

    pickRandomDistinct(count) {
        let pool = [];
        for (let i = 0; i < CONFIG.LANE_COUNT; i++) pool.push(i);
        let result = [];
        for (let i = 0; i < count; i++) {
            if (pool.length === 0) break;
            const idx = Math.floor(Math.random() * pool.length);
            result.push(pool[idx]);
            pool.splice(idx, 1);
        }
        return result;
    },

    init() {
        this.ctx = this.canvas.getContext('2d');
        this.checkMobile();

        window.addEventListener('resize', () => { setTimeout(() => this.resize(), 50); });
        window.addEventListener('orientationchange', () => { setTimeout(() => this.resize(), 100); });
        this.resize();
        this.setupInputs();

        // Audio Toggle Logic
        document.querySelectorAll('.audio-mode').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const mode = e.target.dataset.audio;
                AudioEngine.audioMode = mode;
                document.querySelectorAll('.audio-mode').forEach(b => b.classList.remove('selected'));
                e.target.classList.add('selected');
            });
        });

        requestAnimationFrame((t) => this.loop(t));
    },

    setupInputs() {
        const handleInput = (dir) => {
            if (!this.isRunning || this.isPaused) return;
            const laneW = 1 / CONFIG.LANE_COUNT;
            let target = this.player.targetX + (dir * laneW);
            target = Math.max(laneW / 2, Math.min(1 - laneW / 2, target));
            this.player.targetX = target;
            this.player.tilt = dir * 20;
        };

        window.addEventListener('keydown', (e) => {
            if (e.code === 'ArrowLeft' || e.code === 'KeyA') handleInput(-1);
            if (e.code === 'ArrowRight' || e.code === 'KeyD') handleInput(1);
        });

        let touchStartX = 0;
        window.addEventListener('touchstart', (e) => {
            if (this.controlMode === 'swipe') touchStartX = e.changedTouches[0].screenX;
        }, { passive: true });
        window.addEventListener('touchend', (e) => {
            if (this.controlMode === 'swipe') {
                let diff = e.changedTouches[0].screenX - touchStartX;
                if (Math.abs(diff) > 30) handleInput(diff > 0 ? 1 : -1);
            }
        }, { passive: true });

        const safeAddEvent = (el, ev, fn, opts) => { if (el) el.addEventListener(ev, fn, opts); };

        safeAddEvent(document.getElementById('start-btn'), 'click', () => this.start());
        // Inside the setupInputs() function in script.js

        // [CHANGE THIS]
        // safeAddEvent(document.getElementById('restart-btn'), 'click', () => this.start());

        // [TO THIS]
        safeAddEvent(document.getElementById('restart-btn'), 'click', () => {
            // This forces the entire browser tab to refresh, 
            // ensuring everything is re-initialized from scratch.
            window.location.reload();
        });

        const leftBtn = document.getElementById('touch-left');
        if (leftBtn) leftBtn.addEventListener('touchstart', (e) => { e.preventDefault(); if (this.controlMode === 'buttons') handleInput(-1); }, { passive: false });

        const rightBtn = document.getElementById('touch-right');
        if (rightBtn) rightBtn.addEventListener('touchstart', (e) => { e.preventDefault(); if (this.controlMode === 'buttons') handleInput(1); }, { passive: false });

        const ctrlBtns = document.querySelectorAll('.ctrl-btn');
        if (ctrlBtns && ctrlBtns.length) {
            ctrlBtns.forEach(btn => {
                if (!btn.classList.contains('audio-mode')) {
                    btn.addEventListener('click', (e) => this.setControlMode(e.target.dataset.mode));
                }
            });
        }
    },

    checkMobile() {
        this.isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || (window.innerWidth < 800 && 'ontouchstart' in window);
    },

    resize() {
        const dpr = window.devicePixelRatio || 1;
        this.width = window.innerWidth;
        this.height = window.innerHeight;
        this.canvas.width = this.width * dpr;
        this.canvas.height = this.height * dpr;
        this.ctx.scale(dpr, dpr);
        this.player.y = this.height - 120;

        const lockScreen = document.getElementById('rotate-message');
        if (this.isMobile && this.height > this.width) {
            this.isPaused = true;
            lockScreen.style.display = 'flex';
            if (AudioEngine.ctx) AudioEngine.ctx.suspend();
        } else {
            this.isPaused = false;
            lockScreen.style.display = 'none';
            // Only resume if game was actually running
            if (this.isRunning && AudioEngine.ctx) AudioEngine.resume();
        }
    },

    setControlMode(mode) {
        this.controlMode = mode;
        document.querySelectorAll('.ctrl-btn').forEach(btn => {
            if (!btn.classList.contains('audio-mode')) {
                btn.classList.toggle('selected', btn.dataset.mode === mode);
            }
        });
        const mobileCtrls = document.getElementById('mobile-controls');
        if (this.isRunning && this.isMobile) {
            mobileCtrls.classList.toggle('hidden', mode !== 'buttons');
        }
    },

    start() {
        const elem = document.documentElement;
        if (elem.requestFullscreen && this.isMobile) elem.requestFullscreen().catch(() => { });

        setTimeout(() => {
            // --- NEW: FORCE HARD AUDIO RESET ---
            // This ensures "Retry" feels exactly like "Initialize" (Cold Start)
            if (AudioEngine.tracks) {
                ['p1', 'p2', 'p3'].forEach(p => {
                    const t = AudioEngine.tracks[p];
                    if (t && t.element) {
                        t.element.pause();
                        t.element.currentTime = 0;
                    }
                });
            }
            AudioEngine.activeSource = null;
            AudioEngine.activeGainNode = null;
            // -----------------------------------

            this.checkMobile();
            this.resize();
            this.isRunning = true;
            this.lives = 1;
            document.getElementById('lives-count').innerText = this.lives;
            this.obstacles = [];
            this.pendingSpawns = [];
            this.laneReservations = [];
            this.preWarns = [];
            this.particles = [];
            this.elapsed = 0;
            this.phase = 1;

            // RESET AUDIO / BPM
            AudioEngine.currentBPM = CONFIG.BPM_P1;
            document.getElementById('bpm-value').innerText = CONFIG.BPM_P1;

            this.player.x = 0.5;
            this.player.targetX = 0.5;
            this.invincibleTime = 0;
            this.activeColor = CONFIG.COLORS.p1;
            this.bgPulse = 1;

            document.getElementById('start-screen').classList.add('hidden');
            document.getElementById('game-over-screen').classList.add('hidden');
            document.getElementById('hud').classList.remove('hidden');

            this.setControlMode(this.controlMode);

            // Init Visual Phase
            document.body.className = 'phase-1';
            document.getElementById('phase-text').innerText = "PHASE 1: SOLAR";
            document.getElementById('phase-text').style.color = CONFIG.COLORS.p1;

            AudioEngine.start();
            this.lastTime = performance.now();
        }, 100);
    },

    scheduleEvent(beat, spawnTime) {
        if (!this.isRunning) return;
        const isSafeToSpawn = (t, lane) => this.isLaneSafeAtTime(lane, t);

        if (this.phase === 1) {
            const timeUntilPhase2 = CONFIG.PHASE_2_START - spawnTime;
            if (timeUntilPhase2 > 0) {
                this.ensureCoverage(spawnTime, Math.min(5, timeUntilPhase2));
                if (beat % 1 === 0 && Math.random() > 0.3) {
                    const lane = Math.floor(Math.random() * CONFIG.LANE_COUNT);
                    if (isSafeToSpawn(spawnTime, lane)) this.queueObstacle(spawnTime, lane, 'normal');
                }
            }
        }
        else if (this.phase === 2) {
            if (beat % 2 === 0) {
                const freeCount = (Math.random() < 0.7) ? 1 : 2;
                const freeLanes = this.pickRandomDistinct(freeCount);
                for (let i = 0; i < CONFIG.LANE_COUNT; i++) {
                    if (!freeLanes.includes(i)) this.queueObstacle(spawnTime, i, 'neon_block');
                }
            }
        }
        else if (this.phase === 3) {
            const pendingInWindow = this.getPendingCountInWindow(this.throttleWindow);
            if (pendingInWindow >= this.maxPerWindow) return;

            this.ensureCoverage(spawnTime, 5);

            if (beat % 1 === 0 && Math.random() > 0.3) {
                const lane = Math.floor(Math.random() * CONFIG.LANE_COUNT);
                if (isSafeToSpawn(spawnTime, lane)) this.queueObstacle(spawnTime, lane, 'normal');
            }

            if (beat % 8 === 0) {
                const seekerLane = 2;
                if (isSafeToSpawn(spawnTime, seekerLane)) {
                    this.queueObstacle(spawnTime, seekerLane, 'seeker');
                    this.laneReservations.push({
                        lane: seekerLane,
                        time: spawnTime,
                        expire: spawnTime + this.reservationDuration
                    });
                }
            }
        }
    },

    queueObstacle(time, val, type) {
        this.pendingSpawns.push({ time: time, val: val, type: type || 'normal' });

        const color = (type === 'neon_block' || type === 'overhang') ? CONFIG.COLORS.p2 : CONFIG.COLORS.p1;

        // Use AUDIO TIME for pre-warn start reference
        const now = (AudioEngine && AudioEngine.ctx) ? AudioEngine.ctx.currentTime : performance.now() / 1000;

        this.preWarns.push({
            lane: val,
            startTime: now,
            spawnTime: time,
            type: type,
            color: color
        });
        this.pendingSpawns.sort((a, b) => a.time - b.time);
    },

    spawnObstacle(val, type) {
        const laneW = this.width / CONFIG.LANE_COUNT;
        let obs = {
            lane: val,
            x: val * laneW,
            y: -100,
            w: laneW,
            h: 40,
            vy: 1.0,
            type: type || 'normal',
            passed: false,
            color: CONFIG.COLORS.p1
        };

        if (type === 'neon_block') {
            obs.color = CONFIG.COLORS.p2;
            obs.h = 60;
            obs.vy = 0.9;
        } else if (type === 'overhang') {
            obs.overhang = true;
            obs.w = laneW * 0.8;
            obs.h = 24;
            obs.x = (val * laneW) + (laneW * 0.1);
            obs.y = -450;
            obs.vy = 1.15;
            obs.color = CONFIG.COLORS.p2;
        }

        if (type === 'seeker') {
            obs = Object.assign(obs, {
                x: (val * laneW) + (laneW / 2) - 20,
                y: -100,
                w: 40,
                h: 40,
                type: 'seeker',
                vy: 0.8,
                color: CONFIG.COLORS.p3,
                laneIndex: val
            });
        }
        this.obstacles.push(obs);
    },

    onBeat(beat) {
        if (!this.isRunning) return;
        this.bgPulse = 1.15;
        // [REMOVED] Old rhythmic shake
        // this.cameraShake = (this.phase === 3) ? 8 : 5; // Harder shake in p3

        // UI BEAT METER
        const meter = document.getElementById('beat-meter');
        if (meter) {
            meter.classList.add('pulse');
            setTimeout(() => meter.classList.remove('pulse'), 100);
        }

        // --- SEEKER LOGIC (RETAINED FROM PREVIOUS) ---
        if (this.phase === 3) {
            const laneW = this.width / CONFIG.LANE_COUNT;
            const currentTime = AudioEngine.ctx.currentTime;

            this.obstacles.forEach(o => {
                if (o.type === 'seeker') {
                    const distToPlayer = this.player.y - o.y;
                    const speedPxPerSec = CONFIG.BASE_SCROLL_SPEED * 1.3 * o.vy;
                    const timeToImpact = (distToPlayer > 0) ? distToPlayer / speedPxPerSec : 0;
                    const arrivalTime = currentTime + timeToImpact;

                    const playerLane = Math.floor(this.player.x * CONFIG.LANE_COUNT);
                    let targetLane = o.laneIndex;
                    if (o.laneIndex < playerLane) targetLane++;
                    else if (o.laneIndex > playerLane) targetLane--;

                    let chosenLane = -1;
                    if (this.isLaneSafeAtTime(targetLane, arrivalTime)) chosenLane = targetLane;
                    else if (this.isLaneSafeAtTime(o.laneIndex, arrivalTime)) chosenLane = o.laneIndex;
                    else {
                        const offsets = [-1, 1, -2, 2];
                        for (let off of offsets) {
                            const tryLane = o.laneIndex + off;
                            if (tryLane >= 0 && tryLane < CONFIG.LANE_COUNT) {
                                if (this.isLaneSafeAtTime(tryLane, arrivalTime)) {
                                    chosenLane = tryLane;
                                    break;
                                }
                            }
                        }
                    }

                    if (chosenLane !== -1) {
                        o.laneIndex = chosenLane;
                        this.laneReservations.push({
                            lane: chosenLane,
                            time: currentTime,
                            expire: currentTime + 0.5
                        });
                    }

                    o.targetX = o.laneIndex * laneW + (laneW / 2) - (o.w / 2);
                    this.particles.push({
                        x: o.x + o.w / 2, y: o.y + o.h / 2,
                        vx: 0, vy: 0, life: 0.3, color: o.color
                    });
                }
            });
        }
    },

    triggerPhaseShift(phaseNum, color, text, bpm) {
        this.activeColor = color;
        const flash = document.getElementById('flash-layer');
        flash.style.opacity = 0.8;
        setTimeout(() => flash.style.opacity = 0, 300);

        document.getElementById('phase-text').innerText = text;
        document.getElementById('phase-text').style.color = color;

        // CSS Class Switching
        document.body.className = `phase-${phaseNum}`;

        // AUDIO UPDATES
        AudioEngine.setBPM(bpm);
        AudioEngine.crossfadeMusic(phaseNum);

        this.cameraShake = 30;
    },

    loop(t) {
        requestAnimationFrame((t) => this.loop(t));

        if (!this.lastTime) this.lastTime = t;
        const dt = Math.min((t - this.lastTime) / 1000, 0.1);
        this.lastTime = t;

        if (this.isRunning && !this.isPaused) {
            this.update(dt);
        }
        this.draw();
    },

    update(dt) {
        this.elapsed += dt;
        document.getElementById('score').innerText = this.elapsed.toFixed(2);

        // --- PHASE LOGIC ---
        if (this.elapsed > CONFIG.PHASE_3_START && this.phase !== 3) {
            this.phase = 3;
            this.triggerPhaseShift(3, CONFIG.COLORS.p3, "PHASE 3: VOID", CONFIG.BPM_P3);
        } else if (this.elapsed > CONFIG.PHASE_2_START && this.phase === 1) {
            this.phase = 2;
            this.triggerPhaseShift(2, CONFIG.COLORS.p2, "PHASE 2: NEON", CONFIG.BPM_P2);
        }

        if (this.invincibleTime > 0) this.invincibleTime -= dt;

        // 1. Spawner
        const audioTime = AudioEngine.ctx ? AudioEngine.ctx.currentTime : 0;
        for (let i = this.pendingSpawns.length - 1; i >= 0; i--) {
            if (audioTime >= this.pendingSpawns[i].time) {
                const s = this.pendingSpawns[i];
                this.spawnObstacle(s.val, s.type);
                this.pendingSpawns.splice(i, 1);
            }
        }

        // Cleanup reservations
        for (let i = this.laneReservations.length - 1; i >= 0; i--) {
            if (audioTime >= this.laneReservations[i].expire) this.laneReservations.splice(i, 1);
        }

        // Cleanup Pre-warns
        for (let i = this.preWarns.length - 1; i >= 0; i--) {
            if (audioTime >= this.preWarns[i].spawnTime) this.preWarns.splice(i, 1);
        }

        // 2. Player
        const targetPixelX = (this.player.targetX * this.width) - (this.player.w / 2);
        const currentPixelX = this.player.x * this.width;
        const newPixelX = currentPixelX + (targetPixelX - currentPixelX) * 10 * dt;
        this.player.x = newPixelX / this.width;
        this.player.tilt *= 0.9;

        if (Math.random() > 0.5) {
            this.particles.push({
                x: (this.player.x * this.width) + (this.player.w / 2),
                y: this.player.y + 30,
                vx: (Math.random() - 0.5) * 2,
                vy: 5,
                life: 0.5,
                color: CONFIG.COLORS.player
            });
        }

        // 3. Obstacles
        for (let i = this.obstacles.length - 1; i >= 0; i--) {
            let o = this.obstacles[i];
            const speedMult = (this.phase === 3) ? 1.3 : 1.0;
            o.y += (CONFIG.BASE_SCROLL_SPEED * speedMult * o.vy) * dt;

            if (o.type === 'seeker' && o.targetX !== undefined) {
                o.x += (o.targetX - o.x) * 15 * dt;
            }

            /* --- NEW DODGE MECHANIC START --- */
            // Check if obstacle has just passed the player's Y position
            if (!o.passed && o.y > this.player.y + this.player.h) {
                o.passed = true; // Mark as passed so we don't check again

                // Calculate horizontal distance between Player center and Obstacle center
                const pCenterX = (this.player.x * this.width) + (this.player.w / 2);
                const oCenterX = o.x + (o.w / 2);
                const dist = Math.abs(pCenterX - oCenterX);
                const laneW = this.width / CONFIG.LANE_COUNT;

                // If distance is less than roughly 1.5 lanes (meaning adjacent lane or closer)
                // Trigger the shake effect!
                if (dist < laneW * 1.5) {
                    this.cameraShake = 15; // NEW SHAKE TRIGGER
                }
            }
            /* --- NEW DODGE MECHANIC END --- */

            if (o.y > this.height) {
                this.obstacles.splice(i, 1);
                continue;
            }

            if (this.checkCollision(this.player, o)) {
                this.handleCollision(o, i);
            }
        }

        // 4. Particles
        for (let i = this.particles.length - 1; i >= 0; i--) {
            let p = this.particles[i];
            p.x += p.vx; p.y += p.vy; p.life -= dt;
            if (p.life <= 0) this.particles.splice(i, 1);
        }

        if (this.cameraShake > 0) this.cameraShake *= 0.9;
        if (this.bgPulse > 1) this.bgPulse -= dt;
    },

    checkCollision(p, o) {
        return (p.x * this.width < o.x + o.w &&
            p.x * this.width + p.w > o.x &&
            p.y < o.y + o.h &&
            p.y + p.h > o.y);
    },

    handleCollision(o, index) {
        if (this.invincibleTime > 0 || this.godMode) return;
        this.lives--;
        document.getElementById('lives-count').innerText = this.lives;

        const flash = document.getElementById('flash-layer');
        flash.style.opacity = 0.6;
        setTimeout(() => flash.style.opacity = 0, 100);
        // [REMOVED] Shake on death
        // this.cameraShake = 20;

        this.obstacles.splice(index, 1);

        if (this.lives > 0) {
            this.invincibleTime = 2.0;
        } else {
            this.gameOver();
        }
    },

    gameOver() {
        this.isRunning = false;
        AudioEngine.stop();
        document.getElementById('hud').classList.add('hidden');
        document.getElementById('game-over-screen').classList.remove('hidden');
        document.getElementById('final-time').innerText = this.elapsed.toFixed(2);

        const e = this.elapsed;
        let rank = "F";
        if (e > 30) rank = "C";
        if (e > 60) rank = "B";
        if (e > 90) rank = "A";
        if (e >= 120) rank = "S";
        document.getElementById('rank-display').innerText = `RANK: ${rank}`;
    },

    draw() {
        this.ctx.fillStyle = '#000'; // Cleared, background handled by CSS
        this.ctx.clearRect(0, 0, this.width, this.height);

        this.ctx.save();
        if (this.cameraShake > 0.5) {
            const rx = (Math.random() - 0.5) * this.cameraShake;
            const ry = (Math.random() - 0.5) * this.cameraShake;
            this.ctx.translate(rx, ry);
        }

        // Dynamic Grid
        this.ctx.strokeStyle = this.activeColor;
        this.ctx.lineWidth = 2.5 * this.bgPulse;
        this.ctx.globalAlpha = 0.25;

        const laneW = this.width / CONFIG.LANE_COUNT;
        for (let i = 1; i < CONFIG.LANE_COUNT; i++) {
            this.ctx.beginPath();
            this.ctx.moveTo(i * laneW, 0);
            this.ctx.lineTo(i * laneW, this.height);
            this.ctx.stroke();
        }

        const gridSize = 90;
        const offset = (this.elapsed * 100) % gridSize;
        for (let y = -gridSize; y < this.height; y += gridSize) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, y + offset);
            this.ctx.lineTo(this.width, y + offset);
            this.ctx.stroke();
        }

        this.ctx.globalAlpha = 1;

        // Pre-Warns
        if (AudioEngine && AudioEngine.ctx) {
            const now = AudioEngine.ctx.currentTime;
            this.preWarns.forEach(w => {
                const timeLeft = w.spawnTime - now;
                const progress = 1 - timeLeft * 2;
                if (progress > 0) {
                    this.ctx.globalAlpha = 0.15;
                    this.ctx.fillStyle = w.color;
                    this.ctx.fillRect(w.lane * laneW, 0, laneW, this.height);

                    this.ctx.globalAlpha = 0.4;
                    const y = this.height * 0.2 * Math.min(1, progress);
                    this.ctx.fillRect(w.lane * laneW, y, laneW, this.height);
                }
            });
        }
        this.ctx.globalAlpha = 1;

        // Player
        this.ctx.globalAlpha = (this.invincibleTime > 0 && this.invincibleTime * 10 % 2 > 1) ? 0.5 : 1;
        this.ctx.fillStyle = CONFIG.COLORS.player;
        this.ctx.shadowBlur = 20;
        this.ctx.shadowColor = CONFIG.COLORS.player;

        const px = this.player.x * this.width;
        this.ctx.save();
        this.ctx.translate(px + this.player.w / 2, this.player.y + this.player.h / 2);
        this.ctx.rotate(this.player.tilt * Math.PI / 180);
        this.ctx.fillRect(-this.player.w / 2, -this.player.h / 2, this.player.w, this.player.h);
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillRect(-this.player.w / 4, -this.player.h / 4, this.player.w / 2, this.player.h / 2);
        this.ctx.restore();
        this.ctx.shadowBlur = 0;

        // Obstacles
        this.ctx.shadowBlur = 10;
        this.obstacles.forEach(o => {
            this.ctx.fillStyle = o.color || '#fff';
            this.ctx.shadowColor = o.color;

            if (o.type === 'seeker') {
                this.ctx.beginPath();
                this.ctx.moveTo(o.x + o.w / 2, o.y);
                this.ctx.lineTo(o.x + o.w, o.y + o.h / 2);
                this.ctx.lineTo(o.x + o.w / 2, o.y + o.h);
                this.ctx.lineTo(o.x, o.y + o.h / 2);
                this.ctx.fill();
            } else {
                this.ctx.fillRect(o.x, o.y, o.w, o.h);
            }
        });

        // Particles
        this.particles.forEach(p => {
            this.ctx.globalAlpha = p.life;
            this.ctx.fillStyle = p.color;
            this.ctx.fillRect(p.x, p.y, 5, 5);
        });

        this.ctx.restore();
    }
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => Game.init());
} else {
    Game.init();
}

