import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    console.error('ErrorBoundary: getDerivedStateFromError', error);
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error);
    console.error('Error info:', errorInfo);
    this.setState({
      error,
      errorInfo: errorInfo.componentStack
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ 
          padding: '20px', 
          color: 'white', 
          backgroundColor: '#1e293b',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <h1 style={{ fontSize: '24px', marginBottom: '20px', color: '#ef4444' }}>Something went wrong</h1>
          <div style={{ 
            backgroundColor: '#0f172a', 
            padding: '20px', 
            borderRadius: '8px',
            overflow: 'auto',
            maxWidth: '800px',
            maxHeight: '400px',
            marginBottom: '20px'
          }}>
            <h2 style={{ fontSize: '18px', marginBottom: '10px' }}>Error:</h2>
            <pre style={{ color: '#fca5a5', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {this.state.error?.toString()}
            </pre>
            {this.state.error?.stack && (
              <>
                <h3 style={{ fontSize: '16px', marginTop: '15px', marginBottom: '10px' }}>Stack Trace:</h3>
                <pre style={{ color: '#94a3b8', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '12px' }}>
                  {this.state.error.stack}
                </pre>
              </>
            )}
            {this.state.errorInfo && (
              <>
                <h3 style={{ fontSize: '16px', marginTop: '15px', marginBottom: '10px' }}>Component Stack:</h3>
                <pre style={{ color: '#94a3b8', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '12px' }}>
                  {this.state.errorInfo}
                </pre>
              </>
            )}
          </div>
          <button 
            onClick={() => {
              this.setState({ hasError: false, error: null, errorInfo: null });
              window.location.reload();
            }}
            style={{
              padding: '10px 20px',
              backgroundColor: '#0284c7',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '16px'
            }}
          >
            Reload App
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;

