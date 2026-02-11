/**
 * Monad Colosseum - HUD Controller
 *
 * Updates DOM overlay elements: HP bars, event log, match info.
 */

const MAX_HP = 105;
const ACTION_ICONS = {
  attack: '⚔️',
  defend: '🛡️',
  propose_alliance: '🤝',
  accept_alliance: '✅',
  betray_alliance: '🗡️',
};

export class HudController {
  constructor() {
    this.turnEl = document.getElementById('turn-counter');
    this.aliveEl = document.getElementById('alive-counter');
    this.prizeEl = document.getElementById('prize-pool');
    this.barsEl = document.getElementById('agent-bars');
    this.logEl = document.getElementById('event-log-inner');
    this.statusEl = document.getElementById('ws-status');
  }

  setConnectionStatus(connected) {
    this.statusEl.textContent = connected ? '● Connected' : '● Disconnected';
    this.statusEl.className = connected ? 'connected' : '';
  }

  updateMatchInfo(turn, aliveCount, prizePool) {
    this.turnEl.textContent = `Turn: ${turn}`;
    this.aliveEl.textContent = `Alive: ${aliveCount}`;
    this.prizeEl.textContent = `Prize: ${prizePool}`;
  }

  /**
   * Build or update HP bars for all agents.
   * @param {Array} agents - [{ id, hp, alive, lastAction }, …]
   */
  updateAgentBars(agents) {
    this.barsEl.innerHTML = '';
    for (const agent of agents) {
      const hpPercent = Math.max(0, (agent.hp / MAX_HP) * 100);
      let hpClass = '';
      if (hpPercent < 25) hpClass = 'critical';
      else if (hpPercent < 50) hpClass = 'low';

      const actionIcon = agent.lastAction
        ? ACTION_ICONS[agent.lastAction.action] || '❓'
        : '⏳';

      const bar = document.createElement('div');
      bar.className = `agent-bar${agent.alive ? '' : ' dead'}`;
      bar.innerHTML = `
        <span class="agent-name">${agent.id}</span>
        <div class="hp-track">
          <div class="hp-fill ${hpClass}" style="width: ${hpPercent}%"></div>
        </div>
        <span class="hp-text">${agent.hp}/${MAX_HP}</span>
        <span class="action-icon">${actionIcon}</span>
      `;
      this.barsEl.appendChild(bar);
    }
  }

  /**
   * Add turn events to the log.
   * @param {number} turn
   * @param {Array} events
   */
  logEvents(turn, events) {
    for (const evt of events) {
      const entry = document.createElement('div');
      entry.className = `log-entry ${evt.type}`;

      let text = '';
      switch (evt.type) {
        case 'attack':
          text = `${evt.attackerId} ⚔️ ${evt.defenderId} (-${evt.damage} HP${evt.defended ? ' 🛡️' : ''})`;
          break;
        case 'defend':
          text = `${evt.agentId} 🛡️ defending`;
          break;
        case 'death':
          text = `☠️ ${evt.agentId} eliminated!`;
          break;
        case 'alliance_formed':
          text = `🤝 Alliance: ${evt.alliance.members.join(' + ')}`;
          break;
        case 'betrayal':
          text = `🗡️ ${evt.betrayer} betrayed ${evt.victim}!`;
          break;
        case 'match_end':
          text = evt.winner
            ? `🏆 ${evt.winner} wins!`
            : `💀 Draw - all eliminated!`;
          break;
        case 'recovery':
          text = `💚 +${evt.amount} HP recovery`;
          break;
        default:
          text = evt.type;
      }

      entry.innerHTML = `<span class="log-turn">[T${turn}]</span> ${text}`;
      this.logEl.prepend(entry);
    }

    // Trim log to last 100 entries
    while (this.logEl.children.length > 100) {
      this.logEl.removeChild(this.logEl.lastChild);
    }
  }

  clearLog() {
    this.logEl.innerHTML = '';
  }
}
