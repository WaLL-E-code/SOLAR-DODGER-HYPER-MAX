/* * SOLAR DODGER | HYPER-MAX
 * ARCHITECTURE: Audio-First / Rhythm-Synced
 */

const CONFIG = {
    BPM: 130,
    LANE_COUNT: 5,
    PLAYER_SPEED: 0.18,
    BASE_SCROLL_SPEED: 700,   // restored default scroll speed (pixels/sec baseline)
    TOTAL_DURATION: 180,      // used for progress bar / ranking
    PHASE_2_START: 45,
    PHASE_3_START: 90,
    COLORS: {
        player: '#ffcc00',
        p1: '#ff0055',
        p2: '#00ffea',
        p3: '#ff0000',
        white: '#ffffff'
    }
};


/* --- AUDIO ENGINE --- */
const AudioEngine = {
    ctx: null,
    nextNoteTime: 0,
    beatCount: 0,
    isPlaying: false,
    lookahead: 25.0,
    scheduleAheadTime: 0.6, // 600ms lookahead for spawning
    masterGain: null,

    init() {
        if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContext();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.5;
        this.masterGain.connect(this.ctx.destination);
    },

    playTone(freq, type, duration, time, vol = 0.5) {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        osc.connect(gain);
        gain.connect(this.masterGain);
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
        gain.connect(this.masterGain);
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
        gain.connect(this.masterGain);
        noise.start(time);
    },

    scheduler() {
        if (!this.isPlaying) return;
        while (this.nextNoteTime < this.ctx.currentTime + this.scheduleAheadTime) {
            this.scheduleNote(this.beatCount, this.nextNoteTime);
            this.nextNoteTime += 60.0 / CONFIG.BPM;
            this.beatCount++;
        }
        window.setTimeout(() => this.scheduler(), this.lookahead);
    },

    scheduleNote(beat, time) {
        // --- MUSIC GENERATION ---
        this.playKick(time);
        if (beat % 1 === 0) this.playHiHat(time + (30 / CONFIG.BPM));

        const measure = Math.floor(beat / 4);
        let freq;
        const elapsed = Game ? Game.elapsed : 0;

        // Dynamic Music Progression
        if (elapsed < CONFIG.PHASE_2_START) {
            // Phase 1: Simple Bass
            freq = measure % 8 < 4 ? 55 : (measure % 8 < 6 ? 65 : 49);
        } else if (elapsed < CONFIG.PHASE_3_START) {
            // Phase 2: Arpeggios
            freq = measure % 4 < 2 ? 45 : 90;
        } else {
            // Phase 3: Chaos
            freq = 40 + (Math.random() * 40);
        }

        if (beat % 2 === 0) this.playTone(freq, 'sawtooth', 0.2, time, 0.4);
        if (beat % 4 === 2) this.playTone(freq * 1.5, 'square', 0.1, time, 0.2);

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
        
        // [FIX A] Create a Sync Point for Game Time
        if (window.Game) {
            window.Game._audioSync = {
                audioStartRealTime: performance.now() / 1000,
                audioStartCtxTime: this.ctx.currentTime
            };
        }

        this.scheduler();
    },

    stop() {
        this.isPlaying = false;
        // [FIX E] Do not suspend context to keep the clock alive, 
        // or rely on Game.getAudioNow() fallback (implemented below).
        // We simply stop scheduling new notes here.
    }
};

