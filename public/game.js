const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

const startScreen = document.getElementById('start-screen');
const gameUi = document.getElementById('game-ui');
const nameInput = document.getElementById('player-name');
const startBtn = document.getElementById('start-btn');
const leaderboardDiv = document.getElementById('leaderboard');
const statusMsg = document.getElementById('status-message');

let socket;
let myId = null;
let gameState = { players: {} };
let arenaRadius = 1000;

// Mouse tracking
let mouseX = 0;
let mouseY = 0;
let isDashing = false;

// Camera
let camera = { x: 0, y: 0 };

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
    });

    socket.on('joined', (data) => {
        myId = data.id;
        arenaRadius = data.arenaRadius;
        startScreen.style.display = 'none';
        gameUi.style.display = 'block';
        requestAnimationFrame(renderLoop);
    });

    socket.on('gameState', (state) => {
        gameState = state;
        updateLeaderboard();
        
        // Update status UI
        const me = gameState.players[myId];
        if (me && me.hp <= 0) {
            statusMsg.textContent = "GAME OVER - 観戦中";
        } else if (me) {
            statusMsg.textContent = `HP: ${me.hp}`;
            if (Date.now() - me.lastDash > 2000) {
               statusMsg.textContent += " | DASH READY";
               statusMsg.style.color = "#00ffff";
            } else {
               statusMsg.style.color = "#ff00ff";
            }
        }
    });

    socket.on('disconnect', () => {
        console.log('Disconnected');
        statusMsg.textContent = "サーバーから切断されました";
    });
}

function updateLeaderboard() {
    let html = '<h3>LEADERBOARD</h3>';
    const playersArr = Object.values(gameState.players).sort((a,b) => b.hp - a.hp);
    
    playersArr.forEach((p, index) => {
        html += `<div class="player-score" style="color:${p.id === myId ? '#00ffff' : 'white'}">
            <span>${index + 1}. ${p.name}</span>
            <span>HP: ${p.hp}</span>
        </div>`;
    });
    
    leaderboardDiv.innerHTML = html;
}

startBtn.addEventListener('click', () => {
    const name = nameInput.value.trim() || 'Guest';
    if (!socket) connect();
    socket.emit('joinGame', name);
});

// Input handling
document.addEventListener('mousemove', (e) => {
    // We need to send mouse position relative to player center on screen
    mouseX = e.clientX - canvas.width / 2;
    mouseY = e.clientY - canvas.height / 2;
});

document.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
        isDashing = true;
    }
});
document.addEventListener('mouseup', (e) => {
    if (e.button === 0) {
        isDashing = false;
    }
});

// Send input to server continually
setInterval(() => {
    if (socket && myId && gameState.players[myId]) {
        // Only send if alive
        if (gameState.players[myId].hp > 0) {
            socket.emit('input', {
                mouseX: mouseX,
                mouseY: mouseY,
                dash: isDashing
            });
            isDashing = false; // Reset dash flag after sending
        }
    }
}, 1000/30); // 30Hz input rate

function renderLoop() {
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const me = gameState.players[myId];
    
    // Update camera to follow player (or keep centered if dead)
    if (me) {
        // Smooth camera follow
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

    // Draw Players
    for (const uid in gameState.players) {
        const p = gameState.players[uid];
        if (p.hp <= 0) continue; // Don't draw dead players

        // Draw Player Circle
        ctx.beginPath();
        ctx.arc(p.x, p.y, 20, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.shadowBlur = 15;
        ctx.shadowColor = p.color;
        ctx.fill();
        
        // Draw Outline
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Draw Name
        ctx.fillStyle = 'white';
        ctx.font = '14px Orbitron';
        ctx.textAlign = 'center';
        ctx.fillText(p.name, p.x, p.y - 30);
    }

    ctx.restore();

    requestAnimationFrame(renderLoop);
}
