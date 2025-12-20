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
        this.scheduler();
    },

    stop() {
        this.isPlaying = false;
        if (this.ctx) this.ctx.suspend();
    }
};

/* --- GAME ENGINE --- */
const Game = {
    // -------------------------------------------------------------
    // CONFIGURATION
    // -------------------------------------------------------------
    godMode: true, // FALSE = INSTANT DEATH. TRUE = SANDBOX.
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
    pendingSpawns: [], // Queue for objects waiting for audio time
    preWarns: [],      // Visual ghosts for mobile

    cameraShake: 0,
    bgPulse: 1,
    activeColor: CONFIG.COLORS.p1,

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
        const bindBtn = (id, dir) => {
            const btn = document.getElementById(id);
            btn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                if (this.controlMode === 'buttons') handleInput(dir);
            }, { passive: false });
        };
        bindBtn('touch-left', -1);
        bindBtn('touch-right', 1);

        // UI Listeners
        document.querySelectorAll('.ctrl-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.setControlMode(e.target.dataset.mode));
        });

        document.getElementById('start-btn').addEventListener('click', () => this.start());
        document.getElementById('restart-btn').addEventListener('click', () => this.start());
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

        // Mobile Rotation Lock
        const lockScreen = document.getElementById('rotate-message');
        if (this.isMobile && this.height > this.width) {
            this.isPaused = true;
            lockScreen.style.display = 'flex';
            if (AudioEngine.ctx) AudioEngine.ctx.suspend();
        } else {
            this.isPaused = false;
            lockScreen.style.display = 'none';
            if (this.isRunning && AudioEngine.ctx) AudioEngine.ctx.resume();
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
            this.obstacles = [];
            this.pendingSpawns = [];
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

        // PHASE 1: SOLAR (Random single lanes)
        if (this.phase === 1) {
            if (beat % 1 === 0 && Math.random() > 0.3) {
                const lane = Math.floor(Math.random() * CONFIG.LANE_COUNT);
                this.queueObstacle(spawnTime, lane, 'normal');
            }
        }

        // PHASE 2: NEON (Rhythm Pressure Lanes)
        // No random spawning. Pattern based on beat count.
        else if (this.phase === 2) {
            if (beat % 2 === 0) {
                // Generate a safe lane based on musical measure, not randomness
                // This creates predictable "dancing" patterns
                const measure = Math.floor(beat / 4);
                const patternIdx = beat % 4; // 0, 1, 2, 3

                let safeLane = 2; // Default center

                // Deterministic patterns
                if (measure % 2 === 0) {
                    // Staircase
                    safeLane = patternIdx + 1; // 1, 2, 3, 4 (clamped to 0-4 below)
                } else {
                    // ZigZag
                    safeLane = (patternIdx % 2 === 0) ? 0 : 4;
                }

                // Clamp safe lane
                if (safeLane > 4) safeLane = 4;

                // Spawn the "Pressure Wall"
                for (let i = 0; i < CONFIG.LANE_COUNT; i++) {
                    if (i !== safeLane) {
                        this.queueObstacle(spawnTime, i, 'neon_block');
                    }
                }
            }
        }

        // PHASE 3: VOID (Music-Shaped Seekers)
        // Spawns enemies that snap to grid on beat
        else if (this.phase === 3) {
            // Background rain
            if (beat % 1 === 0 && Math.random() > 0.5) {
                const lane = Math.floor(Math.random() * CONFIG.LANE_COUNT);
                this.queueObstacle(spawnTime, lane, 'normal');
            }
            // The Seeker
            if (beat % 8 === 0) {
                this.queueObstacle(spawnTime, 2, 'seeker'); // Spawn center
            }
        }
    },

    queueObstacle(time, val, type) {
        this.pendingSpawns.push({ time: time, val: val, type: type });
        // Visual warning for mobile players (ghosts)
        if (this.isMobile && (type === 'normal' || type === 'neon_block')) {
            this.preWarns.push({
                spawnTime: time,
                lane: val,
                startTime: time - 0.5
            });
        }
    },

    // -------------------------------------------------------------
    // LOGIC 2: PHYSICAL SPAWNING (Exact Audio Time)
    // -------------------------------------------------------------
    spawnObstacle(val, type) {
        const laneW = this.width / CONFIG.LANE_COUNT;

        if (type === 'normal' || type === 'neon_block') {
            const lane = val;
            this.obstacles.push({
                x: lane * laneW,
                y: -100,
                w: laneW,
                h: type === 'neon_block' ? 60 : 40,
                type: type,
                vx: 0,
                vy: type === 'neon_block' ? 0.9 : 1.0, // Neon falls slightly slower but denser
                color: type === 'neon_block' ? CONFIG.COLORS.p2 : CONFIG.COLORS.p1
            });
        }
        else if (type === 'seeker') {
            this.obstacles.push({
                x: (this.width / 2) - (20),
                y: -100,
                w: 40,
                h: 40,
                type: 'seeker',
                vx: 0,
                vy: 0.8,
                color: CONFIG.COLORS.p3,
                laneIndex: 2 // Start in middle lane
            });
        }
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

        // --- PHASE 3 MECHANIC: SEEKER SNAP ---
        // Iterate through existing seekers and snap them to player lane
        // They only move laterally ON THE BEAT.
        if (this.phase === 3) {
            const laneW = this.width / CONFIG.LANE_COUNT;

            this.obstacles.forEach(o => {
                if (o.type === 'seeker') {
                    // Determine current player lane index
                    const playerLane = Math.floor(this.player.x * CONFIG.LANE_COUNT);

                    // Simple AI: Move 1 lane toward player
                    if (o.laneIndex < playerLane) o.laneIndex++;
                    else if (o.laneIndex > playerLane) o.laneIndex--;

                    // Update visual target X (Collision logic uses actual X, so we must interpolate or snap)
                    // For "Music-Shaped", we snap the target, update calculates position
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

// 🔥 RESTORE PLAYER TRAIL (VISUAL ONLY)
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

    checkCollision(p, o) {
        // Player is normalized 0-1, Obstacles are pixels. Convert Player to pixels.
        const px = p.x * this.width;
        const py = p.y;
        // Hitbox reduction for fairness
        const padding = 5;
        return (px + padding < o.x + o.w - padding &&
            px + p.w - padding > o.x + padding &&
            py + padding < o.y + o.h - padding &&
            py + p.h - padding > o.y + padding);
    },

    // -------------------------------------------------------------
    // CRITICAL: GOD MODE vs NORMAL MODE LOGIC
    // -------------------------------------------------------------
    handleCollision(o, index) {
        if (this.godMode) {
            // GOD MODE BEHAVIOR (Sandbox/Debug)
            if (this.invincibleTime <= 0) {
                this.cameraShake = 20;
                this.invincibleTime = 1.0;
                this.createExplosion(o.x + o.w / 2, o.y + o.h / 2, o.color);
                this.obstacles.splice(index, 1); // Destroy obstacle
            }
        } else {
            // NORMAL MODE BEHAVIOR (Instant Death)
            // No invincibility check. No second chance.
            this.triggerGameOver();
        }
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
        const offset = this.gridOffset % gridSize;

        for (let y = -gridSize; y < this.height; y += gridSize) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, y + offset);
            this.ctx.lineTo(this.width, y + offset);
            this.ctx.stroke();
        }

        this.ctx.globalAlpha = 1;


        // Pre-Warns (Ghosts) — only when AudioEngine has a valid audio clock
        this.ctx.globalAlpha = 0.15;
        this.ctx.fillStyle = '#fff';
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
                this.ctx.fillRect(o.x, o.y, o.w, o.h);
            }
        });

        // Particles
        this.particles.forEach(p => {
            this.ctx.fillStyle = p.color;
            this.ctx.globalAlpha = p.life;
            this.ctx.fillRect(p.x, p.y, 4, 4);
        });

        this.ctx.restore();

        // HUD Update
        const hudScore = document.getElementById('score');
        if (hudScore) hudScore.innerText = this.elapsed.toFixed(2);
        const bar = document.getElementById('progress-fill');
        if (bar) bar.style.width = Math.min(100, (this.elapsed / CONFIG.TOTAL_DURATION) * 100) + '%';
    }
};

// Initial Start
Game.init();