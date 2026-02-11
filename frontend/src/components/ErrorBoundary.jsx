/**
 * ErrorBoundary - React Error Boundary Component
 * Catches JavaScript errors in child components and displays fallback UI
 */
import React from 'react';

export class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        console.error('[ErrorBoundary] Caught error:', error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{
                    padding: '2rem',
                    textAlign: 'center',
                    background: 'var(--bg-tertiary)',
                    borderRadius: '12px',
                    border: '1px solid var(--border-primary)',
                    margin: '2rem auto',
                    maxWidth: '500px'
                }}>
                    <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>😔</div>
                    <h2 style={{ color: 'var(--accent-red)', margin: '0 0 0.75rem', fontSize: '1.25rem' }}>
                        Bir hata oluştu
                    </h2>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                        {this.state.error?.message || 'Beklenmedik bir hata meydana geldi.'}
                    </p>
                    <button
                        onClick={() => window.location.reload()}
                        className="mc-btn-primary"
                        style={{ padding: '0.75rem 1.5rem' }}
                    >
                        🔄 Sayfayı Yenile
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}

export default ErrorBoundary;
