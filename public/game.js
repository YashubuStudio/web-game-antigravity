const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

const startScreen = document.getElementById('start-screen');
const gameUi = document.getElementById('game-ui');
const nameInput = document.getElementById('player-name');
const colorInput = document.getElementById('player-color');
const startBtn = document.getElementById('start-btn');
const matchLeaderboardDiv = document.getElementById('match-leaderboard-content');
const statusMsg = document.getElementById('status-message');
const cooldownSpan = document.querySelector('#cooldown-display span');
const minimapCanvas = document.getElementById('minimap-canvas');
const minimapCtx = minimapCanvas.getContext('2d');
const deathScreen = document.getElementById('death-screen');
const deathKiller = document.getElementById('death-killer');
const respawnTimerSpan = document.querySelector('#respawn-timer span');
const respawnBtn = document.getElementById('respawn-btn');
const spectatorMsg = document.getElementById('spectator-msg');

// Lobby info elements
const lobbyActiveEl = document.getElementById('lobby-active');
const lobbyMaxEl = document.getElementById('lobby-max');
const lobbySpectatorEl = document.getElementById('lobby-spectator');

let socket;
let myId = null;
let gameState = { players: {} };
let arenaRadius = 1700;

// Mouse tracking
let mouseX = 0;
let mouseY = 0;
let isDashing = false;
let dashCooldownEnd = 0;

// Camera
let camera = { x: 0, y: 0 };

// Interpolation map for smooth rendering
let renderState = { players: {} };
const INTERP_SPEED = 0.3; // Lower value = smoother but more lag behind server

// External Ranking API URl (Make sure this matches your deployed get_ranking.php URL)
const RANKING_API_URL = 'http://localhost/get_ranking.php';

function fetchGlobalRanking() {
    fetch(RANKING_API_URL)
        .then(response => response.json())
        .then(data => {
            if (data.success && data.data) {
                const list = document.getElementById('global-ranking-list');
                list.innerHTML = '';
                data.data.forEach((r, index) => {
                    list.innerHTML += `<li><span>${index + 1}. ${r.player_name}</span> <span>${r.kills} Kills</span></li>`;
                });
            }
        })
        .catch(err => {
            console.log('ランキング取得エラー:', err);
            document.getElementById('global-ranking-list').innerHTML = '<li>Error loading ranks</li>';
        });
}

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    if (minimapCanvas) {
        const rect = minimapCanvas.getBoundingClientRect();
        const size = Math.floor(Math.min(rect.width, rect.height));
        if (size > 0) {
            minimapCanvas.width = size;
            minimapCanvas.height = size;
        }
    }
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function connect() {
    socket = io();

    socket.on('connect', () => {
        console.log('Connected to server');
        fetchGlobalRanking(); // Fetch when connected
    });

    socket.on('joined', (data) => {
        myId = data.id;
        arenaRadius = data.arenaRadius;
        startScreen.style.display = 'none';
        deathScreen.style.display = 'none';
        gameUi.style.display = 'block';
        requestAnimationFrame(renderLoop);
    });
    
    socket.on('serverMessage', (msg) => {
        spectatorMsg.textContent = msg;
        spectatorMsg.style.display = 'block';
    });
    
    socket.on('killLog', (data) => {
        // Only show if killer is present
        if (data.killer) {
            statusMsg.textContent = `${data.killer} KILLED ${data.victim}!`;
            statusMsg.style.color = '#ff0000';
            setTimeout(() => { statusMsg.textContent = ""; }, 3000);
        }
        
        // Handle death screen for this client
        if (myId && gameState.players[myId] && gameState.players[myId].name === data.victim) {
            showDeathScreen(data.killer);
        }
    });

    socket.on('lobbyState', (state) => {
        if (lobbyActiveEl) {
            lobbyActiveEl.textContent = state.active;
            lobbyMaxEl.textContent = state.max;
            lobbySpectatorEl.textContent = state.spectator;
        }
    });

    socket.on('gameState', (state) => {
        gameState = state;
        updateLeaderboard();
        updateHUD();
        
        // Initialize render state for new players or hard sync if too far off
        for (let uid in gameState.players) {
            const serverP = gameState.players[uid];
            if (!renderState.players[uid]) {
                // First time seeing this player, hard sync position
                renderState.players[uid] = { x: serverP.x, y: serverP.y };
            } else {
                // If they teleported or moved too fast (e.g. respawn), hard sync
                const distSq = Math.pow(serverP.x - renderState.players[uid].x, 2) + Math.pow(serverP.y - renderState.players[uid].y, 2);
                if (distSq > 100000) { // e.g. >316 pixels jump instantly
                    renderState.players[uid].x = serverP.x;
                    renderState.players[uid].y = serverP.y;
                }
            }
        }
    });

    socket.on('disconnect', () => {
        console.log('Disconnected');
        statusMsg.textContent = "サーバーから切断されました";
    });
}

