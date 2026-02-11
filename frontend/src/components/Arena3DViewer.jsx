/**
 * Arena3DViewer.jsx - 3D Battle Visualization for Spectate Mode
 * 
 * Wraps Opus ArenaScene for React integration
 */

import React, { useEffect, useRef, useState } from 'react';

// WebSocket client
class SpectateWsClient {
    constructor() {
        this.ws = null;
        this.listeners = {};
        this.reconnectAttempts = 0;
        this.maxReconnects = 5;
    }

    connect(url = 'ws://localhost:3001/ws') {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
            console.log('[WS] Connected');
            this.reconnectAttempts = 0;
            this._emit('_connected', {});
        };

        this.ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                this._emit(msg.type, msg);
            } catch (e) {
                console.error('[WS] Parse error:', e);
            }
        };

        this.ws.onclose = () => {
            console.log('[WS] Disconnected');
            this._emit('_disconnected', {});
            if (this.reconnectAttempts < this.maxReconnects) {
                setTimeout(() => {
                    this.reconnectAttempts++;
                    this.connect(url);
                }, 2000);
            }
        };

        this.ws.onerror = (error) => {
            console.error('[WS] Error:', error);
        };
    }

    subscribe(arenaId) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'subscribe', arenaId }));
        }
    }

    on(event, callback) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(callback);
    }

    off(event, callback) {
        if (this.listeners[event]) {
            this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
        }
    }

    _emit(event, data) {
        if (this.listeners[event]) {
            this.listeners[event].forEach(cb => cb(data));
        }
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}

// Global WS instance
const wsClient = new SpectateWsClient();

