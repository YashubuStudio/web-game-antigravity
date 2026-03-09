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
const HOST = process.env.HOST || '0.0.0.0';

// Game State
const gameState = {
    players: {},
};

// Physics constants
const ARENA_RADIUS = 1700; // Expanded by 1.7x
const TICK_RATE = 1000 / 30; // 30 FPS / 30 Hz
const PLAYER_RADIUS = 20;
const MAX_SPEED = 10;
const ACCELERATION = 0.5;
const FRICTION = 0.95;
const DASH_POWER = 25;
const DASH_COOLDOWN = 2000; // ms
const MAX_PLAYERS = 10;
const RESPAWN_TIME = 5000; // 5 seconds
// PHP server endpoint for score saving (to be configured by user)
const SCORE_API_URL = 'http://localhost/save_score.php';

// NPC tracking
let timeSinceLowPlayers = Date.now();
const LOW_PLAYER_THRESHOLD = 3;
const NPC_ACTIVATION_TIME = 30000; // 30 seconds

function getSafeSpawn(players) {
    let bestX = 0, bestY = 0;
    let maxDist = -1;
    // Try multiple random spots and pick the one furthest from all existing players
    for (let i = 0; i < 20; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * (ARENA_RADIUS - 100);
        const tx = Math.cos(angle) * dist;
        const ty = Math.sin(angle) * dist;
        
        let closestDist = Infinity;
        let pCount = 0;
        for (const id in players) {
            const p = players[id];
            if (p.hp > 0 && !p.isSpectator) {
                pCount++;
                const d = Math.sqrt(Math.pow(tx - p.x, 2) + Math.pow(ty - p.y, 2));
                if (d < closestDist) closestDist = d;
            }
        }
        
        // If arena is empty, just use the first random spot
        if (pCount === 0) return { x: tx, y: ty };
        
        if (closestDist > maxDist) {
            maxDist = closestDist;
            bestX = tx;
            bestY = ty;
        }
    }
    return { x: bestX, y: bestY };
}

function handlePlayerDeath(victim, gameState, io) {
    if (victim.hp <= 0 && !victim.isSpectator) {
        victim.isSpectator = true; // Mark as spectator
        victim.deadAt = Date.now();
        
        let killerName = null;
        // Check for last hit logic
        if (victim.lastHitBy && gameState.players[victim.lastHitBy]) {
            const killer = gameState.players[victim.lastHitBy];
            if (killer.hp > 0 && !killer.isSpectator) {
                killer.kills += 1;
                killerName = killer.name;
            }
        }
        
        io.emit('killLog', { victim: victim.name, killer: killerName });
        
        // Send to external PHP API if kill count >= 5
        if (victim.kills >= 5) {
            sendScoreToPHP(victim);
        }
    }
}

async function sendScoreToPHP(player) {
    try {
        const fetch = (await import('node-fetch')).default;
        await fetch(SCORE_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: player.name,
                kills: player.kills,
                score_date: new Date().toISOString()
            })
        });
        console.log(`Score sent for ${player.name} (${player.kills} kills)`);
    } catch (e) {
        console.error("Failed to send score. Note: require('node-fetch') might be needed or URL is offline.", e.message);
    }
}

function roundTo2(num) {
    return Math.round(num * 100) / 100;
}

