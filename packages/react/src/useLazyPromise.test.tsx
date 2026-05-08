import type { LazyPromise } from "@lazy-promise/core";
import { box, fromEager, TypedError } from "@lazy-promise/core";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Component, Suspense, useMemo } from "react";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { useLazyPromise } from "./useLazyPromise";

// Compile-time type checks for useLazyPromise's TypedError constraint.
const typeTests = () => {
  const typedErrorPromise = box(new TypedError("boom" as const));
  const maybeTypedErrorPromise = box<{ name: string } | TypedError<"typed">>(
    new TypedError("typed"),
  );
  const fetchUser = (userId: string) => box({ name: userId });
  const normalizeUser = (user: { name: string }) => ({ name: user.name });
  type NotFound = { code: "NOT_FOUND" };
  type RateLimited = { code: "RATE_LIMITED" };
  const fetchUserWithTypedError = () =>
    box(
      new TypedError<NotFound | RateLimited>({
        code: "NOT_FOUND",
      }),
    );
  const search = (query: string) =>
    box([
      {
        id: query,
        firstName: "Ada",
        lastName: "Lovelace",
      },
    ]);
  const processResults = (
    results: ReadonlyArray<{
      id: string;
      firstName: string;
      lastName: string;
    }>,
  ) => results.map((result) => ({ id: result.id, name: result.firstName }));

  // @ts-expect-error useLazyPromise input must not resolve to TypedError
  useLazyPromise(typedErrorPromise);

  // @ts-expect-error useLazyPromise input must not resolve to unions containing TypedError
  useLazyPromise(maybeTypedErrorPromise);

  const value = useLazyPromise(
    typedErrorPromise.catchTypedError((error) => `handled:${error}` as const),
  );
  const maybeValue = useLazyPromise(
    maybeTypedErrorPromise.catchTypedError(() => ({ name: "fallback" })),
  );

  const UserProfile = ({ userId }: { userId: string }) => {
    const user = useLazyPromise(
      useMemo(() => fetchUser(userId).map(normalizeUser), [userId]),
    );

    expectTypeOf(user).toEqualTypeOf<{ name: string }>();
    expectTypeOf(user.name).toEqualTypeOf<string>();

    return null;
  };

  const Profile = () => {
    const user = useLazyPromise(
      useMemo(
        () =>
          fetchUserWithTypedError().catchTypedError((error) => {
            expectTypeOf(error).toEqualTypeOf<NotFound | RateLimited>();

            if (error.code === "NOT_FOUND") {
              return { name: "Anonymous" };
            }

            return { name: "Try again in a moment" };
          }),
        [],
      ),
    );

    expectTypeOf(user).toHaveProperty("name").toEqualTypeOf<string>();

    return null;
  };

  const SearchResults = ({ query }: { query: string }) => {
    const resultsPromise = useMemo(
      () =>
        search(query)
          .map(processResults)
          .catchRejection(() => []),
      [query],
    );

    const results = useLazyPromise(resultsPromise);

    expectTypeOf(results[0]?.name).toEqualTypeOf<string | undefined>();

    return null;
  };

  const expectStringLiteral: "handled:boom" = value;
  expectTypeOf(maybeValue).toEqualTypeOf<{ name: string }>();
  return [expectStringLiteral, maybeValue, UserProfile, Profile, SearchResults];
};

void typeTests;

afterEach(() => {
  cleanup();
});

const TestComponent = ({
  lazyPromise,
}: {
  lazyPromise: LazyPromise<string>;
}) => {
  const value = useLazyPromise(lazyPromise);
  return <div data-testid="result">{value}</div>;
};

class TestErrorBoundary extends Component<
  {
    children: React.ReactNode;
  },
  {
    error: unknown;
  }
> {
  override state = {
    error: null as unknown,
  };

  static getDerivedStateFromError(error: unknown) {
    return {
      error,
    };
  }

  override render() {
    if (this.state.error instanceof Error) {
      return <div data-testid="error">{this.state.error.message}</div>;
    }

    if (this.state.error) {
      return <div data-testid="error">{String(this.state.error)}</div>;
    }

    return this.props.children;
  }
}

describe("useLazyPromise with Suspense", () => {
  it("shows fallback when lazy promise is pending", () => {
    const lazyPromise = fromEager(
      () =>
        new Promise<string>(() => {
          // Intentionally never resolves.
        }),
    );

    render(
      <Suspense fallback={<div data-testid="fallback">Loading</div>}>
        <TestComponent lazyPromise={lazyPromise} />
      </Suspense>,
    );

    const fallback = screen.getByTestId("fallback");
    expect(fallback.textContent).toBe("Loading");
  });

  it("renders value after lazy promise resolves asynchronously", async () => {
    const lazyPromise = fromEager(() => Promise.resolve("async"));

    render(
      <Suspense fallback={<div data-testid="fallback">Loading</div>}>
        <TestComponent lazyPromise={lazyPromise} />
      </Suspense>,
    );

    expect(screen.getByTestId("fallback").textContent).toBe("Loading");

    await waitFor(() => {
      const result = screen.getByTestId("result");
      expect(result.textContent).toBe("async");
    });
  });

  it("throws rejected lazy promise error to ErrorBoundary", async () => {
    const lazyPromise = fromEager(() => Promise.reject(new Error("boom")));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      render(
        <Suspense fallback={<div data-testid="fallback">Loading</div>}>
          <TestErrorBoundary>
            <TestComponent lazyPromise={lazyPromise} />
          </TestErrorBoundary>
        </Suspense>,
      );

      expect(screen.getByTestId("fallback").textContent).toBe("Loading");

      await waitFor(() => {
        const error = screen.getByTestId("error");
        expect(error.textContent).toBe("boom");
      });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("renders synchronously resolved lazy promise", () => {
    const lazyPromise = box("sync");

    render(
      <Suspense fallback={<div data-testid="fallback">Loading</div>}>
        <TestComponent lazyPromise={lazyPromise} />
      </Suspense>,
    );

    const result = screen.getByTestId("result");
    expect(result.textContent).toBe("sync");
  });

  it("renders new value when lazy promise reference changes", async () => {
    const first = box("first");
    const second = box("second");

    const Wrapper = ({ lazyPromise }: { lazyPromise: LazyPromise<string> }) => (
      <Suspense fallback={<div data-testid="fallback">Loading</div>}>
        <TestComponent lazyPromise={lazyPromise} />
      </Suspense>
    );

    const { rerender } = render(<Wrapper lazyPromise={first} />);
    expect(screen.getByTestId("result").textContent).toBe("first");

    rerender(<Wrapper lazyPromise={second} />);
    await waitFor(() => {
      const result = screen.getByTestId("result");
      expect(result.textContent).toBe("second");
    });
  });
});
