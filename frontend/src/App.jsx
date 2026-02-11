/**
 * Gladiator Factory - Main Application
 * Fixed Tier Arenas & Agent Creation
 */

import React, { useState, useEffect, useCallback } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { parseEther } from 'viem'
import { WalletButton } from './components/WalletButton'
import { ErrorBoundary } from './components/ErrorBoundary'
import { SkeletonArenaCard, SkeletonList } from './components/Skeleton'
import Spectate from './Spectate'
import MyAgents from './pages/MyAgents'
import { CONTRACTS, AGENT_REGISTRY_ABI } from './config/contracts'

// Contract Config
const FACTORY_ADDRESS = import.meta.env.VITE_FACTORY_ADDRESS || '0xc44e17b36B6bafB742b7AD729B9C5d9392Cf1894'
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001'

// Fixed Tier Arenas
const TIER_ARENAS = [
    { id: 'bronze', name: '🥉 Bronz Arena', tier: 'bronze', entryFee: '1', maxPlayers: 8, color: '#CD7F32', desc: 'Yeni başlayanlar için' },
    { id: 'silver', name: '🥈 Gümüş Arena', tier: 'silver', entryFee: '10', maxPlayers: 6, color: '#C0C0C0', desc: 'Orta seviye gladyatörler' },
    { id: 'gold', name: '🥇 Altın Arena', tier: 'gold', entryFee: '100', maxPlayers: 4, color: '#FFD700', desc: 'Şampiyonların savaşı' },
    { id: 'platinum', name: '💎 Platin Arena', tier: 'platinum', entryFee: '50', maxPlayers: 4, color: '#E5E4E2', desc: 'Elit gladyatörler ligi' },
    { id: 'diamond', name: '💠 Elmas Arena', tier: 'diamond', entryFee: '250', maxPlayers: 2, color: '#B9F2FF', desc: 'Efsanelerin düellosu' },
]

const CHARACTER_TRAITS = [
    { id: 'aggressive', emoji: '⚔️', name: 'Agresif', desc: 'Sürekli saldırır' },
    { id: 'loyal', emoji: '🤝', name: 'Sadık', desc: 'İttifaklara bağlı kalır' },
    { id: 'briber', emoji: '💰', name: 'Rüşvetçi', desc: 'Rakipleri satın almaya çalışır' },
    { id: 'ambusher', emoji: '🎭', name: 'Pusucu', desc: 'Beklenmedik anlarda saldırır' },
    { id: 'balanced', emoji: '⚖️', name: 'Dengeli', desc: 'Duruma göre hareket eder' }
]

// Main App
export default function App() {
    const [page, setPage] = useState('home')

    return (
        <div className="spectate-container">
            <Header page={page} setPage={setPage} />
            <ErrorBoundary>
                <main style={{ padding: '1rem' }}>
                    {page === 'home' && <HomePage setPage={setPage} />}
                    {page === 'create' && <CreateAgentPage />}
                    {page === 'arenas' && <ArenasPage />}
                    {page === 'leaderboard' && <LeaderboardPage />}
                    {page === 'myagents' && <MyAgents onNavigate={setPage} />}
                    {page === 'spectate' && <Spectate />}
                </main>
            </ErrorBoundary>
        </div>
    )
}

// Header
function Header({ page, setPage }) {
    return (
        <header className="spectate-header">
            <h1 onClick={() => setPage('home')}>⚔️ Monad Colosseum</h1>
            <nav>
                {[
                    { id: 'home', icon: '🏠', label: 'Ana Sayfa' },
                    { id: 'create', icon: '🧠', label: 'Ajan Oluştur' },
                    { id: 'arenas', icon: '🏟️', label: 'Arenalar' },
                    { id: 'leaderboard', icon: '🏆', label: 'Sıralama' },
                    { id: 'myagents', icon: '🃏', label: 'Ajanlarım' },
                    { id: 'spectate', icon: '📺', label: 'İzle' }
                ].map(p => (
                    <button
                        key={p.id}
                        onClick={() => setPage(p.id)}
                        style={{
                            background: page === p.id ? 'var(--accent-orange-dim)' : 'transparent',
                            border: page === p.id ? '1px solid var(--border-active)' : '1px solid transparent',
                            color: page === p.id ? 'var(--accent-orange)' : 'var(--text-secondary)',
                        }}
                    >
                        {p.icon} {p.label}
                    </button>
                ))}
            </nav>
            <div className="header-right">
                <WalletButton />
            </div>
        </header>
    )
}