export function Arena3DViewer({ agents, events, isLive = false, arenaId }) {
    const canvasRef = useRef(null);
    const sceneRef = useRef(null);
    const [isConnected, setIsConnected] = useState(false);
    const [currentTurn, setCurrentTurn] = useState(0);
    const [battleLog, setBattleLog] = useState([]);

    // Initialize 3D scene
    useEffect(() => {
        if (!canvasRef.current) return;

        // Dynamic import of ArenaScene (it's ES module)
        const initScene = async () => {
            try {
                const { ArenaScene } = await import('../arena3d/ArenaScene.js');
                sceneRef.current = new ArenaScene(canvasRef.current);

                // Setup initial agents
                if (agents && agents.length > 0) {
                    const formattedAgents = agents.map((a, i) => ({
                        id: a.id || a.address || `agent_${i}`,
                        hp: a.health || a.hp || 100,
                        alive: a.isAlive !== false && a.alive !== false,
                        lastAction: null
                    }));
                    sceneRef.current.setupAgents(formattedAgents);
                }
            } catch (error) {
                console.error('Failed to init ArenaScene:', error);
            }
        };

        initScene();

        return () => {
            if (sceneRef.current && sceneRef.current.dispose) {
                sceneRef.current.dispose();
            }
        };
    }, []);

    // Update agents when they change
    useEffect(() => {
        if (!sceneRef.current || !agents) return;

        const formattedAgents = agents.map((a, i) => ({
            id: a.id || a.address || `agent_${i}`,
            hp: a.health || a.hp || 100,
            alive: a.isAlive !== false && a.alive !== false,
            lastAction: a.lastAction
        }));

        sceneRef.current.setupAgents(formattedAgents);
    }, [agents]);

    // Process incoming events
    useEffect(() => {
        if (!sceneRef.current || !events || events.length === 0) return;

        // Get current agents state
        const currentAgents = agents?.map((a, i) => ({
            id: a.id || a.address || `agent_${i}`,
            hp: a.health || a.hp || 100,
            alive: a.isAlive !== false && a.alive !== false,
            lastAction: null
        })) || [];

        sceneRef.current.updateFromEvents(events, currentAgents);
    }, [events, agents]);

    // WebSocket connection for live mode
    useEffect(() => {
        if (!isLive) return;

        wsClient.connect();

        const handleConnected = () => setIsConnected(true);
        const handleDisconnected = () => setIsConnected(false);

        const handleTurn = (msg) => {
            setCurrentTurn(msg.turn);
            setBattleLog(prev => [...prev.slice(-20), ...msg.events]);

            if (sceneRef.current && msg.events) {
                const currentAgents = agents?.map((a, i) => ({
                    id: a.id || a.address || `agent_${i}`,
                    hp: a.health || a.hp || 100,
                    alive: a.isAlive !== false,
                    lastAction: null
                })) || [];

                sceneRef.current.updateFromEvents(msg.events, currentAgents);
            }
        };

        wsClient.on('_connected', handleConnected);
        wsClient.on('_disconnected', handleDisconnected);
        wsClient.on('match:turn', handleTurn);

        if (arenaId) {
            wsClient.subscribe(arenaId);
        }

        return () => {
            wsClient.off('_connected', handleConnected);
            wsClient.off('_disconnected', handleDisconnected);
            wsClient.off('match:turn', handleTurn);
        };
    }, [isLive, arenaId, agents]);

    return (
        <div className="arena-3d-viewer">
            <div className="arena-3d-header">
                <h3>🎮 3D Arena View</h3>
                <div className="arena-3d-status">
                    {isLive && (
                        <span className={`ws-status ${isConnected ? 'connected' : 'disconnected'}`}>
                            {isConnected ? '🟢 Live' : '🔴 Offline'}
                        </span>
                    )}
                    <span className="turn-info">Turn: {currentTurn}</span>
                </div>
            </div>

            <canvas
                ref={canvasRef}
                id="arena-3d-canvas"
                style={{
                    width: '100%',
                    height: '400px',
                    background: '#0a0a0f',
                    borderRadius: '8px',
                    cursor: 'grab'
                }}
            />

            {battleLog.length > 0 && (
                <div className="arena-3d-log">
                    {battleLog.slice(-5).map((evt, i) => (
                        <div key={i} className={`log-item ${evt.type}`}>
                            {evt.type === 'attack' && `⚔️ ${evt.attackerId} → ${evt.defenderId} (-${evt.damage})`}
                            {evt.type === 'defend' && `🛡️ ${evt.agentId} defended`}
                            {evt.type === 'death' && `☠️ ${evt.agentId} eliminated!`}
                            {evt.type === 'betrayal' && `🗡️ ${evt.betrayer} betrayed ${evt.victim}!`}
                            {evt.type === 'bribe' && `💰 ${evt.offerer || evt.attackerId} bribed ${evt.target || evt.defenderId}`}
                            {evt.type === 'alliance_formed' && `🤝 Alliance: ${evt.alliance?.members?.join(' & ')}`}
                        </div>
                    ))}
                </div>
            )}

            <style>{`
                .arena-3d-viewer {
                    background: var(--bg-secondary, #1a1a2e);
                    border-radius: 12px;
                    overflow: hidden;
                    border: 1px solid var(--border-color, #2a2a4e);
                }
                .arena-3d-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 0.75rem 1rem;
                    background: var(--bg-tertiary, #0f0f1a);
                    border-bottom: 1px solid var(--border-color, #2a2a4e);
                }
                .arena-3d-header h3 {
                    margin: 0;
                    color: var(--accent-primary, #8b5cf6);
                    font-size: 1rem;
                }
                .arena-3d-status {
                    display: flex;
                    gap: 1rem;
                    font-size: 0.85rem;
                }
                .ws-status {
                    padding: 0.25rem 0.5rem;
                    border-radius: 4px;
                }
                .ws-status.connected { background: rgba(34, 197, 94, 0.2); color: #22c55e; }
                .ws-status.disconnected { background: rgba(239, 68, 68, 0.2); color: #ef4444; }
                .turn-info { color: var(--text-secondary, #94a3b8); }
                .arena-3d-log {
                    padding: 0.5rem 1rem;
                    background: var(--bg-tertiary, #0f0f1a);
                    max-height: 100px;
                    overflow-y: auto;
                    font-size: 0.8rem;
                    font-family: monospace;
                }
                .log-item { padding: 0.25rem 0; color: var(--text-secondary, #94a3b8); }
                .log-item.attack { color: #ef4444; }
                .log-item.death { color: #f59e0b; }
                .log-item.betrayal { color: #dc2626; }
            `}</style>
        </div>
    );
}

export default Arena3DViewer;
