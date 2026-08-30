import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
}

/**
 * Last line of defence against a blank page.
 *
 * React unmounts the entire root when a render or an effect throws. The app
 * had no boundary anywhere, so a single unhandled throw produced a white
 * screen with no message, on a device that is often propped up across the
 * room mid-lesson. Showing the error, and a way back, is always better.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("inkboard: unhandled error", error, info);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <main
        style={{
          padding: 24,
          font: "14px/1.5 system-ui, sans-serif",
          color: "#eee",
          background: "#1a1a1a",
          minHeight: "100vh",
        }}
      >
        <h1 style={{ fontSize: 18, margin: "0 0 8px" }}>inkboard hit an error</h1>
        <p style={{ margin: "0 0 16px", color: "#f6a6a6" }}>{error.message}</p>
        <button
          onClick={() => window.location.reload()}
          style={{
            background: "#2f6fed",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "8px 14px",
            cursor: "pointer",
            font: "600 13px system-ui, sans-serif",
          }}
        >
          Reload
        </button>
      </main>
    );
  }
}
