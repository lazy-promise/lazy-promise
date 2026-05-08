import type { LazyPromise } from "@lazy-promise/core";
import { fromEager, inTimeout } from "@lazy-promise/core";
import type { ReactNode } from "react";
import { Component, Suspense } from "react";
import { useLazyPromise } from "./useLazyPromise";
import { useLazyPromiseState } from "./useLazyPromiseState";

const UserCard = ({
  userPromise,
}: {
  userPromise: LazyPromise<{ id: string; name: string }>;
}) => {
  // This is ergonomic - just call the hook and you get the data
  // The component automatically suspends while loading
  const user = useLazyPromise(userPromise);

  return (
    <div>
      <h2>{user.name}</h2>
      <p>ID: {user.id}</p>
    </div>
  );
};

class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error?: Error }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return <div>Something went wrong: {this.state.error?.message}</div>;
    }

    return this.props.children;
  }
}

/**
 * Example component demonstrating useLazyPromise with Suspense.
 * This shows the ergonomic design where you don't need to worry about
 * loading or error states - React handles that through Suspense and
 * Error Boundaries.
 */
export const SuspenseExample = () => {
  // In a real app, this would be a LazyPromise from an API call
  const userPromise = fromEager(
    () =>
      new Promise<{ id: string; name: string }>((resolve) => {
        setTimeout(() => {
          resolve({ id: "1", name: "Alice" });
        }, 1000);
      }),
  );

  return (
    <Suspense fallback={<div>Loading user...</div>}>
      <ErrorBoundary>
        <UserCard userPromise={userPromise} />
      </ErrorBoundary>
    </Suspense>
  );
};

/**
 * Example component demonstrating useLazyPromiseState for manual control.
 * Use this when you need more control over loading/error states, or when
 * you can't wrap with Suspense boundaries.
 */
export const StateExample = () => {
  const dataPromise = inTimeout(1000).map(() => ({ message: "Hello!" }));

  const state = useLazyPromiseState(dataPromise);

  if (state.status === "pending") {
    return <div>Loading...</div>;
  }
  if (state.status === "error") {
    return <div>Error: {String(state.error)}</div>;
  }

  return <div>{state.data.message}</div>;
};
