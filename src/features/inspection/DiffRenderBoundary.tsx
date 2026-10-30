import { Component, type ReactNode } from "react";
import styles from "@/features/inspection/DiffViewer.module.css";

export function RawPatch({ text, reason }: { text: string; reason: string }) {
  return (
    <>
      <p role="status">{reason}</p>
      <pre className={styles.raw}>{text}</pre>
    </>
  );
}

/** Lives outside the lazy viewer so chunk and render failures retain Git's output. */
export class DiffRenderBoundary extends Component<
  { text: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidUpdate(previous: { text: string }) {
    if (previous.text !== this.props.text && this.state.failed)
      this.setState({ failed: false });
  }
  render() {
    return this.state.failed ? (
      <RawPatch
        text={this.props.text}
        reason="The diff renderer is unavailable. Showing Git’s original output as plain text."
      />
    ) : (
      this.props.children
    );
  }
}
