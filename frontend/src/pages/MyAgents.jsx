/**
 * MyAgents Page - Full agent management:
 * activate/deactivate, balance, send MON, withdraw, settings, buff, transfer history.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useAccount, useSendTransaction, useWaitForTransactionReceipt } from 'wagmi'
import { parseEther, formatEther } from 'viem'
import { WalletButton } from '../components/WalletButton'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001'
const WS_URL = (BACKEND_URL.replace('http', 'ws')) + '/ws'

const BUFF_TYPES = [
    { id: 'health', label: '❤️ HP', desc: '+HP başlangıç canı', color: '#22c55e' },
    { id: 'armor', label: '🛡️ Zırh', desc: 'Hasar azaltma', color: '#3b82f6' },
    { id: 'attack', label: '⚔️ Saldırı', desc: 'Hasar artışı', color: '#ef4444' },
    { id: 'speed', label: '⚡ Hız', desc: 'Aksiyon önceliği', color: '#eab308' },
]

const STATUS_MAP = {
    idle: { label: 'Boşta', color: '#6b7280', icon: '⏸️' },
    searching: { label: 'Arena arıyor...', color: '#eab308', icon: '🔍' },
    fighting: { label: 'Savaşıyor', color: '#ef4444', icon: '⚔️' },
    won: { label: 'Kazandı!', color: '#22c55e', icon: '🏆' },
    lost: { label: 'Kaybetti', color: '#ef4444', icon: '💀' },
}

function deriveTier(agent) {
    const totalMatches = (agent.stats?.wins || 0) + (agent.stats?.losses || 0)
    if (totalMatches >= 20) return 'gold'
    if (totalMatches >= 5) return 'silver'
    return 'bronze'
}

export default function MyAgents({ onNavigate }) {
    const { address, isConnected } = useAccount()
    const [agents, setAgents] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [selectedAgent, setSelectedAgent] = useState(null)
    const [activating, setActivating] = useState(null)
    // Buff modal
    const [buffAgent, setBuffAgent] = useState(null)
    const [buffType, setBuffType] = useState('attack')
    const [buffAmount, setBuffAmount] = useState('0.5')
    const [buffing, setBuffing] = useState(false)
    // Send modal
    const [sendAgent, setSendAgent] = useState(null)
    const [sendAmount, setSendAmount] = useState('1')
    const [sendTxDone, setSendTxDone] = useState(false)
    // Withdraw modal
    const [withdrawAgent, setWithdrawAgent] = useState(null)
    const [withdrawAmount, setWithdrawAmount] = useState('')
    const [withdrawing, setWithdrawing] = useState(false)
    const [withdrawResult, setWithdrawResult] = useState(null)
    // Balances (agentId → { balanceMON })
    const [balances, setBalances] = useState({})
    const [balanceFlash, setBalanceFlash] = useState({}) // agentId → 'up' | 'down' | null
    // Transfer history for selected agent
    const [transfers, setTransfers] = useState([])
    const [financial, setFinancial] = useState(null)
    // Settings editing (in detail panel)
    const [editingSettings, setEditingSettings] = useState(false)
    const [settingsProfitTarget, setSettingsProfitTarget] = useState('')
    const [settingsWithdrawThreshold, setSettingsWithdrawThreshold] = useState('')
    const [savingSettings, setSavingSettings] = useState(false)
    // Toast notifications
    const [toasts, setToasts] = useState([])
    const toastIdRef = useRef(0)

    // ─── Toast helper ─────────────────────────────────────
    const addToast = useCallback((message, type = 'info') => {
        const id = ++toastIdRef.current
        setToasts(prev => [...prev, { id, message, type }])
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 6000)
    }, [])

    // ─── WebSocket for auto-withdraw notifications ────────
    useEffect(() => {
        if (!isConnected) return
        let ws
        try {
            ws = new WebSocket(WS_URL)
            ws.onmessage = (evt) => {
                try {
                    const msg = JSON.parse(evt.data)
                    if (msg.type === 'agent:autoWithdraw') {
                        addToast(`🎉 ${msg.agentName || 'Agent'} ${msg.amount?.toFixed(4)} MON kâr geri gönderdi!`, 'success')
                        if (selectedAgent === msg.agentId) {
                            fetch(`${BACKEND_URL}/api/agent/${msg.agentId}/transfers`)
                                .then(r => r.json())
                                .then(d => { if (d.ok) { setTransfers(d.transfers); setFinancial(d.financial) } })
                                .catch(() => {})
                        }
                    }
                    if (msg.type === 'agent:withdraw') {
                        addToast(`📤 ${msg.amount?.toFixed(4)} MON çekildi → cüzdanın`, 'info')
                    }
                } catch { /* ignore */ }
            }
            ws.onopen = () => console.log('[WS] MyAgents connected')
            ws.onerror = () => {}
        } catch { /* WS not available */ }
        return () => { if (ws) ws.close() }
    }, [isConnected, selectedAgent, addToast])

    // wagmi send native MON
    const { data: sendTxHash, sendTransaction, isPending: isSending, error: sendError } = useSendTransaction()
    const { isSuccess: isSendConfirmed } = useWaitForTransactionReceipt({ hash: sendTxHash })

    // Record deposit after send tx confirmed
    useEffect(() => {
        if (isSendConfirmed && sendTxHash && sendAgent && !sendTxDone) {
            setSendTxDone(true)
            fetch(`${BACKEND_URL}/api/agent/${sendAgent.id}/record-deposit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount: parseFloat(sendAmount), txHash: sendTxHash }),
            }).catch(() => {})
        }
    }, [isSendConfirmed, sendTxHash, sendAgent, sendTxDone, sendAmount])

    const fetchAgents = useCallback(async () => {
        if (!address) { setLoading(false); return }
        setLoading(true)
        setError(null)
        try {
            const res = await fetch(`${BACKEND_URL}/api/agents/${address}`)
            if (!res.ok) throw new Error('Ajanlar yüklenirken hata oluştu')
            const data = await res.json()
            setAgents(data)
        } catch (err) {
            console.error('MyAgents fetch error:', err)
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }, [address])

    useEffect(() => { fetchAgents() }, [fetchAgents])

    // ─── Fetch balances helper (used both on init and interval) ───
    const fetchBalances = useCallback(async (agentList) => {
        if (!agentList || agentList.length === 0) return
        try {
            const results = await Promise.all(agentList.map(a =>
                fetch(`${BACKEND_URL}/api/agent/${a.id}/balance`)
                    .then(r => r.json()).catch(() => null)
            ))
            setBalances(prev => {
                const next = { ...prev }
                const flashes = {}
                agentList.forEach((a, i) => {
                    const b = results[i]
                    if (b?.ok) {
                        const oldBal = prev[a.id]?.balanceMON || 0
                        const newBal = b.balanceMON
                        if (oldBal > 0 && newBal > oldBal) flashes[a.id] = 'up'
                        else if (oldBal > 0 && newBal < oldBal) flashes[a.id] = 'down'
                        next[a.id] = { balanceMON: newBal }
                    }
                })
                if (Object.keys(flashes).length > 0) {
                    setBalanceFlash(f => ({ ...f, ...flashes }))
                    setTimeout(() => setBalanceFlash(f => {
                        const cleared = { ...f }
                        Object.keys(flashes).forEach(k => delete cleared[k])
                        return cleared
                    }), 1500)
                }
                return next
            })
        } catch { /* ignore */ }
    }, [])

    // Fetch balances immediately when agents load
    useEffect(() => {
        if (agents.length > 0) fetchBalances(agents)
    }, [agents, fetchBalances])

    // Poll agent statuses + balances every 5 seconds
    useEffect(() => {
        if (!agents.length) return
        const interval = setInterval(async () => {
            try {
                const statusUpdates = await Promise.all(agents.map(a =>
                    fetch(`${BACKEND_URL}/api/agent/${a.id}/status`)
                        .then(r => r.json()).catch(() => null)
                ))
                setAgents(prev => prev.map((a, i) => {
                    const u = statusUpdates[i]
                    if (u?.ok) return { ...a, status: u.status, stats: u.stats, buffs: u.buffs }
                    return a
                }))
                await fetchBalances(agents)
            } catch { /* ignore */ }
        }, 5000)
        return () => clearInterval(interval)
    }, [agents.length, fetchBalances])

    // Fetch transfer history + init settings when selectedAgent changes
    useEffect(() => {
        if (!selectedAgent) { setTransfers([]); setFinancial(null); setEditingSettings(false); return }
        fetch(`${BACKEND_URL}/api/agent/${selectedAgent}/transfers`)
            .then(r => r.json())
            .then(d => { if (d.ok) { setTransfers(d.transfers); setFinancial(d.financial) } })
            .catch(() => {})
        // init settings values
        const ag = agents.find(a => a.id === selectedAgent)
        if (ag) {
            setSettingsProfitTarget(ag.strategyParams?.profitTarget ?? 2)
            setSettingsWithdrawThreshold(ag.strategyParams?.withdrawThreshold ?? 0.5)
        }
        setEditingSettings(false)
    }, [selectedAgent, agents])

    const toggleActivation = async (agent) => {
        const isActive = agent.status === 'searching' || agent.status === 'fighting'
        const endpoint = isActive ? 'deactivate' : 'activate'
        setActivating(agent.id)
        try {
            const res = await fetch(`${BACKEND_URL}/api/agent/${agent.id}/${endpoint}`, { method: 'POST' })
            const data = await res.json()
            if (data.ok) {
                setAgents(prev => prev.map(a => a.id === agent.id ? { ...a, status: data.status } : a))
            }
        } catch (err) {
            console.error('Activation error:', err)
        } finally {
            setActivating(null)
        }
    }

    const applyBuff = async () => {
        if (!buffAgent) return
        setBuffing(true)
        try {
            const res = await fetch(`${BACKEND_URL}/api/agent/${buffAgent.id}/buff`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ buffType, amount: parseFloat(buffAmount) })
            })
            const data = await res.json()
            if (data.ok) {
                addToast(data.message, 'success')
                setAgents(prev => prev.map(a => a.id === buffAgent.id ? { ...a, buffs: data.totalBuffs } : a))
                setBuffAgent(null)
            } else {
                addToast('Hata: ' + (data.error || 'Bilinmeyen'), 'error')
            }
        } catch (err) {
            addToast('Buff hatası: ' + err.message, 'error')
        } finally {
            setBuffing(false)
        }
    }

    const doSendMON = () => {
        if (!sendAgent?.agentWalletAddress) return
        sendTransaction({
            to: sendAgent.agentWalletAddress,
            value: parseEther(sendAmount),
        })
    }

    // ─── Withdraw handler ─────────────────────────────────
    const doWithdraw = async (all = false) => {
        if (!withdrawAgent) return
        setWithdrawing(true)
        setWithdrawResult(null)
        try {
            const body = all ? { withdrawAll: true } : { amount: parseFloat(withdrawAmount) }
            const res = await fetch(`${BACKEND_URL}/api/agent/${withdrawAgent.id}/withdraw`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            })
            const data = await res.json()
            if (data.ok) {
                setWithdrawResult(data)
                addToast(`📤 ${data.amount} MON çekildi!`, 'success')
                await fetchBalances(agents)
                if (selectedAgent === withdrawAgent.id) {
                    fetch(`${BACKEND_URL}/api/agent/${withdrawAgent.id}/transfers`)
                        .then(r => r.json())
                        .then(d => { if (d.ok) { setTransfers(d.transfers); setFinancial(d.financial) } })
                        .catch(() => {})
                }
                if (data.wasActive) {
                    addToast('⚠️ Ajan aktifken çekim yapıldı — bakiye düşük kalabilir!', 'warning')
                }
            } else {
                addToast('Çekim hatası: ' + (data.error || 'Bilinmeyen'), 'error')
            }
        } catch (err) {
            addToast('Çekim hatası: ' + err.message, 'error')
        } finally {
            setWithdrawing(false)
        }
    }

    // ─── Settings save handler ────────────────────────────
    const saveSettings = async () => {
        if (!selectedAgent) return
        setSavingSettings(true)
        try {
            const res = await fetch(`${BACKEND_URL}/api/agent/${selectedAgent}/settings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    profitTarget: parseFloat(settingsProfitTarget) || 2,
                    withdrawThreshold: parseFloat(settingsWithdrawThreshold) || 0.5,
                }),
            })
            const data = await res.json()
            if (data.ok) {
                addToast('✅ Ayarlar kaydedildi', 'success')
                setAgents(prev => prev.map(a => a.id === selectedAgent ? {
                    ...a, strategyParams: { ...a.strategyParams, profitTarget: data.profitTarget, withdrawThreshold: data.withdrawThreshold }
                } : a))
                setEditingSettings(false)
            } else {
                addToast('Hata: ' + (data.error || 'Bilinmeyen'), 'error')
            }
        } catch (err) {
            addToast('Ayar hatası: ' + err.message, 'error')
        } finally {
            setSavingSettings(false)
        }
    }

    // ---- Early returns for loading/error/empty/not-connected ----
    if (!isConnected) {
        return (
            <div className="combat-log-panel" style={{ margin: '2rem', padding: '3rem', textAlign: 'center' }}>
                <h2 style={{ color: 'var(--text-primary)', marginBottom: '1rem' }}>🃏 Ajanlarım</h2>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>Ajanlarını görmek için cüzdan bağla.</p>
                <WalletButton />
            </div>
        )
    }
    if (loading) {
        return (
            <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem', textAlign: 'center' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ width: '48px', height: '48px', border: '4px solid var(--border-color)', borderTop: '4px solid var(--accent-primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                    <p style={{ color: 'var(--text-secondary)' }}>Ajanlar yükleniyor...</p>
                </div>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
        )
    }
    if (error) {
        return (
            <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem' }}>
                <h1 style={{ color: 'var(--text-primary)', fontWeight: 700, marginBottom: '1rem' }}>🃏 Ajanlarım</h1>
                <div className="combat-log-panel" style={{ padding: '2rem', textAlign: 'center' }}>
                    <p style={{ color: '#ef4444', marginBottom: '1rem' }}>❌ {error}</p>
                    <button onClick={fetchAgents} className="connect-btn" style={{ padding: '0.75rem 1.5rem' }}>🔄 Tekrar Dene</button>
                </div>
            </div>
        )
    }
    if (agents.length === 0) {
        return (
            <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem' }}>
                <h1 style={{ color: 'var(--text-primary)', fontWeight: 700, marginBottom: '2rem' }}>🃏 Ajanlarım</h1>
                <div className="combat-log-panel" style={{ padding: '3rem', textAlign: 'center' }}>
                    <span style={{ fontSize: '5rem', display: 'block', marginBottom: '1rem' }}>⚔️</span>
                    <h3 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>Henüz gladyatörün yok</h3>
                    <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', maxWidth: '420px', margin: '0 auto 1.5rem' }}>
                        İlk AI gladyatörünü oluştur ve arenalarda savaşmaya başla!
                    </p>
                    <button onClick={() => onNavigate?.('create')} className="connect-btn" style={{ fontSize: '1rem', padding: '0.75rem 2rem' }}>
                        🧠 Yeni Ajan Oluştur
                    </button>
                </div>
            </div>
        )
    }

    // ---- Main render ----
    return (
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '1rem' }}>
            {/* Flash animation keyframes */}
            <style>{`
                @keyframes flashGreen { 0%{background:rgba(34,197,94,0.3)} 100%{background:transparent} }
                @keyframes flashRed { 0%{background:rgba(239,68,68,0.3)} 100%{background:transparent} }
                .balance-flash-up { animation: flashGreen 1.5s ease-out; }
                .balance-flash-down { animation: flashRed 1.5s ease-out; }
                @keyframes toastIn { from { transform: translateX(100%); opacity:0; } to { transform: translateX(0); opacity:1; } }
                @keyframes toastOut { from { opacity:1; } to { opacity:0; } }
            `}</style>

            {/* Toast Notifications */}
            <div style={{ position: 'fixed', top: '1rem', right: '1rem', zIndex: 2000, display: 'flex', flexDirection: 'column', gap: '0.5rem', pointerEvents: 'none' }}>
                {toasts.map(t => (
                    <div key={t.id} style={{
                        background: t.type === 'success' ? '#166534' : t.type === 'error' ? '#7f1d1d' : t.type === 'warning' ? '#713f12' : '#1e293b',
                        color: '#fff', padding: '0.75rem 1.25rem', borderRadius: '10px',
                        fontSize: '0.85rem', fontWeight: 500, boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                        animation: 'toastIn 0.3s ease-out', pointerEvents: 'auto', maxWidth: '360px',
                        border: `1px solid ${t.type === 'success' ? '#22c55e' : t.type === 'error' ? '#ef4444' : t.type === 'warning' ? '#eab308' : '#475569'}`,
                    }}>
                        {t.message}
                    </div>
                ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                <h1 style={{ color: 'var(--text-primary)', fontWeight: 700, margin: 0 }}>
                    🃏 Ajanlarım <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '1rem' }}>({agents.length})</span>
                </h1>
                <button onClick={() => onNavigate?.('create')} className="connect-btn" style={{ padding: '0.6rem 1.25rem', fontSize: '0.9rem' }}>
                    + Yeni Ajan Oluştur
                </button>
            </div>

            {/* Agent Cards Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1.25rem' }}>
                {agents.map((agent) => {
                    const status = STATUS_MAP[agent.status] || STATUS_MAP.idle
                    const isActive = agent.status === 'searching' || agent.status === 'fighting'
                    const hasBuffs = agent.buffs && (agent.buffs.health > 0 || agent.buffs.armor > 0 || agent.buffs.attack > 0 || agent.buffs.speed > 0)
                    const bal = balances[agent.id]?.balanceMON ?? 0
                    const flash = balanceFlash[agent.id]

                    return (
                        <div key={agent.id} className="agent-card" style={{
                            padding: '1.5rem',
                            borderLeft: `4px solid ${status.color}`,
                            cursor: 'pointer',
                        }}
                        onClick={() => setSelectedAgent(selectedAgent === agent.id ? null : agent.id)}
                        >
                            {/* Header */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                <h3 style={{ color: 'var(--text-primary)', margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>
                                    ⚔️ {agent.name}
                                </h3>
                                <span style={{
                                    background: `${status.color}20`, color: status.color,
                                    padding: '0.2rem 0.6rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600,
                                }}>
                                    {status.icon} {status.label}
                                </span>
                            </div>

                            {/* Balance — big font */}
                            <div className={flash === 'up' ? 'balance-flash-up' : flash === 'down' ? 'balance-flash-down' : ''}
                                style={{ padding: '0.5rem', borderRadius: '8px', marginBottom: '0.5rem', textAlign: 'center' }}>
                                <span style={{
                                    fontSize: '1.4rem', fontWeight: 800, fontFamily: 'var(--font-mono)',
                                    color: flash === 'up' ? '#22c55e' : flash === 'down' ? '#ef4444' : 'var(--accent-gold)',
                                }}>
                                    💰 {bal.toFixed(4)} MON
                                </span>
                            </div>

                            {/* Wallet */}
                            {agent.agentWalletAddress && (
                                <p style={{ fontSize: '0.68rem', fontFamily: 'monospace', color: 'var(--text-muted)', marginBottom: '0.5rem', textAlign: 'center' }}>
                                    💳 {agent.agentWalletAddress.slice(0, 8)}...{agent.agentWalletAddress.slice(-6)}
                                </p>
                            )}

                            {/* Stats Row */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', marginBottom: '0.75rem' }}>
                                <div style={{ textAlign: 'center' }}>
                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.65rem', margin: 0 }}>G/M</p>
                                    <p style={{ margin: 0, fontWeight: 700, fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}>
                                        <span style={{ color: '#22c55e' }}>{agent.stats?.wins || 0}</span>
                                        <span style={{ color: 'var(--text-muted)' }}>/</span>
                                        <span style={{ color: '#ef4444' }}>{agent.stats?.losses || 0}</span>
                                    </p>
                                </div>
                                <div style={{ textAlign: 'center' }}>
                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.65rem', margin: 0 }}>Kazanç</p>
                                    <p style={{ margin: 0, fontWeight: 700, color: 'var(--accent-gold)', fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}>
                                        {agent.stats?.earnings || 0} MON
                                    </p>
                                </div>
                                <div style={{ textAlign: 'center' }}>
                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.65rem', margin: 0 }}>Tier</p>
                                    <p style={{ margin: 0, fontWeight: 700, fontSize: '0.9rem' }}>{deriveTier(agent)}</p>
                                </div>
                            </div>

                            {/* Active Buffs */}
                            {hasBuffs && (
                                <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                                    {agent.buffs.health > 0 && <span style={{ background: '#22c55e20', color: '#22c55e', padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.7rem' }}>❤️+{agent.buffs.health}</span>}
                                    {agent.buffs.armor > 0 && <span style={{ background: '#3b82f620', color: '#3b82f6', padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.7rem' }}>🛡️+{agent.buffs.armor}</span>}
                                    {agent.buffs.attack > 0 && <span style={{ background: '#ef444420', color: '#ef4444', padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.7rem' }}>⚔️+{agent.buffs.attack}</span>}
                                    {agent.buffs.speed > 0 && <span style={{ background: '#eab30820', color: '#eab308', padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.7rem' }}>⚡+{agent.buffs.speed}</span>}
                                    {agent.buffs.matchesLeft > 0 && <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>({agent.buffs.matchesLeft} maç kaldı)</span>}
                                </div>
                            )}

                            {/* Action Buttons */}
                            <div style={{ display: 'flex', gap: '0.4rem' }}>
                                <button
                                    onClick={(e) => { e.stopPropagation(); toggleActivation(agent); }}
                                    disabled={activating === agent.id}
                                    className={isActive ? 'mc-btn-danger' : 'mc-btn-primary'}
                                    style={{ flex: 2, padding: '0.5rem', fontSize: '0.8rem' }}
                                >
                                    {activating === agent.id ? '⏳...' : isActive ? '⏹️ Durdur' : '▶️ Aktifleştir'}
                                </button>
                                <button
                                    onClick={(e) => { e.stopPropagation(); setSendAgent(agent); setSendTxDone(false); }}
                                    className="mc-btn-secondary"
                                    style={{ flex: 1, padding: '0.5rem', fontSize: '0.8rem' }}
                                >
                                    💸 Gönder
                                </button>
                                <button
                                    onClick={(e) => { e.stopPropagation(); setWithdrawAgent(agent); setWithdrawAmount(''); setWithdrawResult(null); }}
                                    className="mc-btn-secondary"
                                    style={{ flex: 1, padding: '0.5rem', fontSize: '0.8rem' }}
                                >
                                    📤 Çek
                                </button>
                                <button
                                    onClick={(e) => { e.stopPropagation(); setBuffAgent(agent); }}
                                    className="mc-btn-secondary"
                                    style={{ flex: 1, padding: '0.5rem', fontSize: '0.8rem' }}
                                >
                                    🔥 Buff
                                </button>
                            </div>
                        </div>
                    )
                })}
            </div>

            {/* ===== SEND MON MODAL ===== */}
            {sendAgent && (
                <Modal onClose={() => setSendAgent(null)}>
                    <h3 style={{ color: 'var(--text-primary)', margin: '0 0 1rem' }}>💸 Para Gönder — {sendAgent.name}</h3>
                    <p className="mc-text-secondary" style={{ marginBottom: '1rem', fontSize: '0.85rem' }}>
                        MetaMask ile ajanın cüzdanına MON gönder.
                    </p>
                    <div style={{ background: 'var(--bg-tertiary)', padding: '0.75rem', borderRadius: '8px', marginBottom: '1rem' }}>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.7rem', margin: 0 }}>Alıcı Adres</p>
                        <code style={{ color: 'var(--accent-gold)', fontSize: '0.75rem', wordBreak: 'break-all' }}>
                            {sendAgent.agentWalletAddress}
                        </code>
                    </div>
                    <label style={{ color: 'var(--text-muted)', fontSize: '0.8rem', display: 'block', marginBottom: '0.5rem' }}>Miktar (MON)</label>
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
                        {['0.5', '1', '5', '10'].map(v => (
                            <button key={v} onClick={() => setSendAmount(v)} style={{
                                flex: 1, padding: '0.4rem', borderRadius: '6px', cursor: 'pointer',
                                background: sendAmount === v ? 'var(--accent-orange)' : 'var(--bg-tertiary)',
                                border: 'none', color: sendAmount === v ? '#000' : 'var(--text-secondary)',
                                fontWeight: 600, fontSize: '0.85rem',
                            }}>{v}</button>
                        ))}
                    </div>
                    <input type="number" step="0.1" min="0.01" value={sendAmount}
                        onChange={e => setSendAmount(e.target.value)}
                        style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', marginBottom: '1rem' }}
                    />

                    {sendError && <p style={{ color: '#ef4444', fontSize: '0.8rem', marginBottom: '0.5rem' }}>❌ {sendError.shortMessage || sendError.message}</p>}
                    {sendTxHash && !isSendConfirmed && <p style={{ color: 'var(--accent-orange)', fontSize: '0.8rem' }}>⏳ Onaylanıyor...</p>}
                    {isSendConfirmed && (
                        <div style={{ marginBottom: '1rem' }}>
                            <p style={{ color: '#22c55e', fontWeight: 600, marginBottom: '0.25rem' }}>✅ Transfer başarılı!</p>
                            <a href={`https://testnet.monadvision.com/tx/${sendTxHash}`} target="_blank" rel="noreferrer"
                                style={{ color: 'var(--accent-cyan)', fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}>
                                TX: {sendTxHash.slice(0, 12)}...{sendTxHash.slice(-8)}
                            </a>
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: '0.75rem' }}>
                        <button onClick={() => setSendAgent(null)} className="mc-btn-secondary" style={{ flex: 1 }}>Kapat</button>
                        {!isSendConfirmed && (
                            <button onClick={doSendMON} disabled={isSending} className="mc-btn-primary" style={{ flex: 2 }}>
                                {isSending ? '⏳ İmza bekleniyor...' : `💸 ${sendAmount} MON Gönder`}
                            </button>
                        )}
                    </div>
                </Modal>
            )}

            {/* ===== WITHDRAW MODAL ===== */}
            {withdrawAgent && (
                <Modal onClose={() => setWithdrawAgent(null)}>
                    <h3 style={{ color: 'var(--text-primary)', margin: '0 0 1rem' }}>📤 Para Çek — {withdrawAgent.name}</h3>

                    {/* Active agent warning */}
                    {(withdrawAgent.status === 'searching' || withdrawAgent.status === 'fighting') && (
                        <div style={{ background: '#713f1220', border: '1px solid #eab308', borderRadius: '8px', padding: '0.75rem', marginBottom: '1rem' }}>
                            <p style={{ color: '#eab308', fontSize: '0.8rem', margin: 0, fontWeight: 600 }}>
                                ⚠️ Bu ajan şu an aktif! Para çekerseniz maç sırasında bakiye düşük kalabilir.
                            </p>
                        </div>
                    )}

                    <div style={{ background: 'var(--bg-tertiary)', padding: '0.75rem', borderRadius: '8px', marginBottom: '1rem', textAlign: 'center' }}>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.7rem', margin: 0 }}>Mevcut Bakiye</p>
                        <p style={{ color: 'var(--accent-gold)', fontWeight: 800, fontSize: '1.3rem', fontFamily: 'var(--font-mono)', margin: '0.25rem 0 0' }}>
                            💰 {(balances[withdrawAgent.id]?.balanceMON ?? 0).toFixed(4)} MON
                        </p>
                    </div>

                    <label style={{ color: 'var(--text-muted)', fontSize: '0.8rem', display: 'block', marginBottom: '0.5rem' }}>Çekilecek Miktar (MON)</label>
                    <input type="number" step="0.01" min="0.01" value={withdrawAmount}
                        onChange={e => setWithdrawAmount(e.target.value)}
                        placeholder="Örn: 1.5"
                        style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', marginBottom: '0.75rem', boxSizing: 'border-box' }}
                    />

                    {withdrawResult && (
                        <div style={{ marginBottom: '1rem' }}>
                            <p style={{ color: '#22c55e', fontWeight: 600, marginBottom: '0.25rem' }}>✅ {withdrawResult.amount} MON çekildi!</p>
                            {withdrawResult.txHash && (
                                <a href={`https://testnet.monadvision.com/tx/${withdrawResult.txHash}`} target="_blank" rel="noreferrer"
                                    style={{ color: 'var(--accent-cyan)', fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}>
                                    TX: {withdrawResult.txHash.slice(0, 12)}...{withdrawResult.txHash.slice(-8)}
                                </a>
                            )}
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button onClick={() => setWithdrawAgent(null)} className="mc-btn-secondary" style={{ flex: 1 }}>Kapat</button>
                        <button onClick={() => doWithdraw(true)} disabled={withdrawing} className="mc-btn-secondary"
                            style={{ flex: 1, background: '#a855f720', color: '#a855f7', border: '1px solid #a855f7' }}>
                            {withdrawing ? '⏳...' : '🏧 Tamamını Çek'}
                        </button>
                        <button onClick={() => doWithdraw(false)} disabled={withdrawing || !withdrawAmount} className="mc-btn-primary" style={{ flex: 2 }}>
                            {withdrawing ? '⏳ İşleniyor...' : `📤 ${withdrawAmount || '?'} MON Çek`}
                        </button>
                    </div>
                </Modal>
            )}

            {/* ===== BUFF MODAL ===== */}
            {buffAgent && (
                <Modal onClose={() => setBuffAgent(null)}>
                    <h3 style={{ color: 'var(--text-primary)', margin: '0 0 1rem' }}>🔥 Buff Ver — {buffAgent.name}</h3>
                    <p className="mc-text-secondary" style={{ marginBottom: '1.5rem', fontSize: '0.85rem' }}>
                        MON yakarak ajanına geçici buff ver. Süre: 3 maç veya 1 saat.
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '1.5rem' }}>
                        {BUFF_TYPES.map(bt => (
                            <button key={bt.id} onClick={() => setBuffType(bt.id)} style={{
                                padding: '0.75rem', borderRadius: '8px', cursor: 'pointer',
                                background: buffType === bt.id ? `${bt.color}20` : 'var(--bg-tertiary)',
                                border: buffType === bt.id ? `2px solid ${bt.color}` : '2px solid transparent',
                                color: buffType === bt.id ? bt.color : 'var(--text-secondary)',
                                textAlign: 'center', fontWeight: 600,
                            }}>
                                <div style={{ fontSize: '1.25rem' }}>{bt.label.split(' ')[0]}</div>
                                <div style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>{bt.desc}</div>
                            </button>
                        ))}
                    </div>
                    <label style={{ color: 'var(--text-muted)', fontSize: '0.8rem', display: 'block', marginBottom: '0.5rem' }}>Yakılacak MON</label>
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
                        {['0.1', '0.5', '1', '5'].map(v => (
                            <button key={v} onClick={() => setBuffAmount(v)} style={{
                                flex: 1, padding: '0.4rem', borderRadius: '6px', cursor: 'pointer',
                                background: buffAmount === v ? 'var(--accent-orange)' : 'var(--bg-tertiary)',
                                border: 'none', color: buffAmount === v ? '#000' : 'var(--text-secondary)',
                                fontWeight: 600, fontSize: '0.85rem',
                            }}>{v}</button>
                        ))}
                    </div>
                    <input type="number" step="0.1" min="0.01" value={buffAmount} onChange={e => setBuffAmount(e.target.value)}
                        style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', marginBottom: '0.5rem' }}
                    />
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '1.5rem' }}>
                        Tahmini buff: +{Math.min(Math.round(parseFloat(buffAmount || 0) * 100), 500)} {BUFF_TYPES.find(b => b.id === buffType)?.label} puan
                    </p>
                    <div style={{ display: 'flex', gap: '0.75rem' }}>
                        <button onClick={() => setBuffAgent(null)} className="mc-btn-secondary" style={{ flex: 1 }}>İptal</button>
                        <button onClick={applyBuff} disabled={buffing} className="mc-btn-primary" style={{ flex: 2 }}>
                            {buffing ? '⏳ Yakılıyor...' : `🔥 ${buffAmount} MON Yak`}
                        </button>
                    </div>
                </Modal>
            )}

            {/* ===== DETAIL PANEL ===== */}
            {selectedAgent && (() => {
                const agent = agents.find(a => a.id === selectedAgent)
                if (!agent) return null
                const bal = balances[agent.id]?.balanceMON ?? 0
                const fin = financial || agent.financial || { initialDeposit: 0, totalDeposited: 0, totalWithdrawn: 0 }
                const netPL = bal + fin.totalWithdrawn - fin.totalDeposited

                return (
                    <div className="combat-log-panel" style={{ marginTop: '1.5rem', padding: '1.5rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                            <h3 style={{ color: 'var(--text-primary)', margin: 0 }}>📋 {agent.name} — Detaylar</h3>
                            <button onClick={() => setSelectedAgent(null)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.25rem' }}>✕</button>
                        </div>

                        {/* Financial Summary */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
                            <FinCard icon="💰" label="Mevcut Bakiye" value={`${bal.toFixed(4)} MON`} color="var(--accent-gold)" />
                            <FinCard icon="📥" label="Toplam Yatırılan" value={`${fin.totalDeposited.toFixed(2)} MON`} color="#3b82f6" />
                            <FinCard icon="📤" label="Toplam Çekilen" value={`${fin.totalWithdrawn.toFixed(2)} MON`} color="#a855f7" />
                            <FinCard icon="📈" label="Net Kâr/Zarar" value={`${netPL >= 0 ? '+' : ''}${netPL.toFixed(4)} MON`} color={netPL >= 0 ? '#22c55e' : '#ef4444'} />
                            <FinCard icon="🏆" label="G / M" value={`${agent.stats?.wins || 0}W / ${agent.stats?.losses || 0}L`} color="var(--text-primary)" />
                        </div>

                        {/* Agent Info Grid */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
                            <InfoItem label="Ajan ID" value={agent.id} mono />
                            <InfoItem label="Cüzdan" value={agent.agentWalletAddress ? `${agent.agentWalletAddress.slice(0, 8)}...${agent.agentWalletAddress.slice(-6)}` : 'N/A'} mono />
                            <InfoItem label="Durum" value={STATUS_MAP[agent.status]?.label || 'Boşta'} />
                            <InfoItem label="Oluşturulma" value={new Date(agent.createdAt).toLocaleDateString('tr-TR')} />
                        </div>

                        {/* ─── Profit / Auto-Withdraw Settings ─── */}
                        <div style={{ background: 'var(--bg-tertiary)', padding: '1rem', borderRadius: '10px', marginBottom: '1rem', border: '1px solid var(--border-color)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                <p style={{ color: 'var(--text-primary)', fontSize: '0.85rem', fontWeight: 700, margin: 0 }}>⚙️ Kâr Hedefi & Otomatik Çekim</p>
                                {!editingSettings ? (
                                    <button onClick={() => setEditingSettings(true)} style={{
                                        background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--accent-cyan)',
                                        padding: '0.25rem 0.6rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.75rem',
                                    }}>✏️ Düzenle</button>
                                ) : (
                                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                                        <button onClick={saveSettings} disabled={savingSettings} style={{
                                            background: '#22c55e20', border: '1px solid #22c55e', color: '#22c55e',
                                            padding: '0.25rem 0.6rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.75rem',
                                        }}>{savingSettings ? '⏳' : '💾 Kaydet'}</button>
                                        <button onClick={() => setEditingSettings(false)} style={{
                                            background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-muted)',
                                            padding: '0.25rem 0.6rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.75rem',
                                        }}>İptal</button>
                                    </div>
                                )}
                            </div>
                            {!editingSettings ? (
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                                    <div>
                                        <p style={{ color: 'var(--text-muted)', fontSize: '0.7rem', margin: 0 }}>🎯 Kâr Hedefi (çarpan)</p>
                                        <p style={{ color: 'var(--accent-gold)', fontWeight: 700, fontFamily: 'var(--font-mono)', margin: '0.15rem 0 0' }}>{agent.strategyParams?.profitTarget ?? 2}x</p>
                                    </div>
                                    <div>
                                        <p style={{ color: 'var(--text-muted)', fontSize: '0.7rem', margin: 0 }}>🏧 Çekim Eşiği (MON)</p>
                                        <p style={{ color: '#a855f7', fontWeight: 700, fontFamily: 'var(--font-mono)', margin: '0.15rem 0 0' }}>{agent.strategyParams?.withdrawThreshold ?? 0.5} MON</p>
                                    </div>
                                </div>
                            ) : (
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                                    <div>
                                        <label style={{ color: 'var(--text-muted)', fontSize: '0.7rem', display: 'block', marginBottom: '0.25rem' }}>🎯 Kâr Hedefi (çarpan)</label>
                                        <input type="number" step="0.1" min="1.1" value={settingsProfitTarget}
                                            onChange={e => setSettingsProfitTarget(e.target.value)}
                                            style={{ width: '100%', padding: '0.4rem', borderRadius: '6px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: '0.85rem', boxSizing: 'border-box' }}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ color: 'var(--text-muted)', fontSize: '0.7rem', display: 'block', marginBottom: '0.25rem' }}>🏧 Çekim Eşiği (MON)</label>
                                        <input type="number" step="0.1" min="0.01" value={settingsWithdrawThreshold}
                                            onChange={e => setSettingsWithdrawThreshold(e.target.value)}
                                            style={{ width: '100%', padding: '0.4rem', borderRadius: '6px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: '0.85rem', boxSizing: 'border-box' }}
                                        />
                                    </div>
                                </div>
                            )}
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginTop: '0.5rem', marginBottom: 0 }}>
                                💡 Bakiye = İlk yatırım × kâr hedefi olduğunda, fazla kısım otomatik cüzdanınıza geri gönderilir.
                            </p>
                        </div>

                        {/* Strategy Code */}
                        {agent.strategy && (
                            <div style={{ marginBottom: '1rem' }}>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '0.25rem' }}>Strateji Kodu</p>
                                <pre style={{
                                    background: 'var(--bg-primary, #0a0a1a)', padding: '0.75rem', borderRadius: '8px',
                                    overflow: 'auto', maxHeight: '120px', fontSize: '0.75rem',
                                    color: 'var(--accent-cyan, #22d3ee)',
                                }}>
                                    {agent.strategy}
                                </pre>
                            </div>
                        )}

                        {/* Transfer History */}
                        {transfers.length > 0 && (
                            <div>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '0.5rem' }}>📜 Son İşlem Geçmişi</p>
                                <div style={{ maxHeight: '200px', overflow: 'auto' }}>
                                    {transfers.slice().reverse().slice(0, 20).map((tx, i) => (
                                        <div key={i} style={{
                                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                            padding: '0.4rem 0.6rem', borderBottom: '1px solid var(--border-color)',
                                            fontSize: '0.75rem',
                                        }}>
                                            <span style={{ color: tx.type === 'deposit' ? '#22c55e' : tx.type === 'auto_withdraw' ? '#a855f7' : tx.type === 'manual_withdraw' ? '#f97316' : 'var(--text-secondary)' }}>
                                                {tx.type === 'deposit' ? '📥 Yatırma' : tx.type === 'auto_withdraw' ? '📤 Oto-Çekim' : tx.type === 'manual_withdraw' ? '📤 Manuel Çekim' : tx.type}
                                            </span>
                                            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                                                {tx.type === 'deposit' ? '+' : '-'}{tx.amount} MON
                                            </span>
                                            <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>
                                                {new Date(tx.timestamp).toLocaleString('tr-TR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                                            </span>
                                            {tx.txHash && (
                                                <a href={`https://testnet.monadvision.com/tx/${tx.txHash}`} target="_blank" rel="noreferrer"
                                                    style={{ color: 'var(--accent-cyan)', fontSize: '0.65rem' }}>
                                                    🔗
                                                </a>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )
            })()}
        </div>
    )
}

// ─── Helper Components ────────────────────────────────────────────────────────

function Modal({ children, onClose }) {
    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000,
        }} onClick={onClose}>
            <div className="mc-card" style={{ padding: '2rem', maxWidth: '450px', width: '90%' }} onClick={e => e.stopPropagation()}>
                {children}
            </div>
        </div>
    )
}

function FinCard({ icon, label, value, color }) {
    return (
        <div style={{
            background: 'var(--bg-tertiary)', padding: '0.75rem', borderRadius: '8px',
            textAlign: 'center', border: '1px solid var(--border-color)',
        }}>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.65rem', margin: 0 }}>{icon} {label}</p>
            <p style={{ color, fontWeight: 700, fontSize: '0.95rem', fontFamily: 'var(--font-mono)', margin: '0.25rem 0 0' }}>{value}</p>
        </div>
    )
}

function InfoItem({ label, value, mono }) {
    return (
        <div>
            <p style={{ color: 'var(--text-muted, #888)', fontSize: '0.7rem', margin: 0, textTransform: 'uppercase' }}>{label}</p>
            <p style={{
                color: 'var(--text-primary, #e0e0e0)', margin: '0.15rem 0 0',
                fontWeight: 600, fontSize: '0.9rem',
                fontFamily: mono ? 'monospace' : 'inherit', wordBreak: 'break-all',
            }}>{value}</p>
        </div>
    )
}
