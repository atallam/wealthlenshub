/**
 * ErrorBoundary.jsx — Per-tab React error boundary.
 *
 * Wraps each tab in App.jsx so a runtime error in one tab
 * doesn't crash the whole app. Shows a recovery card with
 * a retry button and the error message (collapsed by default).
 *
 * Usage:
 *   <ErrorBoundary tab="Holdings">
 *     <HoldingsTab ... />
 *   </ErrorBoundary>
 */

import { Component } from 'react';

const STYLES = {
  card: {
    background: 'var(--bg-card, rgba(255,255,255,.04))',
    border: '1px solid rgba(224,124,90,.25)',
    borderRadius: 12,
    padding: '1.5rem',
    margin: '1rem 0',
    maxWidth: 480,
  },
  title: {
    fontSize: '.9rem',
    fontWeight: 600,
    color: '#e07c5a',
    marginBottom: '.35rem',
  },
  sub: {
    fontSize: '.75rem',
    color: 'var(--text-muted)',
    marginBottom: '1rem',
    lineHeight: 1.5,
  },
  btn: {
    background: 'rgba(224,124,90,.12)',
    border: '1px solid rgba(224,124,90,.3)',
    borderRadius: 6,
    color: '#e07c5a',
    cursor: 'pointer',
    fontSize: '.78rem',
    fontWeight: 500,
    padding: '.4rem .85rem',
    marginRight: '.5rem',
  },
  details: {
    marginTop: '1rem',
    fontSize: '.68rem',
    color: 'var(--text-muted)',
    fontFamily: 'monospace',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    background: 'rgba(0,0,0,.15)',
    borderRadius: 4,
    padding: '.5rem .75rem',
    maxHeight: 120,
    overflow: 'auto',
  },
};

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, showDetails: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error(`[ErrorBoundary] Tab "${this.props.tab}" crashed:`, error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, showDetails: false });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const { tab = 'this tab' } = this.props;
    const msg = this.state.error?.message || 'Unknown error';

    return (
      <div style={STYLES.card}>
        <div style={STYLES.title}>⚠ Something went wrong in {tab}</div>
        <div style={STYLES.sub}>
          The rest of the app is fine. You can retry or switch to another tab.
        </div>
        <button style={STYLES.btn} onClick={this.handleRetry}>Retry</button>
        <button
          style={{ ...STYLES.btn, background: 'none', border: 'none', color: 'var(--text-muted)' }}
          onClick={() => this.setState(s => ({ showDetails: !s.showDetails }))}
        >
          {this.state.showDetails ? 'Hide details' : 'Show details'}
        </button>
        {this.state.showDetails && (
          <div style={STYLES.details}>{msg}</div>
        )}
      </div>
    );
  }
}
