/**
 * Monad Colosseum - REST API Routes
 */

const express = require('express');
const router = express.Router();

module.exports = function createRoutes(arenaManager, gameEngine) {
  // ─── Arena Endpoints ───────────────────────────────────────────────────

  // List all arenas (optional ?status=open filter)
  router.get('/arenas', (req, res) => {
    const arenas = arenaManager.listArenas(req.query.status || null);
    res.json({ ok: true, arenas });
  });

  // Create arena
  router.post('/arenas', (req, res) => {
    try {
      const arena = arenaManager.createArena(req.body);
      res.status(201).json({ ok: true, arena });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  // Get single arena
  router.get('/arenas/:arenaId', (req, res) => {
    const arena = arenaManager.getArena(req.params.arenaId);
    if (!arena) return res.status(404).json({ ok: false, error: 'Arena not found' });
    res.json({ ok: true, arena });
  });

  // Get arena lobby
  router.get('/arenas/:arenaId/lobby', (req, res) => {
    const lobby = arenaManager.getLobby(req.params.arenaId);
    if (!lobby) return res.status(404).json({ ok: false, error: 'Arena not found' });
    res.json({ ok: true, lobby });
  });

  // ─── Agent Actions ─────────────────────────────────────────────────────

  // Join arena
  router.post('/arenas/:arenaId/join', (req, res) => {
    try {
      const result = arenaManager.joinArena(req.params.arenaId, req.body);
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  // Leave arena
  router.post('/arenas/:arenaId/leave', (req, res) => {
    try {
      const result = arenaManager.leaveArena(req.params.arenaId, req.body.agentId);
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  // ─── Match Endpoints ──────────────────────────────────────────────────

  // Get match details
  router.get('/matches/:matchId', (req, res) => {
    const match = gameEngine.getMatch(req.params.matchId);
    if (!match) return res.status(404).json({ ok: false, error: 'Match not found' });
    res.json({ ok: true, match: gameEngine.getMatchStatus(match) });
  });

  // Get match result
  router.get('/matches/:matchId/result', (req, res) => {
    const result = arenaManager.getResult(req.params.matchId);
    if (!result) return res.status(404).json({ ok: false, error: 'Result not found' });
    res.json({ ok: true, result });
  });

  // ─── Health ────────────────────────────────────────────────────────────
  router.get('/health', (req, res) => {
    res.json({ ok: true, uptime: process.uptime(), timestamp: new Date().toISOString() });
  });

  return router;
};
