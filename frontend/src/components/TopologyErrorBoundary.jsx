import { Component } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default class TopologyErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error("[TOPOLOGY UI] Render failure", error, info);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const message = this.state.error?.message || "The topology view could not be rendered.";

    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#03060b]/95 p-4 backdrop-blur-md">
        <div className="w-full max-w-lg rounded-2xl border border-red-500/20 bg-[#080d16] p-6 shadow-2xl">
          <div className="flex items-start gap-4">
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-red-400">
              <AlertTriangle size={22} />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold text-white">Topology view failed to render</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                The main NetEscalate dashboard is still running. The topology module encountered a UI error instead of taking down the entire application.
              </p>
              <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950 p-3">
                <p className="text-[10px] uppercase tracking-widest text-slate-600">Diagnostic</p>
                <p className="mt-2 break-words font-mono text-xs text-red-300">{message}</p>
              </div>
              <div className="mt-5 flex gap-2">
                <button type="button" onClick={this.handleRetry} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500">
                  <RefreshCw size={15} /> Retry topology
                </button>
                <button type="button" onClick={() => window.location.reload()} className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">
                  Reload application
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
