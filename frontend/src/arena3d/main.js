/**
 * Monad Colosseum - Frontend Entry Point
 *
 * Wires together: ArenaScene (3D) + WsClient + HudController
 */

import './style.css';
import { ArenaScene } from './ArenaScene.js';
import { WsClient } from './WsClient.js';
import { HudController } from './HudController.js';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

// ─── Global error handler ────────────────────────────────────────────────────
window.addEventListener('error', (e) => {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;top:0;left:0;width:100%;padding:20px;background:red;color:white;z-index:9999;font-family:monospace;white-space:pre-wrap;font-size:14px;';
  d.textContent = `ERROR: ${e.message}\n${e.filename}:${e.lineno}:${e.colno}\n${e.error?.stack || ''}`;
  document.body.appendChild(d);
});
window.addEventListener('unhandledrejection', (e) => {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;top:0;left:0;width:100%;padding:20px;background:darkred;color:white;z-index:9999;font-family:monospace;white-space:pre-wrap;font-size:14px;';
  d.textContent = `UNHANDLED REJECTION: ${e.reason?.message || e.reason}\n${e.reason?.stack || ''}`;
  document.body.appendChild(d);
});

// ─── Init ────────────────────────────────────────────────────────────────────
const canvas = document.getElementById('arena-canvas');
let scene, ws, hud;
try {
  // Test WebGL support first
  const testCanvas = document.createElement('canvas');
  const gl = testCanvas.getContext('webgl2') || testCanvas.getContext('webgl') || testCanvas.getContext('experimental-webgl');
  if (!gl) {
    document.body.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;width:100vw;height:100vh;background:#0a0a0f;color:#8b5cf6;font-family:monospace;text-align:center;flex-direction:column;">
        <h1 style="font-size:3rem;margin-bottom:1rem;">⚔️ MONAD COLOSSEUM</h1>
        <p style="color:#e2e8f0;font-size:1.2rem;">WebGL is required to run this application.</p>
        <p style="color:#64748b;margin-top:0.5rem;">Open <code style="color:#06b6d4">http://localhost:5173</code> in Chrome, Edge, or Firefox.</p>
      </div>`;
    throw new Error('WebGL not supported');
  }
  scene = new ArenaScene(canvas);
  ws = new WsClient();
  hud = new HudController();
} catch (err) {
  if (err.message !== 'WebGL not supported') {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;top:0;left:0;width:100%;padding:20px;background:red;color:white;z-index:9999;font-family:monospace;white-space:pre-wrap;font-size:14px;';
    d.textContent = `INIT ERROR: ${err.message}\n${err.stack}`;
    document.body.appendChild(d);
  }
  throw err;
}

let currentArenaId = null;
let currentAgents = [];

// ─── DOM Controls ────────────────────────────────────────────────────────────
const btnConnect = document.getElementById('btn-connect');
const btnCreateArena = document.getElementById('btn-create-arena');
const btnStartDemo = document.getElementById('btn-start-demo');

btnConnect.addEventListener('click', () => {
  ws.connect();
});

btnCreateArena.addEventListener('click', async () => {
  try {
    const res = await fetch(`${API_BASE}/arenas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Arena Alpha', entryFee: 100 }),
    });
    const data = await res.json();
    if (data.ok) {
      currentArenaId = data.arena.arenaId;
      ws.subscribe(currentArenaId);
      hud.logEvents(0, [{ type: 'info' }]);
      btnStartDemo.disabled = false;
      console.log('[Arena] Created:', currentArenaId);
    }
  } catch (err) {
    console.error('[Arena] Create failed:', err);
  }
});

btnStartDemo.addEventListener('click', async () => {
  if (!currentArenaId) return;

  // Join 4 demo agents
  const agentIds = ['agent_alpha', 'agent_beta', 'agent_gamma', 'agent_delta'];
  for (const id of agentIds) {
    try {
      await fetch(`${API_BASE}/arenas/${currentArenaId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, owner: `owner_${id}` }),
      });
    } catch (err) {
      console.error(`[Arena] Join failed for ${id}:`, err);
    }
  }
  console.log('[Demo] Agents joined. Match should start automatically.');
});

// ─── WebSocket Event Handlers ────────────────────────────────────────────────

ws.on('_connected', () => {
  hud.setConnectionStatus(true);
  btnCreateArena.disabled = false;
  btnConnect.textContent = 'Connected';
  btnConnect.disabled = true;
});

ws.on('_disconnected', () => {
  hud.setConnectionStatus(false);
  btnConnect.textContent = 'Reconnecting...';
  btnConnect.disabled = false;
});

ws.on('welcome', (msg) => {
  console.log('[WS] Welcome. Open arenas:', msg.openArenas);
});

ws.on('arena:agentJoined', (msg) => {
  console.log('[WS] Agent joined:', msg.agentId, 'Lobby size:', msg.lobbySize);
});

ws.on('match:launching', (msg) => {
  console.log('[WS] Match launching! Agents:', msg.agentCount);
});

ws.on('match:turn', (msg) => {
  const { turn, events } = msg;

  // Update agents from events
  updateAgentsFromEvents(events);

  // Update 3D scene
  scene.updateFromEvents(events, currentAgents);

  // Update HUD
  const alive = currentAgents.filter((a) => a.alive);
  hud.updateMatchInfo(turn, alive.length, '--');
  hud.updateAgentBars(currentAgents);
  hud.logEvents(turn, events);
});

ws.on('match:completed', (msg) => {
  console.log('[WS] Match completed!', msg.result);
  hud.logEvents(msg.result?.totalTurns || 0, [
    {
      type: 'match_end',
      winner: msg.result?.winner?.id || null,
    },
  ]);
});

// ─── Agent State Tracking ────────────────────────────────────────────────────

function updateAgentsFromEvents(events) {
  for (const evt of events) {
    switch (evt.type) {
      case 'attack': {
        const target = currentAgents.find((a) => a.id === evt.defenderId);
        if (target) {
          target.hp = evt.remainingHp;
          target.lastAction = { action: 'defend' };
        }
        const attacker = currentAgents.find((a) => a.id === evt.attackerId);
        if (attacker) attacker.lastAction = { action: 'attack' };
        break;
      }
      case 'defend': {
        const agent = currentAgents.find((a) => a.id === evt.agentId);
        if (agent) agent.lastAction = { action: 'defend' };
        break;
      }
      case 'death': {
        const agent = currentAgents.find((a) => a.id === evt.agentId);
        if (agent) {
          agent.alive = false;
          agent.hp = 0;
        }
        break;
      }
      case 'recovery': {
        for (const agent of currentAgents) {
          if (agent.alive) {
            agent.hp = Math.min(105, agent.hp + evt.amount);
          }
        }
        break;
      }
      case 'betrayal': {
        const victim = currentAgents.find((a) => a.id === evt.victim);
        if (victim) victim.hp = evt.remainingHp;
        break;
      }
    }
  }
}

// ─── Setup Demo Scene (offline preview) ──────────────────────────────────────

// Show placeholder agents immediately so the scene isn't empty
const demoAgents = [];
for (let i = 0; i < 20; i++) {
  demoAgents.push({ id: `agent_${i}`, hp: 100, alive: true, lastAction: null });
}
currentAgents = demoAgents;
scene.setupAgents(demoAgents);
hud.updateAgentBars(demoAgents);
hud.updateMatchInfo('--', 20, '--');

console.log('⚔️ Monad Colosseum Frontend loaded.');