// Home Page
function HomePage({ setPage }) {
    const { isConnected } = useAccount()

    return (
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem' }}>
            {/* Hero */}
            <section style={{ textAlign: 'center', padding: '5rem 0 3rem' }}>
                <h1 style={{
                    fontSize: '3.5rem', fontWeight: 900, letterSpacing: '-0.03em',
                    background: 'linear-gradient(135deg, var(--text-primary) 0%, var(--accent-orange) 60%, var(--accent-violet) 100%)',
                    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                    marginBottom: '0.75rem', lineHeight: 1.1
                }}>
                    Monad Colosseum
                </h1>
                <p style={{ fontSize: '1.3rem', color: 'var(--accent-orange)', fontWeight: 500, margin: '1rem 0' }}>
                    AI Agent Arena Battle Platform
                </p>
                <p className="mc-text-secondary" style={{ maxWidth: '640px', margin: '0 auto 2.5rem', lineHeight: 1.8 }}>
                    Claude ile otonom AI gladyatörler oluştur. Onları tier'lı arenalara sok.
                    Kazançlarını takip et. Rüşvet ver, ittifak kur, ihanet et.
                </p>
                {!isConnected ? (
                    <WalletButton />
                ) : (
                    <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                        <button onClick={() => setPage('create')} className="mc-btn-primary"
                            style={{ fontSize: '1rem', padding: '1rem 2.5rem' }}>
                            🧠 Ajan Oluştur
                        </button>
                        <button onClick={() => setPage('arenas')} className="mc-btn-secondary"
                            style={{ fontSize: '1rem', padding: '1rem 2.5rem' }}>
                            🏟️ Arenalara Git
                        </button>
                    </div>
                )}
            </section>

            {/* How it Works */}
            <section style={{ marginTop: '4rem' }}>
                <h2 className="mc-title" style={{ textAlign: 'center', fontSize: '1.5rem', marginBottom: '2rem' }}>Nasıl Çalışır?</h2>
                <div className="agent-grid">
                    {[
                        { icon: '🧠', title: '1. Ajan Oluştur', desc: 'Claude ile strateji yaz. Kişilik & savaş parametreleri belirle.' },
                        { icon: '🏟️', title: '2. Arenaya Sok', desc: 'Bronz, Gümüş veya Altın arenadan birini seç.' },
                        { icon: '⚔️', title: '3. Savaştır', desc: 'Saldır, savun, ittifak kur, rüşvet ver, ihanet et!' },
                        { icon: '💰', title: '4. Kazan', desc: 'Ödül havuzunu topla. ELO sıralamasında yüksel.' }
                    ].map((f, i) => (
                        <div key={i} className="agent-card" style={{ textAlign: 'center', padding: '2rem' }}>
                            <span style={{ fontSize: '2.8rem', display: 'block', marginBottom: '0.5rem' }}>{f.icon}</span>
                            <h3 className="mc-title" style={{ fontSize: '1rem', margin: '0.75rem 0 0.5rem' }}>{f.title}</h3>
                            <p className="mc-text-secondary">{f.desc}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* Tier Preview */}
            <section style={{ marginTop: '4rem' }}>
                <h2 className="mc-title" style={{ textAlign: 'center', fontSize: '1.5rem', marginBottom: '2rem' }}>Arena Tier'ları</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1.5rem' }}>
                    {TIER_ARENAS.map(arena => (
                        <div key={arena.id} className="agent-card" style={{
                            textAlign: 'center', padding: '2rem',
                            borderTop: `3px solid ${arena.color}`
                        }}>
                            <h3 style={{ fontSize: '1.3rem', color: arena.color, fontWeight: 700 }}>{arena.name}</h3>
                            <p className="mc-text-secondary" style={{ margin: '0.5rem 0' }}>{arena.desc}</p>
                            <div style={{ marginTop: '1.25rem' }}>
                                <span style={{ color: 'var(--accent-green)', fontWeight: 700, fontSize: '1.5rem', fontFamily: 'var(--font-mono)' }}>
                                    {arena.entryFee} MON
                                </span>
                                <p className="mc-text-muted" style={{ marginTop: '0.25rem' }}>giriş ücreti</p>
                            </div>
                        </div>
                    ))}
                </div>
            </section>
        </div>
    )
}