function showDeathScreen(killerName) {
    gameUi.style.display = 'none';
    deathScreen.style.display = 'block';
    if (killerName) {
        deathKiller.textContent = `Killed by: ${killerName}`;
    } else {
        deathKiller.textContent = `Died to Area Damage`;
    }
    
    respawnBtn.style.display = 'none';
    document.getElementById('respawn-timer').style.display = 'block';
    
    let timer = 5;
    respawnTimerSpan.textContent = timer;
    const interval = setInterval(() => {
        timer--;
        respawnTimerSpan.textContent = timer;
        if (timer <= 0) {
            clearInterval(interval);
            document.getElementById('respawn-timer').style.display = 'none';
            respawnBtn.style.display = 'inline-block';
        }
    }, 1000);
}

function updateHUD() {
    const me = gameState.players[myId];
    if (!me || me.isSpectator || me.hp <= 0) return;
    
    // Calculate Dash Cooldown
    const now = Date.now();
    let cdLeft = Math.max(0, (me.lastDash + 2000 - now) / 1000); // 2000ms cooldown
    
    if (cdLeft === 0) {
        cooldownSpan.textContent = "READY";
        cooldownSpan.style.color = "#00ffff";
    } else {
        // Show 1 decimal place
        cooldownSpan.textContent = cdLeft.toFixed(1) + "s";
        cooldownSpan.style.color = "#ff00ff";
    }
}

function updateLeaderboard() {
    let html = '';
    const playersArr = Object.values(gameState.players)
        .filter(p => !p.isSpectator)
        .sort((a,b) => {
            if (a.kills !== b.kills) return b.kills - a.kills;
            return b.hp - a.hp;
        });
    
    playersArr.forEach((p, index) => {
        let crown = (index === 0 && p.kills > 0) ? "👑 " : "";
        html += `<div class="player-score" style="color:${p.id === myId ? '#00ffff' : 'white'}">
            <span>${crown}${index + 1}. ${p.name} [Kills: ${p.kills}]</span>
            <span>HP: ${Math.round(p.hp)}</span>
        </div>`;
    });
    
    matchLeaderboardDiv.innerHTML = html;
}

startBtn.addEventListener('click', () => {
    joinGame();
});

respawnBtn.addEventListener('click', () => {
    joinGame();
});

function joinGame() {
    const name = nameInput.value.trim() || 'Guest';
    const color = colorInput.value;
    if (!socket) connect();
    socket.emit('joinGame', { name: name, color: color });
}

// Input handling (Desktop)
document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX - canvas.width / 2;
    mouseY = e.clientY - canvas.height / 2;
});

document.addEventListener('mousedown', (e) => {
    if (e.target === canvas || e.target === document.body) {
        if (e.button === 0) {
            isDashing = true;
        }
    }
});
document.addEventListener('mouseup', (e) => {
    if (e.button === 0) {
        isDashing = false;
    }
});

// Input handling (Mobile Touch)
document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 0) {
        // Prevent scrolling when touching canvas
        if (e.target === canvas) e.preventDefault();
        
        const touch = e.touches[0];
        mouseX = touch.clientX - canvas.width / 2;
        mouseY = touch.clientY - canvas.height / 2;
    }
}, { passive: false });

document.addEventListener('touchstart', (e) => {
    if (e.target === canvas || e.target === document.body) {
        if (e.touches.length > 0) {
            const touch = e.touches[0];
            mouseX = touch.clientX - canvas.width / 2;
            mouseY = touch.clientY - canvas.height / 2;
        }
        
        // Always trigger dash on new touch if game is active
        if (gameState && gameState.players[myId] && gameState.players[myId].hp > 0 && !gameState.players[myId].isSpectator) {
             isDashing = true;
        }
    }
}, { passive: false });

