import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          background: 'var(--bg-deep)',
          color: 'var(--text-primary)',
          padding: '40px',
          textAlign: 'center',
        }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
            style={{ width: 48, height: 48, color: 'var(--text-muted)', marginBottom: 20 }}>
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: 8 }}>页面出现错误</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 24, maxWidth: 400 }}>
            {this.state.error?.message || '发生了未知错误'}
          </p>
          <button onClick={this.handleReload} style={{
            padding: '10px 24px',
            borderRadius: 8,
            background: 'var(--accent)',
            color: 'var(--bg-deep)',
            fontWeight: 600,
            fontSize: '0.88rem',
            border: 'none',
            cursor: 'pointer',
          }}>
            重试
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
