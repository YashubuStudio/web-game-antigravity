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

function drawShape(ctx, shapeSides, x, y, radius, color, isDashing) {
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
    
    // Invincibility dash effect
    if (isDashing) {
        ctx.shadowBlur = 30;
        ctx.shadowColor = '#ffffff';
        ctx.fillStyle = '#ffffff'; // Flash white
    } else {
        ctx.shadowBlur = 15;
        ctx.shadowColor = color;
    }
    
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.shadowBlur = 0; // Reset
}

function renderMinimap() {
    if (!minimapCtx) return;
    
    // Clear minimizing map
    minimapCtx.clearRect(0, 0, minimapCanvas.width, minimapCanvas.height);
    
    const scale = minimapCanvas.width / (arenaRadius * 2);
    const center = minimapCanvas.width / 2;
    
    // Draw arena bounds
    minimapCtx.beginPath();
    minimapCtx.arc(center, center, center - 2, 0, Math.PI*2);
    minimapCtx.strokeStyle = 'rgba(255, 0, 255, 0.5)';
    minimapCtx.stroke();
    
    // Draw players
    for (const uid in gameState.players) {
        const p = gameState.players[uid];
        if (p.hp <= 0 || p.isSpectator) continue;
        
        const mx = center + (p.x * scale);
        const my = center + (p.y * scale);
        
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
    
    // Update camera to follow player
    if (me && !me.isSpectator && me.hp > 0) {
        camera.x += (me.x - camera.x) * 0.1;
        camera.y += (me.y - camera.y) * 0.1;
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
        if (p.hp <= 0 || p.isSpectator) continue; // Don't draw dead/spectators

        const isDashing = (Date.now() - p.lastDash < 300);

        // Calculate shape based on kills
        // 0 kills = circle (shapeSides = 0 mapped in drawShape)
        // 1-3 = triangle (3)
        // 4 = square (4)
        // >=5 = polygon (kills)
        let shapeSides = 0;
        if (p.kills >= 1 && p.kills <= 3) shapeSides = 3;
        else if (p.kills === 4) shapeSides = 4;
        else if (p.kills >= 5) shapeSides = p.kills;
        
        // Aura if kills >= 1
        if (p.kills >= 1) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, 30 + Math.min(10, p.kills * 2), 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.globalAlpha = 0.2;
            ctx.fill();
            ctx.globalAlpha = 1.0;
        }

        // Draw Player Shape
        drawShape(ctx, shapeSides, p.x, p.y, 20, p.color, isDashing);

        // Draw Crown if Top Player
        if (uid === topPlayerId && maxKills > 0) {
            ctx.font = '24px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('👑', p.x, p.y - 45);
        }

        // Draw Name & HP Bar
        ctx.fillStyle = 'white';
        ctx.font = '14px Orbitron';
        ctx.textAlign = 'center';
        ctx.fillText(p.name, p.x, p.y - 25);
        
        const hpPercent = p.hp / 100;
        ctx.fillStyle = 'red';
        ctx.fillRect(p.x - 20, p.y + 25, 40, 5);
        ctx.fillStyle = '#00ff00';
        ctx.fillRect(p.x - 20, p.y + 25, 40 * hpPercent, 5);
    }

    ctx.restore();
    
    // Render minimap over UI
    renderMinimap();

    requestAnimationFrame(renderLoop);
}
