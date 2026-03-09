const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// Game State
const gameState = {
    players: {},
};

// Physics constants
const ARENA_RADIUS = 1000;
const TICK_RATE = 1000 / 60; // 60 FPS
const PLAYER_RADIUS = 20;
const MAX_SPEED = 10;
const ACCELERATION = 0.5;
const FRICTION = 0.95;
const DASH_POWER = 25;
const DASH_COOLDOWN = 2000; // ms

function updatePhysics() {
    // Basic physics update loop (to be expanded)
    for (let id in gameState.players) {
        let p = gameState.players[id];
        
        // Apply friction
        p.vx *= FRICTION;
        p.vy *= FRICTION;

        // Apply velocity to position
        p.x += p.vx;
        p.y += p.vy;

        // Simple arena boundary (bounce or take damage)
        const distFromCenter = Math.sqrt(p.x * p.x + p.y * p.y);
        if (distFromCenter + PLAYER_RADIUS > ARENA_RADIUS) {
            // Push back
            const angle = Math.atan2(p.y, p.x);
            p.x = (ARENA_RADIUS - PLAYER_RADIUS) * Math.cos(angle);
            p.y = (ARENA_RADIUS - PLAYER_RADIUS) * Math.sin(angle);
            
            // Bounce
            p.vx *= -0.5;
            p.vy *= -0.5;
            
            // Take damage over time simply if outside
            p.hp -= 0.5; 
            if (p.hp < 0) p.hp = 0;
        }
    }

    // Player vs Player collision (Circle vs Circle)
    const playerIds = Object.keys(gameState.players);
    for (let i = 0; i < playerIds.length; i++) {
        for (let j = i + 1; j < playerIds.length; j++) {
            const p1 = gameState.players[playerIds[i]];
            const p2 = gameState.players[playerIds[j]];

            if (p1.hp <= 0 || p2.hp <= 0) continue; // Dead players don't collide

            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            // Minimum required distance (sum of radii)
            const minDist = PLAYER_RADIUS * 2;

            if (distance < minDist) {
                // Collision detected! Calculate overlapping distance
                const overlap = minDist - distance;
                
                // Direction of collision
                const nx = dx / distance;
                const ny = dy / distance;

                // Push apart (half overlap for each to avoid sticking)
                p1.x -= nx * (overlap / 2);
                p1.y -= ny * (overlap / 2);
                p2.x += nx * (overlap / 2);
                p2.y += ny * (overlap / 2);

                // Basic Elastic Collision (swap velocities, amplified by DASH if speeding)
                // Calculate relative velocity
                const relativeVx = p1.vx - p2.vx;
                const relativeVy = p1.vy - p2.vy;
                
                // Velocity along normal
                const speedScale = (relativeVx * nx + relativeVy * ny) * 1.5; // Bounciness factor
                
                if (speedScale > 0) {
                    p1.vx -= speedScale * nx;
                    p1.vy -= speedScale * ny;
                    p2.vx += speedScale * nx;
                    p2.vy += speedScale * ny;
                    
                    // Damage calculation (based on speed difference)
                    if (speedScale > 5) {
                        p1.hp -= speedScale * 0.5;
                        p2.hp -= speedScale * 0.5;
                    }
                }
            }
        }
    }
    
    // Broadcast state to all clients
    io.emit('gameState', gameState);
}

// Start game loop
setInterval(updatePhysics, TICK_RATE);

io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);

    // Create new player
    socket.on('joinGame', (name) => {
        // Spawn near center
        const spawnAngle = Math.random() * Math.PI * 2;
        const spawnDist = Math.random() * 200;
        
        gameState.players[socket.id] = {
            id: socket.id,
            name: name || 'Guest',
            x: Math.cos(spawnAngle) * spawnDist,
            y: Math.sin(spawnAngle) * spawnDist,
            vx: 0,
            vy: 0,
            color: `hsl(${Math.random() * 360}, 100%, 60%)`, // Random neon color
            hp: 100,
            lastDash: 0,
            targetX: 0,
            targetY: 0
        };
        
        // Send initial data to the joined player
        socket.emit('joined', { id: socket.id, arenaRadius: ARENA_RADIUS });
    });

    socket.on('input', (data) => {
        const player = gameState.players[socket.id];
        if (!player) return;

        // data contains targetX, targetY from mouse position relative to player
        player.targetX = data.mouseX;
        player.targetY = data.mouseY;

        if (data.dash && Date.now() - player.lastDash > DASH_COOLDOWN) {
            // Dash towards target
            const angle = Math.atan2(data.mouseY, data.mouseX);
            player.vx += Math.cos(angle) * DASH_POWER;
            player.vy += Math.sin(angle) * DASH_POWER;
            player.lastDash = Date.now();
        } else {
            // Normal movement towards target
            const angle = Math.atan2(data.mouseY, data.mouseX);
            const dist = Math.sqrt(data.mouseX * data.mouseX + data.mouseY * data.mouseY);
            
            if (dist > 10) { // Deadzone
                player.vx += Math.cos(angle) * ACCELERATION;
                player.vy += Math.sin(angle) * ACCELERATION;
                
                // Cap speed
                const speed = Math.sqrt(player.vx * player.vx + player.vy * player.vy);
                if (speed > MAX_SPEED) {
                    player.vx = (player.vx / speed) * MAX_SPEED;
                    player.vy = (player.vy / speed) * MAX_SPEED;
                }
            }
        }
    });

    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id}`);
        delete gameState.players[socket.id];
    });
});

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
