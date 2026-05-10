import { Component, type ErrorInfo, type ReactNode } from "react";
import { notify } from "./toast";

type PanelErrorBoundaryProps = {
  children: ReactNode;
  resetKey: string;
  title: string;
  onRemove?: () => void;
};

type PanelErrorBoundaryState = {
  error: Error | null;
};

export class PanelErrorBoundary extends Component<
  PanelErrorBoundaryProps,
  PanelErrorBoundaryState
> {
  state: PanelErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): PanelErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("grid panel render failed", error, errorInfo.componentStack);
    notify(`Panel crashed: ${this.props.title}`, "error");
  }

  componentDidUpdate(prevProps: PanelErrorBoundaryProps): void {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  private retry = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="grid-panel panel-error-boundary" role="alert">
        <div className="grid-panel-head">
          <span className="grid-panel-title">Panel crashed</span>
          <div className="grid-panel-meta">
            <button
              type="button"
              className="grid-panel-activate"
              onClick={this.retry}
            >
              retry
            </button>
            {this.props.onRemove && (
              <button
                type="button"
                className="grid-panel-close"
                onClick={this.props.onRemove}
                title="remove panel"
                aria-label="remove panel"
              >
                &times;
              </button>
            )}
          </div>
        </div>
        <div className="grid-panel-body panel-error-boundary-body">
          <p>{this.props.title}</p>
          <code>{this.state.error.message || "render failed"}</code>
        </div>
      </div>
    );
  }
}
