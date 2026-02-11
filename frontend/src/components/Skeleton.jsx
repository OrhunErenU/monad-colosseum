/**
 * Skeleton Loading Components
 * Shimmer placeholders for loading states
 */
import React from 'react';

export function SkeletonCard({ width = '100%', height = '120px', style = {} }) {
    return (
        <div
            className="mc-skeleton"
            style={{
                width,
                height,
                background: 'linear-gradient(90deg, var(--bg-tertiary) 25%, var(--bg-secondary) 50%, var(--bg-tertiary) 75%)',
                backgroundSize: '200% 100%',
                animation: 'shimmer 1.5s infinite',
                borderRadius: '12px',
                ...style,
            }}
        />
    );
}

export function SkeletonList({ count = 5, height = '80px' }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {[...Array(count)].map((_, i) => (
                <SkeletonCard key={i} height={height} />
            ))}
        </div>
    );
}

export function SkeletonText({ width = '60%', height = '1rem' }) {
    return <SkeletonCard width={width} height={height} style={{ borderRadius: '4px' }} />;
}

export function SkeletonAgentCard() {
    return (
        <div className="agent-card" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
                <SkeletonCard width="48px" height="48px" style={{ borderRadius: '50%' }} />
                <div style={{ flex: 1 }}>
                    <SkeletonText width="40%" height="1.2rem" />
                    <SkeletonText width="70%" height="0.8rem" style={{ marginTop: '0.5rem' }} />
                </div>
            </div>
            <SkeletonCard height="60px" />
        </div>
    );
}

export function SkeletonArenaCard() {
    return (
        <div className="agent-card" style={{ padding: '2rem', textAlign: 'center' }}>
            <SkeletonText width="50%" height="1.4rem" style={{ margin: '0 auto 1rem' }} />
            <SkeletonText width="80%" height="0.9rem" style={{ margin: '0 auto 1.5rem' }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                <SkeletonCard height="50px" />
                <SkeletonCard height="50px" />
            </div>
            <SkeletonCard height="44px" />
        </div>
    );
}