function updatePhysics() {
    // Basic physics update loop (to be expanded)
    for (let id in gameState.players) {
        let p = gameState.players[id];
        
        if (p.hp <= 0) continue; // Skip physics for dead/spectators

        // Apply friction
        p.vx *= FRICTION;
        p.vy *= FRICTION;

        // Apply velocity to position
        p.x += p.vx;
        p.y += p.vy;
        
        // Invincibility dash check
        p.isDashingNow = (Date.now() - p.lastDash < 150); // 150ms iframes/dash frames

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
            
            // Take damage over time simply if outside (unless invincible)
            if (!p.isDashingNow) {
                p.hp -= 0.5; 
                if (p.hp <= 0) {
                    p.hp = 0;
                    handlePlayerDeath(p, gameState, io);
                }
            }
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
                    
                    // Damage calculation and lastHitBy logic
                    if (speedScale > 5) {
                        const damage = speedScale * 0.5;
                        // Avoid iframe clash (if both dash, 0 damage)
                        if (!p1.isDashingNow) {
                            p1.hp -= damage;
                            p1.lastHitBy = p2.id;
                            if (p1.hp <= 0) {
                                p1.hp = 0;
                                handlePlayerDeath(p1, gameState, io);
                            }
                        }
                        if (!p2.isDashingNow) {
                            p2.hp -= damage;
                            p2.lastHitBy = p1.id;
                            if (p2.hp <= 0) {
                                p2.hp = 0;
                                handlePlayerDeath(p2, gameState, io);
                            }
                        }
                    }
                }
            }
        }
    }
    
    // Round data before sending to save bandwidth
    const roundedState = { players: {} };
    for (let id in gameState.players) {
        const p = gameState.players[id];
        roundedState.players[id] = {
            id: p.id,
            name: p.name,
            x: roundTo2(p.x),
            y: roundTo2(p.y),
            vx: roundTo2(p.vx),
            vy: roundTo2(p.vy),
            color: p.color, // string
            hp: roundTo2(p.hp),
            lastDash: p.lastDash,
            kills: p.kills || 0,
            isSpectator: p.isSpectator || false,
            deadAt: p.deadAt || 0
        };
    }
    
    // Broadcast state to all clients
    io.emit('gameState', roundedState);
}

// NPC Logic Loop (runs every tick)
function updateNPCs() {
    let humanPlayers = 0;
    let totalActive = 0;
    let npcsCount = 0;
    
    // Count active entities
    for (const uid in gameState.players) {
        const p = gameState.players[uid];
        if (p.hp > 0 && !p.isSpectator) {
            totalActive++;
            if (p.isNPC) {
                npcsCount++;
            } else {
                humanPlayers++;
            }
        }
        
        // --- NPC AI Behaviour ---
        if (p.hp > 0 && !p.isSpectator && p.isNPC) {
            // Find closest target
            let closestDist = Infinity;
            let target = null;
            
            for (const otherId in gameState.players) {
                if (otherId === uid) continue;
                const otherP = gameState.players[otherId];
                if (otherP.hp > 0 && !otherP.isSpectator) {
                    const d = Math.sqrt(Math.pow(p.x - otherP.x, 2) + Math.pow(p.y - otherP.y, 2));
                    if (d < closestDist) {
                        closestDist = d;
                        target = otherP;
                    }
                }
            }
            
            if (target) {
                // Determine direction
                const dx = target.x - p.x;
                const dy = target.y - p.y;
                const angle = Math.atan2(dy, dx);
                
                // Move very slowly towards target (Weak AI)
                p.vx += Math.cos(angle) * (ACCELERATION * 0.4);
                p.vy += Math.sin(angle) * (ACCELERATION * 0.4);
                
                // Cap speed for NPC slightly lower
                const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
                const npcMaxSpeed = MAX_SPEED * 0.7;
                if (speed > npcMaxSpeed) {
                    p.vx = (p.vx / speed) * npcMaxSpeed;
                    p.vy = (p.vy / speed) * npcMaxSpeed;
                }
                
                // Try to dash if close enough (with a low chance & longer cooldown)
                if (closestDist < 300 && Date.now() - p.lastDash > 4000) {
                    if (Math.random() < 0.05) { // 5% chance per tick when in range
                        p.vx += Math.cos(angle) * (DASH_POWER * 0.8);
                        p.vy += Math.sin(angle) * (DASH_POWER * 0.8);
                        p.lastDash = Date.now();
                    }
                }
            }
        }
    }
    
    // NPC Spawning Logic
    if (humanPlayers === 0) {
        // If no humans, kill all NPCs to save resources
        for (const uid in gameState.players) {
            if (gameState.players[uid].isNPC && gameState.players[uid].hp > 0) {
                gameState.players[uid].hp = 0;
            }
        }
        timeSinceLowPlayers = Date.now();
    } else if (totalActive <= LOW_PLAYER_THRESHOLD) {
        // If low players (and at least 1 human) for 30s, spawn NPCs
        if (Date.now() - timeSinceLowPlayers > NPC_ACTIVATION_TIME) {
            // Fill up to 5 total active entities
            if (totalActive < 5) {
                spawnNPC();
                totalActive++; // Predict the increase to prevent massive immediate spawning
            }
        }
    } else {
        // Reset timer if we have more than threshold active
        timeSinceLowPlayers = Date.now();
    }
    
    // Extra cleanup: If human players join and we hit MAX_PLAYERS containing NPCs, kill an NPC to make room
    if (totalActive >= MAX_PLAYERS && npcsCount > 0) {
        for (const uid in gameState.players) {
            if (gameState.players[uid].isNPC && gameState.players[uid].hp > 0) {
                gameState.players[uid].hp = 0; // instantly kill NPC
                break;
            }
        }
    }
}

