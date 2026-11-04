// Keeps one Command Center section's crash from taking down the whole page:
// the failing section shows a message with a retry, the rail stays usable.

import { Component, type ReactNode } from "react";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Button } from "@/shared/ui/Button";

export class SectionBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <EmptyState
        title="This section couldn't load"
        description={this.state.error.message || "Something went wrong."}
        action={<Button variant="secondary" onClick={() => this.setState({ error: null })}>Try again</Button>}
      />
    );
  }
}
