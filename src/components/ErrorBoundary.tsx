import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      let errorMessage = 'An unexpected error occurred.';
      let isRateLimit = false;

      try {
        if (this.state.error?.message) {
          // Check if it's a JSON error from handleFirestoreError
          try {
            const parsed = JSON.parse(this.state.error.message);
            if (parsed.error) {
              errorMessage = parsed.error;
              if (errorMessage.toLowerCase().includes('rate exceeded') || 
                  errorMessage.toLowerCase().includes('quota exceeded') ||
                  errorMessage.toLowerCase().includes('resource exhausted')) {
                isRateLimit = true;
              }
            }
          } catch (e) {
            // Not JSON, use raw message
            errorMessage = this.state.error.message;
            if (errorMessage.toLowerCase().includes('rate exceeded') || 
                errorMessage.toLowerCase().includes('quota exceeded') ||
                errorMessage.toLowerCase().includes('resource exhausted')) {
              isRateLimit = true;
            }
          }
        }
      } catch (e) {
        console.error('Error in ErrorBoundary error parsing:', e);
      }

      return (
        <div className="min-h-screen bg-[#E4E3E0] flex items-center justify-center p-4">
          <div className="bg-white border-2 border-[#141414] p-8 max-w-md w-full shadow-[8px_8px_0px_0px_rgba(20,20,20,1)]">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 bg-red-100 border-2 border-red-600 flex items-center justify-center">
                <span className="text-2xl font-bold text-red-600">!</span>
              </div>
              <h2 className="text-xl font-bold uppercase tracking-tight">
                {isRateLimit ? 'System Busy' : 'Application Error'}
              </h2>
            </div>
            
            <div className="bg-gray-50 border border-gray-200 p-4 mb-8 font-mono text-xs break-words">
              <p className="font-bold mb-2 uppercase text-gray-400">Error Details:</p>
              <p className="text-gray-800">{errorMessage}</p>
            </div>

            {isRateLimit ? (
              <div className="space-y-4 mb-8">
                <p className="text-sm text-gray-600 leading-relaxed">
                  The system has reached its daily data limit (Firestore Free Tier). 
                  This usually resets at midnight Pacific Time.
                </p>
                <div className="bg-blue-50 border-l-4 border-blue-500 p-4">
                  <p className="text-xs text-blue-700 font-medium">
                    To fix this permanently, please upgrade to the <strong className="underline">Blaze (Pay-as-you-go)</strong> plan in your Firebase Console.
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-600 mb-8 leading-relaxed">
                We've encountered an issue. You can try refreshing the page or contact support if the problem persists.
              </p>
            )}

            <div className="flex flex-col gap-3">
              <button
                onClick={() => window.location.reload()}
                className="w-full bg-[#141414] text-white py-3 font-bold uppercase tracking-widest hover:bg-gray-800 transition-colors"
              >
                Refresh Page
              </button>
              <button
                onClick={() => this.setState({ hasError: false, error: null })}
                className="w-full bg-white border-2 border-[#141414] py-3 font-bold uppercase tracking-widest hover:bg-gray-50 transition-colors"
              >
                Try to Recover
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (this.props as any).children;
  }
}
