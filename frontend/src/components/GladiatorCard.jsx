/**
 * GladiatorCard - NFT-style display card for AI gladiator agents
 *
 * @param {Object} props
 * @param {number|string} props.tokenId   - NFT token ID
 * @param {Object}        props.metadata  - { name, strategy, tier, wins, earnings, score }
 * @param {Function}      [props.onClick] - Click handler
 */
import React from 'react'

const TIER_STYLES = {
    bronze: { bg: '#CD7F32', color: '#fff', label: '🥉 Bronze', glow: 'rgba(205,127,50,0.35)' },
    silver: { bg: '#C0C0C0', color: '#000', label: '🥈 Silver', glow: 'rgba(192,192,192,0.35)' },
    gold:   { bg: '#FFD700', color: '#000', label: '🥇 Gold',   glow: 'rgba(255,215,0,0.35)' },
}

export default function GladiatorCard({ tokenId, metadata = {}, onClick }) {
    const { name, strategy, tier = 'bronze', wins = 0, earnings = 0, score = 0, losses = 0, createdAt } = metadata
    const tierStyle = TIER_STYLES[tier] || TIER_STYLES.bronze

    return (
        <div
            onClick={onClick}
            style={{
                background: 'var(--bg-secondary, #13132a)',
                border: '1px solid var(--border-color, #2a2a4a)',
                borderTop: `4px solid ${tierStyle.bg}`,
                borderRadius: '14px',
                padding: '1.5rem',
                cursor: onClick ? 'pointer' : 'default',
                transition: 'transform 0.2s, box-shadow 0.2s',
                position: 'relative',
                overflow: 'hidden',
            }}
            onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-4px)'
                e.currentTarget.style.boxShadow = `0 8px 30px ${tierStyle.glow}`
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)'
                e.currentTarget.style.boxShadow = 'none'
            }}
        >
            {/* Tier Badge */}
            <span style={{
                position: 'absolute',
                top: '0.75rem',
                right: '0.75rem',
                background: tierStyle.bg,
                color: tierStyle.color,
                padding: '0.2rem 0.6rem',
                borderRadius: '6px',
                fontSize: '0.7rem',
                fontWeight: 700,
                letterSpacing: '0.5px',
                textTransform: 'uppercase',
            }}>
                {tierStyle.label}
            </span>

            {/* Avatar + Identity */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                <div style={{
                    width: '56px',
                    height: '56px',
                    borderRadius: '12px',
                    background: `linear-gradient(135deg, ${tierStyle.bg}33, ${tierStyle.bg}11)`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '2rem',
                    border: `2px solid ${tierStyle.bg}55`,
                }}>
                    ⚔️
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <h3 style={{
                        color: 'var(--text-primary, #e0e0e0)',
                        margin: 0,
                        fontSize: '1rem',
                        fontWeight: 700,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                    }}>
                        {name || `Gladiator #${tokenId}`}
                    </h3>
                    <p style={{
                        color: 'var(--text-muted, #888)',
                        margin: '0.15rem 0 0',
                        fontSize: '0.75rem',
                        fontFamily: 'monospace',
                    }}>
                        #{tokenId}
                    </p>
                </div>
            </div>

            {/* Strategy */}
            {strategy && (
                <div style={{
                    background: 'var(--bg-tertiary, #1a1a3a)',
                    borderRadius: '8px',
                    padding: '0.5rem 0.75rem',
                    marginBottom: '1rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                }}>
                    <span style={{ fontSize: '0.85rem' }}>🧠</span>
                    <span style={{
                        color: 'var(--accent-primary, #818cf8)',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                    }}>
                        {strategy}
                    </span>
                </div>
            )}

            {/* Stats Grid */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                gap: '0.5rem',
                marginBottom: createdAt ? '0.75rem' : 0,
            }}>
                <StatBox icon="🏆" label="Wins" value={wins} color="var(--accent-success, #34d399)" />
                <StatBox icon="💰" label="AUSD" value={typeof earnings === 'number' ? earnings.toFixed(1) : earnings} color="var(--accent-warning, #fbbf24)" />
                <StatBox icon="📊" label="Score" value={score} color="var(--accent-cyan, #22d3ee)" />
            </div>

            {/* Footer */}
            {createdAt && (
                <p style={{
                    color: 'var(--text-muted, #666)',
                    fontSize: '0.7rem',
                    margin: 0,
                    textAlign: 'right',
                }}>
                    {new Date(createdAt).toLocaleDateString('tr-TR')}
                </p>
            )}
        </div>
    )
}

/** Small stat display box */
function StatBox({ icon, label, value, color }) {
    return (
        <div style={{
            background: 'var(--bg-tertiary, #1a1a3a)',
            borderRadius: '8px',
            padding: '0.5rem',
            textAlign: 'center',
        }}>
            <span style={{ fontSize: '0.8rem' }}>{icon}</span>
            <p style={{ color, fontWeight: 700, fontSize: '1rem', margin: '0.15rem 0 0' }}>{value}</p>
            <p style={{ color: 'var(--text-muted, #888)', fontSize: '0.6rem', margin: 0, textTransform: 'uppercase' }}>{label}</p>
        </div>
    )
}
