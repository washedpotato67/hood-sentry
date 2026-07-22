'use client';

// Root error boundary. It replaces the layout entirely, so it renders its own
// <html>/<body> and inlines the brand styles (global CSS from the layout does
// not apply here). Having it also lets `next build` generate /500 through the
// App Router instead of the pages-router fallback that breaks the build.
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          background: '#ebe5d7',
          color: '#1a1a16',
          display: 'grid',
          placeItems: 'center',
          padding: '24px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <main style={{ maxWidth: '34rem' }}>
          <p
            style={{
              margin: 0,
              fontFamily: 'ui-monospace, SFMono-Regular, monospace',
              fontSize: 12,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
            }}
          >
            Error 500
          </p>
          <h1
            style={{
              margin: '12px 0',
              fontFamily: '"Arial Narrow", "Helvetica Neue", Arial, sans-serif',
              fontSize: 52,
              fontWeight: 700,
              lineHeight: 0.95,
              textTransform: 'uppercase',
              letterSpacing: '-0.01em',
            }}
          >
            Something broke on our side.
          </h1>
          <p style={{ fontSize: 16, lineHeight: 1.5, color: '#3a3931' }}>
            An unexpected error interrupted the request. Try again. If it keeps happening, the
            fault is ours, not yours.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: 18,
              background: '#d4e74a',
              color: '#1a1a16',
              border: '2px solid #1a1a16',
              borderRadius: 0,
              padding: '12px 20px',
              fontWeight: 700,
              fontSize: 15,
              cursor: 'pointer',
              boxShadow: '3px 3px 0 #1a1a16',
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