let npcCounter = 0;
function spawnNPC() {
    const minionId = `npc_${npcCounter++}`;
    const spawnPos = getSafeSpawn(gameState.players);
    
    gameState.players[minionId] = {
        id: minionId,
        name: `Bot ${npcCounter}`,
        x: spawnPos.x,
        y: spawnPos.y,
        vx: 0,
        vy: 0,
        color: '#777777', // Gray hue for NPCs
        hp: 100,
        lastDash: 0,
        kills: 0,
        lastHitBy: null,
        isSpectator: false,
        isDashingNow: false,
        isNPC: true
    };
    console.log(`Spawned NPC: ${minionId}`);
}

// Start game loop
setInterval(() => {
    updateNPCs();
    updatePhysics();
}, TICK_RATE);

function broadcastLobbyState() {
    let active = 0;
    let spectator = 0;
    for (let id in gameState.players) {
        const p = gameState.players[id];
        // Only count human clients connected via socket (not NPCs)
        if (!p.isNPC) {
            if (p.isSpectator) spectator++;
            else active++;
        }
    }
    io.emit('lobbyState', { active, spectator, max: MAX_PLAYERS });
}

// Repeatedly send lobby state
setInterval(broadcastLobbyState, 2000);

io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);
    broadcastLobbyState();

    // Create new player or respawn
    socket.on('joinGame', (data) => {
        const name = data.name || 'Guest';
        const color = data.color || `hsl(${Math.random() * 360}, 100%, 60%)`;
        
        let currentPlayersCount = 0;
        for (const pid in gameState.players) {
            if (gameState.players[pid].hp > 0 && !gameState.players[pid].isSpectator) {
                currentPlayersCount++;
            }
        }
        
        const isSpectator = (currentPlayersCount >= MAX_PLAYERS);
        
        let spawnPos = { x: 0, y: 0 };
        if (!isSpectator) {
            spawnPos = getSafeSpawn(gameState.players);
        }

        // Reuse previous stats if respawning, else create new
        const prevStats = gameState.players[socket.id] || {};
        
        gameState.players[socket.id] = {
            id: socket.id,
            name: name,
            x: spawnPos.x,
            y: spawnPos.y,
            vx: 0,
            vy: 0,
            color: color,
            hp: isSpectator ? 0 : 100, // spectator is inherently dead
            lastDash: 0,
            targetX: 0,
            targetY: 0,
            kills: 0,
            lastHitBy: null,
            isSpectator: isSpectator,
            isDashingNow: false
        };
        
        // Send initial data to the joined player
        socket.emit('joined', { id: socket.id, arenaRadius: ARENA_RADIUS });
        
        if (isSpectator) {
            io.to(socket.id).emit('serverMessage', '満員のため観戦モードとして参加しました。');
        }
    });

    socket.on('input', (data) => {
        const player = gameState.players[socket.id];
        if (!player || player.hp <= 0 || player.isSpectator) return;

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
        broadcastLobbyState();
    });
});

server.listen(PORT, HOST, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`LAN access: http://${HOST === '0.0.0.0' ? '<<your-local-ip>>' : HOST}:${PORT}`);
});