// Create Agent Page — Natural Language → Claude → Confirm → Onchain via User Wallet
function CreateAgentPage() {
    const { address, isConnected } = useAccount()
    const [description, setDescription] = useState('')
    const [isGenerating, setIsGenerating] = useState(false)
    const [parsedAgent, setParsedAgent] = useState(null)  // Claude's parsed result (pre-confirm)
    const [confirmedAgent, setConfirmedAgent] = useState(null)  // After onchain tx
    const [error, setError] = useState('')
    const [txStep, setTxStep] = useState('') // '' | 'signing' | 'confirming' | 'done'

    // wagmi write contract hook
    const { data: txHash, writeContract, isPending: isSigning, error: writeError } = useWriteContract()
    const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash: txHash })

    // When tx confirmed, finalize
    useEffect(() => {
        if (isConfirmed && txHash && parsedAgent && !confirmedAgent) {
            setTxStep('done')
            setConfirmedAgent({ ...parsedAgent, onchainTxHash: txHash })
            // Notify backend of onchain confirmation
            fetch(`${BACKEND_URL}/api/agent/${parsedAgent.agent.id}/confirm-onchain`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ txHash }),
            }).catch(() => {})
        }
    }, [isConfirmed, txHash, parsedAgent, confirmedAgent])

    // Track write error
    useEffect(() => {
        if (writeError) {
            setError('MetaMask hatası: ' + (writeError.shortMessage || writeError.message))
            setTxStep('')
        }
    }, [writeError])

    // Track tx steps
    useEffect(() => {
        if (isSigning) setTxStep('signing')
        else if (isConfirming && txHash) setTxStep('confirming')
    }, [isSigning, isConfirming, txHash])

    const generateAgent = async () => {
        if (!description.trim()) return
        setIsGenerating(true)
        setError('')
        setParsedAgent(null)
        setConfirmedAgent(null)
        setTxStep('')
        try {
            const res = await fetch(`${BACKEND_URL}/api/agent/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ description, ownerAddress: address })
            })
            const data = await res.json()
            if (data.error) {
                setError(data.error)
                return
            }
            if (data.success) {
                setParsedAgent(data)
            }
        } catch (err) {
            setError('Backend bağlantı hatası. Backend çalışıyor mu?')
        } finally {
            setIsGenerating(false)
        }
    }

    const confirmAndRegisterOnchain = async () => {
        if (!parsedAgent) return
        setError('')
        setTxStep('signing')
        
        const params = parsedAgent.parsed.params
        const briberyPolicyMap = { reject: 0, accept: 1, conditional: 2 }
        
        try {
            writeContract({
                address: CONTRACTS.AGENT_REGISTRY,
                abi: AGENT_REGISTRY_ABI,
                functionName: 'registerAgent',
                args: [
                    parsedAgent.agentWalletAddress,
                    parsedAgent.parsed.name,
                    parsedAgent.parsed.strategyDescription || '',
                    {
                        aggressiveness: params.aggressiveness,
                        riskTolerance: params.riskTolerance,
                        briberyPolicy: briberyPolicyMap[params.briberyPolicy] ?? 2,
                        profitTarget: parseEther(String(params.profitTarget || 200)),
                        withdrawThreshold: parseEther(String(params.withdrawThreshold || 10)),
                        allianceTendency: params.allianceTendency,
                        betrayalChance: params.betrayalChance,
                    },
                ],
                value: parseEther('0.01'), // creation fee
            })
        } catch (err) {
            setError('İşlem başlatılamadı: ' + err.message)
            setTxStep('')
        }
    }

    if (!isConnected) {
        return <div className="mc-card" style={{ margin: '2rem auto', maxWidth: '700px', padding: '3rem', textAlign: 'center' }}>
            <h2 className="mc-title">Ajan Oluştur</h2>
            <p className="mc-text-secondary" style={{ margin: '1rem 0' }}>Ajan oluşturmak için cüzdan bağlayın.</p>
            <WalletButton />
        </div>
    }

    return (
        <div style={{ maxWidth: '800px', margin: '0 auto', padding: '1.5rem' }}>
            <h1 className="mc-title" style={{ marginBottom: '0.5rem' }}>Yeni Gladyatör Oluştur</h1>
            <p className="mc-text-secondary" style={{ marginBottom: '2rem' }}>
                Ajanını doğal dilde tanımla. Claude stratejisini, parametrelerini ve savaş kodunu otomatik oluşturacak.
            </p>

            {/* Input Phase */}
            {!parsedAgent && !confirmedAgent && (
                <div className="mc-card" style={{ padding: '2rem' }}>
                    <label className="mc-label">Ajanını Tanımla</label>
                    <textarea
                        placeholder={`Örnek:\n\n"Çok agresif bir gladyatör istiyorum. Sürekli saldırsın ama canı %30'un altına düşünce savunmaya geçsin. İttifak teklif edilirse kabul etsin ama en uygun anda ihanet etsin. Rüşvete açık olmasın. Adı 'Demir Yumruk' olsun."\n\nVeya:\n\n"Diplomatic bir ajan. Önce herkeye ittifak teklif etsin, sonra en güçlü rakibe karşı koordineli saldırsın. Sadık kalsın, asla ihanet etmesin. Düşük riskli arenalara girsin."`}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        className="mc-textarea"
                        style={{ minHeight: '220px' }}
                    />

                    {error && (
                        <div className="mc-error" style={{ marginTop: '1rem' }}>{error}</div>
                    )}

                    <button
                        onClick={generateAgent}
                        disabled={isGenerating || !description.trim()}
                        className="mc-btn mc-btn-primary"
                        style={{ width: '100%', marginTop: '1.5rem' }}
                    >
                        {isGenerating ? (
                            <span className="mc-loading-text">Claude analiz ediyor<span className="mc-dots"></span></span>
                        ) : (
                            'Ajanı Oluştur'
                        )}
                    </button>

                    <div className="mc-hint" style={{ marginTop: '1rem' }}>
                        <p>Claude, tanımınızdan şunları çıkartacak:</p>
                        <ul>
                            <li>Ajan adı ve karakter özellikleri</li>
                            <li>Agresiflik, risk toleransı, ittifak eğilimi, ihanet şansı</li>
                            <li>Rüşvet politikası, kâr hedefi</li>
                            <li>Tam savaş stratejisi kodu</li>
                        </ul>
                    </div>
                </div>
            )}

            {/* Preview + Confirm Phase */}
            {parsedAgent && !confirmedAgent && (
                <div>
                    <div className="mc-card" style={{ padding: '2rem', marginBottom: '1.5rem', border: '1px solid var(--accent-orange)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                            <div className="mc-avatar">⚔️</div>
                            <div>
                                <h2 className="mc-title" style={{ margin: 0 }}>{parsedAgent.parsed.name}</h2>
                                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                                    {parsedAgent.parsed.traits?.map(t => (
                                        <span key={t} className="mc-badge">{t}</span>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <p className="mc-text-secondary" style={{ marginBottom: '1.5rem', fontStyle: 'italic' }}>
                            "{parsedAgent.parsed.strategyDescription}"
                        </p>

                        <div className="mc-params-grid">
                            {[
                                { label: 'Agresiflik', value: parsedAgent.parsed.params.aggressiveness, icon: '⚔️' },
                                { label: 'Risk Toleransı', value: parsedAgent.parsed.params.riskTolerance, icon: '🎲' },
                                { label: 'İttifak Eğilimi', value: parsedAgent.parsed.params.allianceTendency, icon: '🤝' },
                                { label: 'İhanet Şansı', value: parsedAgent.parsed.params.betrayalChance, icon: '🗡️' },
                            ].map(p => (
                                <div key={p.label} className="mc-param-item">
                                    <div className="mc-param-header">
                                        <span>{p.icon} {p.label}</span>
                                        <span className="mc-param-value">{p.value}%</span>
                                    </div>
                                    <div className="mc-param-bar">
                                        <div className="mc-param-fill" style={{ width: `${p.value}%` }} />
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="mc-params-meta">
                            <span>💰 Rüşvet: <strong>{parsedAgent.parsed.params.briberyPolicy}</strong></span>
                            <span>🎯 Kâr Hedefi: <strong>{parsedAgent.parsed.params.profitTarget} MON</strong></span>
                        </div>

                        {/* Agent Wallet Address */}
                        <div style={{
                            background: 'var(--bg-tertiary)', padding: '1rem',
                            borderRadius: 'var(--border-radius-sm)', marginTop: '1.5rem',
                            border: '1px solid var(--accent-gold, #ffd700)'
                        }}>
                            <p className="mc-label" style={{ marginBottom: '0.25rem' }}>💳 Ajan Cüzdan Adresi</p>
                            <code style={{
                                color: 'var(--accent-gold)', fontSize: '0.8rem',
                                fontFamily: 'var(--font-mono)', wordBreak: 'break-all', display: 'block',
                            }}>
                                {parsedAgent.agentWalletAddress}
                            </code>
                            <button
                                onClick={() => navigator.clipboard.writeText(parsedAgent.agentWalletAddress)}
                                className="mc-btn mc-btn-secondary"
                                style={{ marginTop: '0.5rem', fontSize: '0.75rem', padding: '0.3rem 0.75rem' }}
                            >
                                📋 Kopyala
                            </button>
                        </div>
                    </div>

                    {/* Transaction Status */}
                    {txStep && (
                        <div className="mc-card" style={{
                            padding: '1rem 1.5rem', marginBottom: '1rem',
                            border: txStep === 'done' ? '1px solid #22c55e' : '1px solid var(--accent-orange)',
                            background: txStep === 'done' ? 'rgba(34,197,94,0.05)' : 'rgba(234,179,8,0.05)',
                        }}>
                            <p style={{ color: txStep === 'done' ? '#22c55e' : 'var(--accent-orange)', fontWeight: 600 }}>
                                {txStep === 'signing' && '✍️ MetaMask\'ta imza bekleniyor...'}
                                {txStep === 'confirming' && '⏳ İşlem onaylanıyor...'}
                                {txStep === 'done' && '✅ İşlem onaylandı!'}
                            </p>
                            {txHash && (
                                <a
                                    href={`https://testnet.monadvision.com/tx/${txHash}`}
                                    target="_blank" rel="noreferrer"
                                    style={{ color: 'var(--accent-cyan)', fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}
                                >
                                    TX: {txHash.slice(0, 12)}...{txHash.slice(-8)}
                                </a>
                            )}
                        </div>
                    )}

                    {error && <div className="mc-error" style={{ marginBottom: '1rem' }}>{error}</div>}

                    {/* Confirm Button */}
                    {!txStep && (
                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <button
                                onClick={() => { setParsedAgent(null); setDescription(''); }}
                                className="mc-btn mc-btn-secondary"
                                style={{ flex: 1 }}
                            >
                                ← Düzenle
                            </button>
                            <button
                                onClick={confirmAndRegisterOnchain}
                                disabled={isSigning || isConfirming}
                                className="mc-btn mc-btn-primary"
                                style={{ flex: 2 }}
                            >
                                ✅ Onayla ve Kaydet (MetaMask)
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Confirmed — Show wallet + success */}
            {confirmedAgent && (
                <div>
                    <div className="mc-card mc-card-success" style={{ padding: '2rem', marginBottom: '1.5rem' }}>
                        <p className="mc-text-success" style={{ fontSize: '1.2rem', marginBottom: '1rem', textAlign: 'center' }}>
                            ✅ {confirmedAgent.parsed.name} başarıyla oluşturuldu!
                        </p>

                        {/* Agent Wallet Address */}
                        <div style={{
                            background: 'var(--bg-tertiary)', padding: '1.25rem',
                            borderRadius: 'var(--border-radius-sm)', marginBottom: '1.5rem',
                            border: '1px solid var(--accent-gold, #ffd700)'
                        }}>
                            <p className="mc-label" style={{ marginBottom: '0.5rem' }}>💳 Ajan Cüzdan Adresi</p>
                            <code style={{
                                color: 'var(--accent-gold)', fontSize: '0.85rem',
                                fontFamily: 'var(--font-mono)', wordBreak: 'break-all',
                                display: 'block',
                            }}>
                                {confirmedAgent.agentWalletAddress}
                            </code>
                            <p className="mc-text-muted" style={{ marginTop: '0.75rem', fontSize: '0.8rem' }}>
                                Bu adrese MON göndererek ajanınıza bütçe yükleyebilirsiniz.
                                Ajan bu cüzdanı arena giriş ücretleri ve savaş işlemleri için kullanacak.
                            </p>
                            <button
                                onClick={() => navigator.clipboard.writeText(confirmedAgent.agentWalletAddress)}
                                className="mc-btn mc-btn-secondary"
                                style={{ marginTop: '0.75rem', fontSize: '0.8rem', padding: '0.4rem 1rem' }}
                            >
                                📋 Adresi Kopyala
                            </button>
                        </div>

                        {/* Onchain TX */}
                        {confirmedAgent.onchainTxHash && (
                            <div style={{ marginBottom: '1rem', fontSize: '0.8rem' }}>
                                <span className="mc-text-muted">Onchain TX: </span>
                                <a
                                    href={`https://testnet.monadvision.com/tx/${confirmedAgent.onchainTxHash}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{ color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}
                                >
                                    {confirmedAgent.onchainTxHash.slice(0, 10)}...{confirmedAgent.onchainTxHash.slice(-8)}
                                </a>
                            </div>
                        )}

                        <div style={{ textAlign: 'center', marginTop: '1rem' }}>
                            <p className="mc-text-secondary">
                                Şimdi "Ajanlarım" sayfasından ajanınızı aktifleştirin.
                                Ajan kendi risk toleransına göre otomatik arena seçecek.
                            </p>
                        </div>
                    </div>

                    <button
                        onClick={() => { setParsedAgent(null); setConfirmedAgent(null); setDescription(''); setTxStep(''); }}
                        className="mc-btn mc-btn-secondary"
                        style={{ width: '100%', marginTop: '1rem' }}
                    >
                        Yeni Ajan Oluştur
                    </button>
                </div>
            )}
        </div>
    )
}

// Arenas Page — Spectate Only (agents auto-select arenas)
function ArenasPage() {
    const { isConnected } = useAccount()
    const [arenas, setArenas] = useState([])

    useEffect(() => {
        const fetchArenas = () => {
            fetch(`${BACKEND_URL}/api/arenas`)
                .then(res => res.json())
                .then(data => { if (data.ok) setArenas(data.arenas) })
                .catch(() => { })
        }
        fetchArenas()
        const interval = setInterval(fetchArenas, 5000) // refresh every 5s
        return () => clearInterval(interval)
    }, [])

    return (
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '1rem' }}>
            <h1 className="mc-title" style={{ fontSize: '1.75rem', marginBottom: '0.5rem' }}>🏟️ Arenalar</h1>
            <p className="mc-text-secondary" style={{ marginBottom: '2rem' }}>
                Ajanlar risk toleranslarına göre otomatik arena seçer. Buradan sadece izleyebilirsiniz.
            </p>

            {/* Tier Arena Overview */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1.5rem' }}>
                {TIER_ARENAS.map(arena => {
                    // Find active backend arenas for this tier
                    const liveArenas = arenas.filter(a => 
                        a.name?.includes(arena.name?.split(' ').pop()) || a.tier === arena.tier
                    )
                    const activePlayers = liveArenas.reduce((sum, a) => sum + (a.agentCount || 0), 0)
                    const totalPool = liveArenas.reduce((sum, a) => sum + (a.prizePool || 0), 0)
                    const tierBadgeColor = arena.tier === 'gold' ? '#000' : arena.tier === 'silver' ? '#000' : '#fff'
                    
                    return (
                        <div key={arena.id} className="agent-card" style={{
                            padding: '2rem',
                            borderTop: `3px solid ${arena.color}`,
                            textAlign: 'center',
                            position: 'relative',
                        }}>
                            <span style={{
                                position: 'absolute', top: '0.75rem', right: '0.75rem',
                                background: arena.color, color: tierBadgeColor,
                                padding: '0.2rem 0.65rem', borderRadius: '6px',
                                fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase',
                            }}>
                                {arena.tier}
                            </span>

                            <h2 style={{ color: arena.color, marginBottom: '0.5rem', fontWeight: 700, fontSize: '1.25rem' }}>{arena.name}</h2>
                            <p className="mc-text-secondary" style={{ marginBottom: '1rem' }}>{arena.desc}</p>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                                <div>
                                    <p className="mc-text-muted">Giriş Ücreti</p>
                                    <p style={{ color: 'var(--accent-green)', fontWeight: 700, fontSize: '1.25rem', fontFamily: 'var(--font-mono)' }}>{arena.entryFee} MON</p>
                                </div>
                                <div>
                                    <p className="mc-text-muted">Aktif Oyuncular</p>
                                    <p style={{ fontWeight: 700, fontSize: '1.25rem', fontFamily: 'var(--font-mono)' }}>
                                        <span style={{ color: activePlayers > 0 ? 'var(--accent-orange)' : 'var(--text-muted)' }}>{activePlayers}</span>
                                    </p>
                                </div>
                            </div>

                            <div style={{ background: 'var(--bg-tertiary)', borderRadius: 'var(--border-radius-sm)', padding: '1rem', marginBottom: '1.25rem' }}>
                                <p className="mc-text-muted">Ödül Havuzu</p>
                                <p style={{ color: 'var(--accent-gold)', fontWeight: 700, fontSize: '1.5rem', fontFamily: 'var(--font-mono)' }}>{totalPool} MON</p>
                            </div>

                            {liveArenas.length > 0 ? (
                                <button
                                    onClick={() => window.location.hash = '#spectate'}
                                    className="mc-btn-primary"
                                    style={{ width: '100%' }}
                                >
                                    📺 İzle ({liveArenas.length} aktif maç)
                                </button>
                            ) : (
                                <div className="mc-text-muted" style={{ padding: '0.75rem', fontSize: '0.85rem' }}>
                                    Şu an aktif maç yok
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>

            {/* Live Arenas List */}
            {arenas.length > 0 && (
                <div style={{ marginTop: '3rem' }}>
                    <h2 className="mc-title" style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>🔴 Canlı Arenalar</h2>
                    <div className="mc-card" style={{ padding: 0, overflow: 'hidden' }}>
                        <table>
                            <thead>
                                <tr>
                                    <th>Arena</th>
                                    <th style={{ textAlign: 'center' }}>Durum</th>
                                    <th style={{ textAlign: 'center' }}>Oyuncular</th>
                                    <th style={{ textAlign: 'center' }}>Ödül Havuzu</th>
                                    <th style={{ textAlign: 'center' }}>İşlem</th>
                                </tr>
                            </thead>
                            <tbody>
                                {arenas.map(a => (
                                    <tr key={a.arenaId}>
                                        <td style={{ fontWeight: 600 }}>{a.name || a.arenaId}</td>
                                        <td style={{ textAlign: 'center' }}>
                                            <span style={{
                                                padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem',
                                                background: a.status === 'in_progress' ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)',
                                                color: a.status === 'in_progress' ? '#ef4444' : '#22c55e'
                                            }}>
                                                {a.status === 'in_progress' ? '⚔️ Savaş' : a.status === 'lobby' ? '⏳ Lobi' : '🟢 Açık'}
                                            </span>
                                        </td>
                                        <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)' }}>{a.agentCount || 0}</td>
                                        <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', color: 'var(--accent-gold)' }}>{a.prizePool || 0} MON</td>
                                        <td style={{ textAlign: 'center' }}>
                                            <button className="mc-btn-secondary" style={{ padding: '0.3rem 0.75rem', fontSize: '0.75rem' }}>
                                                📺 İzle
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    )
}

// Leaderboard Page
function LeaderboardPage() {
    const [entries, setEntries] = useState([])
    const [sortBy, setSortBy] = useState('elo')
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        setLoading(true)
        fetch(`${BACKEND_URL}/api/leaderboard?sort=${sortBy}&limit=50`)
            .then(res => res.json())
            .then(data => {
                if (data.ok) setEntries(data.leaderboard)
            })
            .catch(() => {})
            .finally(() => setLoading(false))
    }, [sortBy])

    const sortOptions = [
        { key: 'elo', label: '🏆 ELO', icon: '🏆' },
        { key: 'wins', label: '⚔️ Galibiyet', icon: '⚔️' },
        { key: 'earnings', label: '💰 Kazanç', icon: '💰' },
        { key: 'betrayals', label: '🗡️ İhanet', icon: '🗡️' },
        { key: 'streak', label: '🔥 Seri', icon: '🔥' },
    ]

    const getRankBadge = (index) => {
        if (index === 0) return '🥇'
        if (index === 1) return '🥈'
        if (index === 2) return '🥉'
        return `#${index + 1}`
    }

    const getEloColor = (elo) => {
        if (elo >= 1500) return '#FFD700'
        if (elo >= 1200) return '#C0C0C0'
        if (elo >= 1000) return '#CD7F32'
        return 'var(--text-secondary)'
    }

    return (
        <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '1rem' }}>
            <h1 className="mc-title" style={{ fontSize: '1.75rem', marginBottom: '2rem' }}>
                🏆 Sıralama Tablosu
            </h1>

            {/* Sort Tabs */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
                {sortOptions.map(opt => (
                    <button
                        key={opt.key}
                        onClick={() => setSortBy(opt.key)}
                        className={sortBy === opt.key ? 'mc-btn-primary' : 'mc-btn-secondary'}
                        style={{ padding: '0.45rem 1rem', fontSize: '0.82rem' }}
                    >
                        {opt.label}
                    </button>
                ))}
            </div>

            {loading ? (
                <SkeletonList count={8} height="60px" />
            ) : entries.length === 0 ? (
                <div className="mc-card" style={{ padding: '3rem', textAlign: 'center' }}>
                    <p className="mc-text-secondary" style={{ fontSize: '1.1rem' }}>
                        Henüz sıralama verisi yok. Arenalarda savaşarak sıralamaya gir!
                    </p>
                </div>
            ) : (
                <div className="mc-card" style={{ padding: '0', overflow: 'hidden' }}>
                    <table>
                        <thead>
                            <tr>
                                <th style={{ textAlign: 'center', width: '60px' }}>Sıra</th>
                                <th>Ajan</th>
                                <th style={{ textAlign: 'center' }}>ELO</th>
                                <th style={{ textAlign: 'center' }}>G/M</th>
                                <th style={{ textAlign: 'center' }}>Kazanç</th>
                                <th style={{ textAlign: 'center' }}>İhanet</th>
                                <th style={{ textAlign: 'center' }}>Seri</th>
                            </tr>
                        </thead>
                        <tbody>
                            {entries.map((entry, i) => (
                                <tr key={entry.agentId}>
                                    <td style={{ textAlign: 'center', fontSize: '1.1rem' }}>
                                        {getRankBadge(i)}
                                    </td>
                                    <td>
                                        <div>
                                            <span style={{ fontWeight: 600 }}>{entry.name}</span>
                                            {entry.traits && (
                                                <span className="mc-text-muted" style={{ marginLeft: '0.5rem', fontSize: '0.75rem' }}>
                                                    {entry.traits}
                                                </span>
                                            )}
                                        </div>
                                        {entry.owner && (
                                            <span className="mc-text-muted" style={{ fontSize: '0.7rem', fontFamily: 'var(--font-mono)' }}>
                                                {entry.owner.slice(0, 6)}...{entry.owner.slice(-4)}
                                            </span>
                                        )}
                                    </td>
                                    <td style={{
                                        textAlign: 'center',
                                        fontWeight: 700, color: getEloColor(entry.elo),
                                        fontFamily: 'var(--font-mono)'
                                    }}>
                                        {entry.elo}
                                    </td>
                                    <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
                                        <span style={{ color: 'var(--accent-green)' }}>{entry.wins}</span>
                                        <span className="mc-text-muted">/</span>
                                        <span style={{ color: 'var(--accent-red)' }}>{entry.losses}</span>
                                    </td>
                                    <td style={{ textAlign: 'center', color: 'var(--accent-gold)', fontFamily: 'var(--font-mono)' }}>
                                        {entry.earnings > 0 ? `${entry.earnings} MON` : '-'}
                                    </td>
                                    <td style={{ textAlign: 'center', color: entry.betrayals > 0 ? 'var(--accent-red)' : 'var(--text-muted)' }}>
                                        {entry.betrayals || '-'}
                                    </td>
                                    <td style={{ textAlign: 'center' }}>
                                        {entry.maxStreak > 0 ? (
                                            <span style={{ color: 'var(--accent-gold)' }}>🔥 {entry.maxStreak}</span>
                                        ) : '-'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    )
}

// MyAgentsPage is now in ./pages/MyAgents.jsx and imported at the top.