/* --- GAME ENGINE --- */
const Game = {
    // -------------------------------------------------------------
    // CONFIGURATION
    // -------------------------------------------------------------
    godMode: false, // FALSE = INSTANT DEATH. TRUE = SANDBOX.

    // TUNING CONSTANTS (Exposed for Phase 3 fix)
    safetyWindowSec: 0.5,      // Lookahead window to check for blocking
    reservationDuration: 1.0,  // How long a seeker reserves a lane
    throttleWindow: 3.0,       // Window to check for density limits
    maxPerWindow: 12,          // Max spawns allowed in throttleWindow for Phase 3
    // -------------------------------------------------------------

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
    pendingSpawns: [],    // Queue for objects waiting for audio time
    laneReservations: [], // NEW: Reserves lanes for sensitive spawns (Seekers)
    preWarns: [],       // Visual ghosts for mobile

    cameraShake: 0,
    bgPulse: 1,
    activeColor: CONFIG.COLORS.p1,
    _audioSync: null,
    getAudioNow() {
        if (AudioEngine && AudioEngine.ctx) {
            if (AudioEngine.ctx.state === 'running') {
                return AudioEngine.ctx.currentTime;
            }
            // Fallback: Calculate time based on the sync point
            if (this._audioSync) {
                return this._audioSync.audioStartCtxTime + ((performance.now() / 1000) - this._audioSync.audioStartRealTime);
            }
        }
        // Final fallback
        return performance.now() / 1000;
    },
    getPendingCountInWindow(windowSec) {
        const now = this.getAudioNow(); // [FIX C]
        return this.pendingSpawns.filter(p => p.time >= now && p.time <= now + windowSec).length;
    },

    // --- SAFETY & THROTTLING HELPERS ---

    /**
     * Checks if a specific lane is safe at a specific Audio Time.
     * Consults pendingSpawns, active obstacles, and laneReservations.
     */
    isLaneSafeAtTime(lane, checkTime) {
        // 1. Check Pending Spawns (Near Future)
        // If something spawns within +/- safetyWindow of checkTime, it's a conflict
        const pendingConflict = this.pendingSpawns.some(p =>
            p.val === lane && Math.abs(p.time - checkTime) < this.safetyWindowSec
        );
        if (pendingConflict) return false;

        // 2. Check Lane Reservations (Seekers)
        const reservationConflict = this.laneReservations.some(r =>
            r.lane === lane && checkTime >= r.time && checkTime < r.expire
        );
        if (reservationConflict) return false;

        // 3. Check Active Obstacles (Current)
        // A crude check: if an obstacle is in this lane and not passed
        // For strict Phase 3 safety, we treat any active object in the lane as "busy"
        const activeConflict = this.obstacles.some(o =>
            !o.passed && o.lane === lane
        );
        if (activeConflict) return false;

        return true;
    },

    /**
     * Counts how many spawns are pending in the next 'windowSec' seconds.
     */
    getPendingCountInWindow(windowSec) {
        const now = (AudioEngine.ctx) ? AudioEngine.ctx.currentTime : 0;
        return this.pendingSpawns.filter(p => p.time >= now && p.time <= now + windowSec).length;
    },

    /**
     * Helper: Ensures that within the next windowSec seconds, every lane has at least
     * one obstacle scheduled or currently active.
     */
    ensureCoverage(spawnAnchor, windowSec) {
        const beatSec = 60 / CONFIG.BPM;
        const limitTime = spawnAnchor + windowSec;
        const coveredLanes = new Set();

        // 1. Check Pending Spawns (future)
        this.pendingSpawns.forEach(p => {
            if (p.time >= spawnAnchor && p.time <= limitTime) {
                coveredLanes.add(p.val); // p.val is the lane index
            }
        });

        // 2. Check Active Obstacles
        this.obstacles.forEach(o => {
            if (!o.passed && typeof o.lane === 'number') {
                coveredLanes.add(o.lane);
            }
        });

        // 3. Identify Missing Lanes
        const missingLanes = [];
        for (let i = 0; i < CONFIG.LANE_COUNT; i++) {
            if (!coveredLanes.has(i)) missingLanes.push(i);
        }

        // 4. Safety Cap: Don't flood if there are already too many spawns
        if (this.getPendingCountInWindow(windowSec) >= this.maxPerWindow) return;

        // 5. Schedule Missing Lanes
        missingLanes.forEach(lane => {
            // Enhanced Safety Check before filling gap
            if (!this.isLaneSafeAtTime(lane, spawnAnchor)) return;

            const maxBeats = Math.max(1, Math.floor(windowSec / beatSec));
            const randomBeatOffset = Math.floor(Math.random() * maxBeats) * beatSec;
            const jitter = (Math.random() - 0.5) * beatSec * 0.2;

            let targetTime = spawnAnchor + randomBeatOffset + jitter;
            this.queueObstacle(targetTime, lane, 'normal');
        });
    },

    /**
     * Helper: Picks 'count' distinct random numbers from 0..LANE_COUNT-1
     */
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

        // Swipe Logic
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

        // Touch Buttons
        // safe bind helper
const safeAddEvent = (el, ev, fn, opts) => { if (el) el.addEventListener(ev, fn, opts); };

// ... inside setupInputs()

safeAddEvent(document.getElementById('start-btn'), 'click', () => this.start());
safeAddEvent(document.getElementById('restart-btn'), 'click', () => this.start());

const leftBtn = document.getElementById('touch-left');
if (leftBtn) leftBtn.addEventListener('touchstart', (e) => { e.preventDefault(); if (this.controlMode === 'buttons') handleInput(-1); }, { passive: false });

const rightBtn = document.getElementById('touch-right');
if (rightBtn) rightBtn.addEventListener('touchstart', (e) => { e.preventDefault(); if (this.controlMode === 'buttons') handleInput(1); }, { passive: false });

// ctrl-btns (querySelectorAll is safe but check length)
const ctrlBtns = document.querySelectorAll('.ctrl-btn');
if (ctrlBtns && ctrlBtns.length) {
  ctrlBtns.forEach(btn => {
    btn.addEventListener('click', (e) => this.setControlMode(e.target.dataset.mode));
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
        
        // [FIX H] Reset transform before scaling to prevent compounding "zooming out" bug
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); 
        
        this.player.y = this.height - 120;

        // Mobile Rotation Lock
        const lockScreen = document.getElementById('rotate-message');
        if (this.isMobile && this.height > this.width) {
            this.isPaused = true;
            lockScreen.style.display = 'flex';
            // [FIX E] Removed ctx.suspend() here so game clock doesn't desync
        } else {
            this.isPaused = false;
            lockScreen.style.display = 'none';
        }
    },

    setControlMode(mode) {
        this.controlMode = mode;
        document.querySelectorAll('.ctrl-btn').forEach(btn => {
            btn.classList.toggle('selected', btn.dataset.mode === mode);
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
            this.checkMobile();
            this.resize();
            this.isRunning = true;
            this.lives = 10;
            document.getElementById('lives-count').innerText = this.lives;
            this.obstacles = [];
            this.pendingSpawns = [];
            this.laneReservations = []; // Reset reservations
            this.preWarns = [];
            this.particles = [];
            this.elapsed = 0;
            this.phase = 1;
            this.player.x = 0.5;
            this.player.targetX = 0.5;
            this.invincibleTime = 0;
            this.activeColor = CONFIG.COLORS.p1;
            this.bgPulse = 1;

            document.getElementById('start-screen').classList.add('hidden');
            document.getElementById('game-over-screen').classList.add('hidden');
            document.getElementById('hud').classList.remove('hidden');

            this.setControlMode(this.controlMode); // Refresh UI visibility
            document.getElementById('phase-text').innerText = "PHASE 1: SOLAR";
            document.getElementById('phase-text').style.color = CONFIG.COLORS.p1;

            AudioEngine.start();
            this.lastTime = performance.now();
        }, 100);
    },

    // -------------------------------------------------------------
    // LOGIC 1: SCHEDULED EVENTS (Lookahead ~0.6s)
    // -------------------------------------------------------------
    scheduleEvent(beat, spawnTime) {
        if (!this.isRunning) return;

        const isSafeToSpawn = (t, lane) => {
            return this.isLaneSafeAtTime(lane, t);
        };

        // --- PHASE 1: GUARANTEED COVERAGE ---
        if (this.phase === 1) {
            // [FIX B] Use Game.elapsed (game time) to calculate time until phase switch
            const secsUntilPhase2 = CONFIG.PHASE_2_START - this.elapsed;
            
            if (secsUntilPhase2 > 0) {
                // Schedule coverage for the remaining time in this phase
                this.ensureCoverage(spawnTime, Math.min(5, secsUntilPhase2));
                
                if (beat % 1 === 0 && Math.random() > 0.3) {
                    const lane = Math.floor(Math.random() * CONFIG.LANE_COUNT);
                    if (isSafeToSpawn(spawnTime, lane)) {
                        this.queueObstacle(spawnTime, lane, 'normal');
                    }
                }
            }
        }
        // ... Phase 2 and 3 logic remains mostly the same, 
        // just ensure they don't use absolute timestamps for phase logic checks ...
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
            // ... (Keep existing Phase 3 logic) ...
            // Just ensure ensureCoverage is called correctly
             const pendingInWindow = this.getPendingCountInWindow(this.throttleWindow);
            if (pendingInWindow >= this.maxPerWindow) return;

            this.ensureCoverage(spawnTime, 5);
            // ... rest of phase 3 code ...
            if (beat % 1 === 0 && Math.random() > 0.3) {
                const lane = Math.floor(Math.random() * CONFIG.LANE_COUNT);
                if (isSafeToSpawn(spawnTime, lane)) this.queueObstacle(spawnTime, lane, 'normal');
            }
            if (beat % 8 === 0) {
                const seekerLane = 2;
                if (isSafeToSpawn(spawnTime, seekerLane)) {
                    this.queueObstacle(spawnTime, seekerLane, 'seeker');
                    this.laneReservations.push({
                        lane: seekerLane, time: spawnTime, expire: spawnTime + this.reservationDuration
                    });
                }
            }
        }
    },


    queueObstacle(time, val, type) {
        // Add to pending spawns
        this.pendingSpawns.push({
            time: time,
            val: val,
            type: type || 'normal'
        });

        // Add visual pre-warn for mobile/UX — match color/type
        const color = (type === 'neon_block' || type === 'overhang') ? CONFIG.COLORS.p2 : CONFIG.COLORS.p1;

        this.preWarns.push({
            lane: val,
            startTime: (AudioEngine && AudioEngine.ctx) ? AudioEngine.ctx.currentTime : performance.now() / 1000,
            spawnTime: time,
            type: type,
            color: color
        });

        // Keep pending spawns sorted
        this.pendingSpawns.sort((a, b) => a.time - b.time);
    },


    // -------------------------------------------------------------
    // LOGIC 2: PHYSICAL SPAWNING (Exact Audio Time)
    // -------------------------------------------------------------
    spawnObstacle(val, type) {
        const laneW = this.width / CONFIG.LANE_COUNT;

        // Default properties (pixel-space)
        let obs = {
            lane: val,
            x: val * laneW,
            y: -100, // Standard spawn height
            w: laneW,
            h: 40,
            vy: 1.0, // normalized fall-speed multiplier
            type: type || 'normal',
            passed: false,
            color: CONFIG.COLORS.p1
        };

        // Handle Types
        if (type === 'neon_block') {
            obs.color = CONFIG.COLORS.p2; // Neon color
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

        // Seekers
        if (type === 'seeker') {
            obs = Object.assign(obs, {
                x: (val * laneW) + (laneW / 2) - 20, // Centered in spawned lane
                y: -100,
                w: 40,
                h: 40,
                type: 'seeker',
                vy: 0.8,
                color: CONFIG.COLORS.p3,
                laneIndex: val // Start at spawned lane
            });
        }

        this.obstacles.push(obs);
    },

    // -------------------------------------------------------------
    // LOGIC 3: VISUAL BEAT PULSE & PHASE LOGIC
    // -------------------------------------------------------------
    onBeat(beat) {
        if (!this.isRunning) return;
        this.bgPulse = 1.15;
        this.cameraShake = 5;

        // Phase Transitions
        if (this.elapsed > CONFIG.PHASE_3_START && this.phase !== 3) {
            this.phase = 3;
            this.triggerPhaseShift(CONFIG.COLORS.p3, "PHASE 3: VOID");
        } else if (this.elapsed > CONFIG.PHASE_2_START && this.phase === 1) {
            this.phase = 2;
            this.triggerPhaseShift(CONFIG.COLORS.p2, "PHASE 2: NEON");
        }

        // --- PHASE 3 MECHANIC: SMART SEEKER MOVE ---
        if (this.phase === 3) {
            const laneW = this.width / CONFIG.LANE_COUNT;
            const currentTime = AudioEngine.ctx.currentTime;

            this.obstacles.forEach(o => {
                if (o.type === 'seeker') {
                    // 1. Calculate Est. Arrival Time at Player Y
                    // Distance / Speed. Speed = BASE * PhaseMult(1.3) * vy
                    const distToPlayer = this.player.y - o.y;
                    const speedPxPerSec = CONFIG.BASE_SCROLL_SPEED * 1.3 * o.vy;
                    const timeToImpact = (distToPlayer > 0) ? distToPlayer / speedPxPerSec : 0;
                    const arrivalTime = currentTime + timeToImpact;

                    // 2. Determine Desired Lane (Towards Player)
                    const playerLane = Math.floor(this.player.x * CONFIG.LANE_COUNT);
                    let targetLane = o.laneIndex;
                    if (o.laneIndex < playerLane) targetLane++;
                    else if (o.laneIndex > playerLane) targetLane--;

                    // 3. Validate Target Lane (Is it safe at arrivalTime?)
                    // If target lane is blocked, fallback to nearest safe lane
                    let chosenLane = -1;

                    // Priority 1: Target Lane
                    if (this.isLaneSafeAtTime(targetLane, arrivalTime)) {
                        chosenLane = targetLane;
                    }
                    // Priority 2: Stay in current Lane
                    else if (this.isLaneSafeAtTime(o.laneIndex, arrivalTime)) {
                        chosenLane = o.laneIndex;
                    }
                    // Priority 3: Search Radius 1 (Left/Right)
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

                    // 4. Apply Move (if valid)
                    if (chosenLane !== -1) {
                        o.laneIndex = chosenLane;
                        // Add temporary reservation for the new lane to prevent other Seekers swarming
                        this.laneReservations.push({
                            lane: chosenLane,
                            time: currentTime,
                            expire: currentTime + 0.5
                        });
                    } else {
                        // All blocked? Skip move.
                        if (Math.random() < 0.05) console.log('[DEBUG] Seeker skipped move (Blocked)');
                    }

                    // 5. Update Visual Target X
                    o.targetX = o.laneIndex * laneW + (laneW / 2) - (o.w / 2);

                    // Visual Flair on beat
                    this.particles.push({
                        x: o.x + o.w / 2, y: o.y + o.h / 2,
                        vx: 0, vy: 0, life: 0.3, color: o.color
                    });
                }
            });
        }
    },

    triggerPhaseShift(color, text) {
        this.activeColor = color;
        const flash = document.getElementById('flash-layer');
        flash.style.opacity = 0.8;
        setTimeout(() => flash.style.opacity = 0, 300);
        document.getElementById('phase-text').innerText = text;
        document.getElementById('phase-text').style.color = color;
        this.cameraShake = 30;
    },

    // -------------------------------------------------------------
    // GAME LOOP (Dt)
    // -------------------------------------------------------------
    loop(t) {
        // ensure we always schedule the next frame so loop never dies
        requestAnimationFrame((t) => this.loop(t));

        // initialize lastTime if needed to avoid giant dt on first frame
        if (!this.lastTime) this.lastTime = t;
        const dt = Math.min((t - this.lastTime) / 1000, 0.1);
        this.lastTime = t;

        // update + draw only when running (but keep scheduling frames regardless)
        if (this.isRunning && !this.isPaused) {
            this.update(dt);
        }
        this.draw();
    },

    update(dt) {
        this.elapsed += dt;
        if (this.invincibleTime > 0) this.invincibleTime -= dt;

        // 1. Spawner Queue Processing
        const audioTime = AudioEngine.ctx.currentTime;
        for (let i = this.pendingSpawns.length - 1; i >= 0; i--) {
            if (audioTime >= this.pendingSpawns[i].time) {
                const s = this.pendingSpawns[i];
                this.spawnObstacle(s.val, s.type);
                this.pendingSpawns.splice(i, 1);
            }
        }

        // Cleanup expired lane reservations
        for (let i = this.laneReservations.length - 1; i >= 0; i--) {
            if (audioTime >= this.laneReservations[i].expire) {
                this.laneReservations.splice(i, 1);
            }
        }

        // 2. Pre-warn cleanup
        for (let i = this.preWarns.length - 1; i >= 0; i--) {
            if (audioTime >= this.preWarns[i].spawnTime) this.preWarns.splice(i, 1);
        }

        // 3. Player Physics
        const targetPixelX = (this.player.targetX * this.width) - (this.player.w / 2);
        const currentPixelX = this.player.x * this.width;
        const newPixelX = currentPixelX + (targetPixelX - currentPixelX) * 10 * dt;
        this.player.x = newPixelX / this.width;
        this.player.tilt *= 0.9;

        // PLAYER TRAIL (VISUAL ONLY)
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

        // 4. Obstacle Logic
        for (let i = this.obstacles.length - 1; i >= 0; i--) {
            let o = this.obstacles[i];

            // Vertical movement (time-based)
            const speedMult = (this.phase === 3) ? 1.3 : 1.0;
            o.y += (CONFIG.BASE_SCROLL_SPEED * speedMult * o.vy) * dt;

            // Seeker Lateral Interpolation (Smoothly slide to the beat-determined lane)
            if (o.type === 'seeker' && o.targetX !== undefined) {
                o.x += (o.targetX - o.x) * 15 * dt;
            }

            // Cleanup
            if (o.y > this.height) {
                this.obstacles.splice(i, 1);
                continue;
            }

            // COLLISION CHECK
            if (this.checkCollision(this.player, o)) {
                this.handleCollision(o, i);
            }
        }

        // 5. Particles
        for (let i = this.particles.length - 1; i >= 0; i--) {
            let p = this.particles[i];
            p.x += p.vx; p.y += p.vy; p.life -= dt;
            if (p.life <= 0) this.particles.splice(i, 1);
        }

        // FX Decay
        if (this.cameraShake > 0) this.cameraShake *= 0;
        if (this.bgPulse > 1) this.bgPulse -= dt;
    },

    // CHECK COLLISION (Simple Box Overlap)
    checkCollision(p, o) {
        return (p.x * this.width < o.x + o.w &&
            p.x * this.width + p.w > o.x &&
            p.y < o.y + o.h &&
            p.y + p.h > o.y);
    },

    // HANDLE COLLISION (LIVES LOGIC)
    handleCollision(o, index) {
        // 1. If invincible or God Mode, ignore damage
        if (this.invincibleTime > 0 || this.godMode) return;

        // 2. Take Damage
        this.lives--;
        document.getElementById('lives-count').innerText = this.lives;

        // 3. Visual Feedback (Screen Flash & Shake)
        const flash = document.getElementById('flash-layer');
        flash.style.opacity = 0.6;
        setTimeout(() => flash.style.opacity = 0, 100);
        this.cameraShake = 20;

        // 4. Remove the object that hit us
        this.obstacles.splice(index, 1);

        // 5. Check Life Status
        if (this.lives > 0) {
            // SURVIVED: Grant temporary invincibility
            this.invincibleTime = 2.0;
        } else {
            // DIED: Game Over
            this.gameOver();
        }
    },

    gameOver() {
        this.isRunning = false;
        AudioEngine.stop();
        document.getElementById('hud').classList.add('hidden');
        document.getElementById('game-over-screen').classList.remove('hidden');
        document.getElementById('final-time').innerText = this.elapsed.toFixed(2);
    },

    triggerGameOver() {
        this.isRunning = false;
        AudioEngine.stop();

        // FX
        this.cameraShake = 50;
        this.createExplosion(this.player.x * this.width, this.player.y, CONFIG.COLORS.player);

        // Show Screen
        setTimeout(() => {
            document.getElementById('hud').classList.add('hidden');
            document.getElementById('mobile-controls').classList.add('hidden');
            document.getElementById('game-over-screen').classList.remove('hidden');
            document.getElementById('final-time').innerText = this.elapsed.toFixed(2);

            const e = this.elapsed;
            let rank = "F";
            if (e > 30) rank = "C";
            if (e > 60) rank = "B";
            if (e > 90) rank = "A";
            if (e >= 120) rank = "S";
            document.getElementById('rank-display').innerText = `RANK: ${rank}`;
        }, 100);
    },

    createExplosion(x, y, color) {
        for (let i = 0; i < 20; i++) {
            this.particles.push({
                x: x, y: y,
                vx: (Math.random() - 0.5) * 15,
                vy: (Math.random() - 0.5) * 15,
                life: 1.0,
                color: color
            });
        }
    },

    draw() {
        // Clear
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(0, 0, this.width, this.height);

        // Shake
        this.ctx.save();
        if (this.cameraShake > 0.5) {
            const rx = (Math.random() - 0.5) * this.cameraShake;
            const ry = (Math.random() - 0.5) * this.cameraShake;
            this.ctx.translate(rx, ry);
        }

        // Grid (RESTORED NEON FLOOR)
        this.ctx.strokeStyle = this.activeColor;
        this.ctx.lineWidth = 2.5 * this.bgPulse;
        this.ctx.globalAlpha = 0.25;

        const laneW = this.width / CONFIG.LANE_COUNT;

        // Vertical lanes
        for (let i = 1; i < CONFIG.LANE_COUNT; i++) {
            this.ctx.beginPath();
            this.ctx.moveTo(i * laneW, 0);
            this.ctx.lineTo(i * laneW, this.height);
            this.ctx.stroke();
        }

        // Horizontal scrolling floor lines
        const gridSize = 90;
        // const offset = this.gridOffset % gridSize; // gridOffset undefined in source, assuming 0/visual effect handled elsewhere or static
        const offset = (this.elapsed * 100) % gridSize;

        for (let y = -gridSize; y < this.height; y += gridSize) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, y + offset);
            this.ctx.lineTo(this.width, y + offset);
            this.ctx.stroke();
        }

        this.ctx.globalAlpha = 1;


        // Pre-Warns (Ghosts) — only when AudioEngine has a valid audio clock
        // Draw Mobile Ghosts (Warnings)
        this.ctx.globalAlpha = 0.15;
        this.preWarns.forEach(w => {
            this.ctx.fillStyle = w.color; // <--- USE THE SAVED COLOR HERE
            this.ctx.fillRect(w.lane * laneW, 0, laneW, this.height);
            this.ctx.fillStyle = '#fff';
        });
        if (AudioEngine && AudioEngine.ctx) {
            const now = AudioEngine.ctx.currentTime;
            this.preWarns.forEach(w => {
                const timeLeft = w.spawnTime - now;
                const progress = 1 - timeLeft * 2; // maps 0.5s->0 .. 0s->1
                if (progress > 0) {
                    const y = this.height * 0.2 * Math.min(1, progress); // clamp
                    this.ctx.fillRect(w.lane * laneW, y, laneW, this.height);
                }
            });
        }

        // Player
        this.ctx.globalAlpha = (this.invincibleTime > 0 && this.invincibleTime * 10 % 2 > 1) ? 0.5 : 1;
        this.ctx.fillStyle = CONFIG.COLORS.player;
        this.ctx.shadowBlur = 20;
        this.ctx.shadowColor = CONFIG.COLORS.player;

        // PLAYER GLOW HALO (behind player)
        const px = this.player.x * this.width;
        // Player body
        this.ctx.save();
        this.ctx.translate(px + this.player.w / 2, this.player.y + this.player.h / 2);
        this.ctx.rotate(this.player.tilt * Math.PI / 180);

        this.ctx.shadowBlur = 25 * this.bgPulse;
        this.ctx.shadowColor = CONFIG.COLORS.player;

        // Outer body
        this.ctx.fillStyle = this.invincibleTime > 0
            ? 'rgba(255,204,0,0.4)'
            : CONFIG.COLORS.player;
        this.ctx.fillRect(-this.player.w / 2, -this.player.h / 2, this.player.w, this.player.h);

        // Inner core (contrast)
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillRect(
            -this.player.w / 4,
            -this.player.h / 4,
            this.player.w / 2,
            this.player.h / 2
        );

        this.ctx.restore();
        this.ctx.shadowBlur = 0;



        // Obstacles
        this.ctx.shadowBlur = 10;
        this.obstacles.forEach(o => {
            this.ctx.fillStyle = o.color || '#fff';
            this.ctx.shadowColor = o.color;
            this.ctx.globalAlpha = 1;

            if (o.type === 'seeker') {
                // Diamond shape for seeker
                this.ctx.beginPath();
                this.ctx.moveTo(o.x + o.w / 2, o.y);
                this.ctx.lineTo(o.x + o.w, o.y + o.h / 2);
                this.ctx.lineTo(o.x + o.w / 2, o.y + o.h);
                this.ctx.lineTo(o.x, o.y + o.h / 2);
                this.ctx.fill();
            } else {
                // Standard Rect
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

// initialize the game once DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => Game.init());
} else {
    
  Game.init();
  
}
