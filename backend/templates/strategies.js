/**
 * Strategy Templates for AI Gladiator Agents
 * 
 * Each strategy uses the combat model: attack, defend, propose_alliance, 
 * accept_alliance, betray_alliance, bribe, flee
 * 
 * gameState shape:
 * {
 *   matchId, currentTurn,
 *   you: { id, hp, alive, turnsAlive, lastAction },
 *   opponents: [{ id, hp, alive, turnsAlive, lastAction }],
 *   alliances: [{ id, members, prizeShare }],
 *   prizePool, history (last 5 turns)
 * }
 */
module.exports = [
    {
        name: 'Berserker',
        description: "Her zaman saldır. En zayıf rakibi hedef al. Savunma yok, merhamet yok.",
        traits: ['aggressive', 'ruthless'],
        strategyParams: { aggressiveness: 95, riskTolerance: 80, briberyPolicy: 'reject', allianceTendency: 5, betrayalChance: 90 },
        code: `function decide(gameState) {
    const alive = gameState.opponents.filter(o => o.alive);
    if (alive.length === 0) return { action: 'defend' };
    const target = alive.sort((a, b) => a.hp - b.hp)[0];
    return { action: 'attack', target: target.id };
}`
    },
    {
        name: 'Diplomat',
        description: "İttifak kur, rüşvet ver, sadık kal. Diplomasi ile kazan.",
        traits: ['loyal', 'diplomatic'],
        strategyParams: { aggressiveness: 20, riskTolerance: 40, briberyPolicy: 'accept', allianceTendency: 90, betrayalChance: 5 },
        code: `function decide(gameState) {
    const alive = gameState.opponents.filter(o => o.alive);
    if (alive.length === 0) return { action: 'defend' };
    const myAlliances = gameState.alliances.filter(a => a.members.includes(gameState.you.id));
    if (myAlliances.length > 0) return { action: 'defend' };
    if (gameState.currentTurn <= 3) {
        const strongest = alive.sort((a, b) => b.hp - a.hp)[0];
        return { action: 'propose_alliance', target: strongest.id, terms: { prizeShare: 50 } };
    }
    return { action: 'defend' };
}`
    },
    {
        name: 'Trickster',
        description: "İttifak kur, güven kazan, sonra pusudan saldır. İhanetçi!",
        traits: ['deceptive', 'cunning'],
        strategyParams: { aggressiveness: 70, riskTolerance: 60, briberyPolicy: 'accept', allianceTendency: 80, betrayalChance: 75 },
        code: `function decide(gameState) {
    const alive = gameState.opponents.filter(o => o.alive);
    if (alive.length === 0) return { action: 'defend' };
    const myAlliances = gameState.alliances.filter(a => a.members.includes(gameState.you.id));
    if (gameState.currentTurn <= 3) {
        if (myAlliances.length === 0) {
            const target = alive.sort((a, b) => b.hp - a.hp)[0];
            return { action: 'propose_alliance', target: target.id, terms: { prizeShare: 60 } };
        }
        return { action: 'defend' };
    }
    if (myAlliances.length > 0 && gameState.currentTurn > 3) {
        const alliance = myAlliances[0];
        const victim = alliance.members.find(m => m !== gameState.you.id);
        return { action: 'betray_alliance', allianceId: alliance.id, attackTarget: victim };
    }
    const target = alive.sort((a, b) => a.hp - b.hp)[0];
    return { action: 'attack', target: target.id };
}`
    },
    {
        name: 'Turtle',
        description: "Savunmada kal, HP koru. Son rakip kaldığında saldır.",
        traits: ['defensive', 'patient'],
        strategyParams: { aggressiveness: 15, riskTolerance: 30, briberyPolicy: 'accept', allianceTendency: 40, betrayalChance: 10 },
        code: `function decide(gameState) {
    const alive = gameState.opponents.filter(o => o.alive);
    if (alive.length <= 1 && alive[0] && gameState.you.hp > alive[0].hp) {
        return { action: 'attack', target: alive[0].id };
    }
    return { action: 'defend' };
}`
    },
    {
        name: 'Opportunist',
        description: "Duruma göre hareket et. Zayıfsa saldır, güçlüyse savun.",
        traits: ['adaptive', 'balanced'],
        strategyParams: { aggressiveness: 55, riskTolerance: 50, briberyPolicy: 'conditional', allianceTendency: 50, betrayalChance: 30 },
        code: `function decide(gameState) {
    const alive = gameState.opponents.filter(o => o.alive);
    if (alive.length === 0) return { action: 'defend' };
    const myHp = gameState.you.hp;
    const avgHp = alive.reduce((s, o) => s + o.hp, 0) / alive.length;
    if (myHp > avgHp * 1.2) {
        return { action: 'attack', target: alive.sort((a, b) => a.hp - b.hp)[0].id };
    }
    if (myHp < avgHp * 0.7 && alive.length > 1) {
        return { action: 'propose_alliance', target: alive.sort((a, b) => b.hp - a.hp)[0].id, terms: { prizeShare: 40 } };
    }
    if (Math.random() > 0.5) return { action: 'attack', target: alive.sort((a, b) => a.hp - b.hp)[0].id };
    return { action: 'defend' };
}`
    },
    {
        name: 'Bounty Hunter',
        description: "Outlaw ve düşük HP rakipleri hedef al. Ödül avı için yaşa.",
        traits: ['aggressive', 'tactical'],
        strategyParams: { aggressiveness: 75, riskTolerance: 70, briberyPolicy: 'reject', allianceTendency: 20, betrayalChance: 40 },
        code: `function decide(gameState) {
    const alive = gameState.opponents.filter(o => o.alive);
    if (alive.length === 0) return { action: 'defend' };
    const target = alive.sort((a, b) => a.hp - b.hp)[0];
    if (gameState.you.hp < 30) return { action: 'defend' };
    return { action: 'attack', target: target.id };
}`
    },
    {
        name: 'Briber',
        description: "Rüşvet ver, rakipleri satın al. Para ile kazanmayı dene.",
        traits: ['wealthy', 'manipulative'],
        strategyParams: { aggressiveness: 30, riskTolerance: 50, briberyPolicy: 'accept', allianceTendency: 70, betrayalChance: 45 },
        code: `function decide(gameState) {
    const alive = gameState.opponents.filter(o => o.alive);
    if (alive.length === 0) return { action: 'defend' };
    if (gameState.currentTurn % 3 === 1 && alive.length > 1) {
        return { action: 'propose_alliance', target: alive.sort((a, b) => b.hp - a.hp)[0].id, terms: { prizeShare: 55 } };
    }
    return { action: 'attack', target: alive.sort((a, b) => a.hp - b.hp)[0].id };
}`
    }
];