document.addEventListener('touchend', (e) => {
    isDashing = false;
});

// Send input to server continually
setInterval(() => {
    if (socket && myId && gameState.players[myId]) {
        // Only send if alive
        if (gameState.players[myId].hp > 0 && !gameState.players[myId].isSpectator) {
            socket.emit('input', {
                mouseX: mouseX,
                mouseY: mouseY,
                dash: isDashing
            });
            isDashing = false; // Reset dash flag after sending
        }
    }
}, 1000 / 30); // 30Hz input rate

function drawShape(ctx, shapeSides, x, y, radius, color, dashState) {
    ctx.beginPath();
    
    if (shapeSides < 3) {
        // Circle (0-2 kills)
        ctx.arc(x, y, radius, 0, Math.PI * 2);
    } else {
        // Polygon (3=Triangle, 4=Square, etc.)
        const angleStep = (Math.PI * 2) / shapeSides;
        // Offset so shapes point upwards
        const offset = Math.PI / 2;
        
        for (let i = 0; i < shapeSides; i++) {
            const rx = x + Math.cos(i * angleStep - offset) * radius;
            const ry = y + Math.sin(i * angleStep - offset) * radius;
            if (i === 0) ctx.moveTo(rx, ry);
            else ctx.lineTo(rx, ry);
        }
        ctx.closePath();
    }
    
    ctx.fillStyle = color;
    
    // State-based visual changes
    if (dashState === 'dashing') {
        ctx.shadowBlur = 30;
        ctx.shadowColor = '#ffffff';
        ctx.fillStyle = '#ffffff'; // Flash white
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 4;
        ctx.globalAlpha = 1.0;
    } else if (dashState === 'cooldown') {
        ctx.shadowBlur = 0;
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.4; // Dimmed when on cooldown
    } else { // ready
        ctx.shadowBlur = 15;
        ctx.shadowColor = color;
        ctx.fillStyle = color;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.globalAlpha = 1.0;
    }
    
    ctx.fill();
    ctx.stroke();
    
    // Reset global styles
    ctx.globalAlpha = 1.0;
    ctx.shadowBlur = 0; 
}

function renderMinimap() {
    if (!minimapCtx) return;
    
    // Clear minimizing map
    minimapCtx.clearRect(0, 0, minimapCanvas.width, minimapCanvas.height);
    
    const mapSize = Math.min(minimapCanvas.width, minimapCanvas.height);
    const scale = mapSize / (arenaRadius * 2);
    const centerX = minimapCanvas.width / 2;
    const centerY = minimapCanvas.height / 2;
    const mapRadius = (mapSize / 2) - 2;
    
    // Draw arena bounds
    minimapCtx.beginPath();
    minimapCtx.arc(centerX, centerY, mapRadius, 0, Math.PI*2);
    minimapCtx.strokeStyle = 'rgba(255, 0, 255, 0.5)';
    minimapCtx.stroke();
    
    // Draw players
    for (const uid in gameState.players) {
        const p = gameState.players[uid];
        if (p.hp <= 0 || p.isSpectator) continue;
        
        const mx = centerX + (p.x * scale);
        const my = centerY + (p.y * scale);
        
        minimapCtx.beginPath();
        minimapCtx.arc(mx, my, uid === myId ? 4 : 3, 0, Math.PI * 2);
        minimapCtx.fillStyle = uid === myId ? '#00ffff' : p.color;
        minimapCtx.fill();
    }
}

