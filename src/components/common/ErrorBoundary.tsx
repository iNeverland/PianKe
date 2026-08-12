import { Component, type ReactNode } from 'react';
import AppIcon from './AppIcon';

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
          <AppIcon name="warning" style={{ width: 48, height: 48, color: 'var(--text-muted)', marginBottom: 20 }} />
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