function renderLoop() {
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const me = gameState.players[myId];
    
    // Update render state (interpolation)
    for (let uid in gameState.players) {
        const serverP = gameState.players[uid];
        if (!renderState.players[uid]) {
            // Initialize renderState for new players
            renderState.players[uid] = { x: serverP.x, y: serverP.y };
        } else {
            // Lerp towards server position
            renderState.players[uid].x += (serverP.x - renderState.players[uid].x) * INTERP_SPEED;
            renderState.players[uid].y += (serverP.y - renderState.players[uid].y) * INTERP_SPEED;
        }
    }

    // Update camera to follow player (using interpolated position for smoothness)
    if (me && !me.isSpectator && me.hp > 0 && renderState.players[myId]) {
        camera.x += (renderState.players[myId].x - camera.x) * 0.1;
        camera.y += (renderState.players[myId].y - camera.y) * 0.1;
    }

    ctx.save();
    // Translate to center and apply camera
    ctx.translate(canvas.width / 2 - camera.x, canvas.height / 2 - camera.y);

    // Draw grid (background) completely static
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    const gridSize = 100;
    const offset = 2000;
    ctx.beginPath();
    for (let x = -offset; x <= offset; x += gridSize) {
        ctx.moveTo(x, -offset);
        ctx.lineTo(x, offset);
    }
    for (let y = -offset; y <= offset; y += gridSize) {
        ctx.moveTo(-offset, y);
        ctx.lineTo(offset, y);
    }
    ctx.stroke();

    // Draw Arena Boundary
    ctx.beginPath();
    ctx.arc(0, 0, arenaRadius, 0, Math.PI * 2);
    ctx.strokeStyle = '#ff00ff';
    ctx.lineWidth = 5;
    ctx.shadowBlur = 20;
    ctx.shadowColor = '#ff00ff';
    ctx.stroke();
    // Inner danger zone tint
    ctx.fillStyle = 'rgba(255, 0, 255, 0.02)';
    ctx.fill();
    ctx.shadowBlur = 0; // Reset

    // Determine Top Player for Crown
    let topPlayerId = null;
    let maxKills = -1;
    let maxHp = -1;
    for (const uid in gameState.players) {
        const p = gameState.players[uid];
        if (p.isSpectator || p.hp <= 0) continue;
        
        if (p.kills > maxKills || (p.kills === maxKills && p.hp > maxHp)) {
            maxKills = p.kills;
            maxHp = p.hp;
            topPlayerId = uid;
        }
    }

    // Draw Players
    for (const uid in gameState.players) {
        const p = gameState.players[uid];
        const rPos = renderState.players[uid] || p; // use interpolated pos if available
        if (p.hp <= 0 || p.isSpectator) continue; // Don't draw dead/spectators

        // Dash State Logic
        const timeSinceDash = Date.now() - p.lastDash;
        let dashState = 'ready';
        if (timeSinceDash < 150) dashState = 'dashing';
        else if (timeSinceDash < 2000) dashState = 'cooldown';

        // Calculate shape based on kills
        // 0 kills = circle (shapeSides = 0 mapped in drawShape)
        // 1-3 = triangle (3)
        // 4 = square (4)
        // >=5 = polygon (kills)
        let shapeSides = 0;
        if (p.kills >= 1 && p.kills <= 3) shapeSides = 3;
        else if (p.kills === 4) shapeSides = 4;
        else if (p.kills >= 5) shapeSides = p.kills;
        
        // Aura if kills >= 1 (don't draw if dimmed to reduce clutter)
        if (p.kills >= 1 && dashState !== 'cooldown') {
            ctx.beginPath();
            ctx.arc(rPos.x, rPos.y, 30 + Math.min(10, p.kills * 2), 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.globalAlpha = 0.2;
            ctx.fill();
            ctx.globalAlpha = 1.0;
        }

        // Draw Player Shape
        drawShape(ctx, shapeSides, rPos.x, rPos.y, 20, p.color, dashState);

        // Draw Crown if Top Player
        if (uid === topPlayerId && maxKills > 0) {
            ctx.font = '24px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('👑', rPos.x, rPos.y - 45);
        }

        // Draw Name & HP Number
        ctx.fillStyle = 'white';
        ctx.font = '14px Orbitron';
        ctx.textAlign = 'center';
        ctx.fillText(`${p.name} (HP: ${Math.round(p.hp)})`, rPos.x, rPos.y - 25);
        
        // Draw HP Bar
        const hpPercent = Math.max(0, p.hp / 100);
        ctx.fillStyle = 'red';
        ctx.fillRect(rPos.x - 20, rPos.y + 25, 40, 5);
        ctx.fillStyle = '#00ff00';
        ctx.fillRect(rPos.x - 20, rPos.y + 25, 40 * hpPercent, 5);
    }

    ctx.restore();
    
    // Render minimap over UI
    renderMinimap();

    requestAnimationFrame(renderLoop);
}
