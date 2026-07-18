// Bespoke on-chain risk-scan visualization: the landing hero's instrument.
// Pure SVG + CSS (animations live in globals.css under .scan-*), so it renders
// server-side, needs no client JS, makes no network requests, and degrades to a
// static readout under prefers-reduced-motion.

const NODES = [
  { x: 96, y: 60, r: 6, tone: 'ok' },
  { x: 250, y: 44, r: 7, tone: 'risk' },
  { x: 330, y: 96, r: 6, tone: 'ok' },
  { x: 300, y: 210, r: 8, tone: 'danger' },
  { x: 150, y: 232, r: 6, tone: 'ok' },
  { x: 60, y: 168, r: 7, tone: 'risk' },
  { x: 210, y: 150, r: 0, tone: 'ok' }, // center anchor (drawn separately)
] as const;

const CENTER = { x: 210, y: 146 };

export function HeroScan() {
  return (
    <figure className="scan reveal reveal-2" aria-hidden="true">
      <div className="scan-head">
        <span className="scan-tag scan-tag-dim">chain 4663</span>
      </div>
      <svg viewBox="0 0 420 300" className="scan-svg" role="presentation">
        <defs>
          <radialGradient id="scan-glow" cx="50%" cy="49%" r="50%">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.28" />
            <stop offset="60%" stopColor="var(--brand)" stopOpacity="0.05" />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="scan-sweep" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity="0" />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity="0.55" />
          </linearGradient>
        </defs>

        {/* instrument dial: glow + concentric rings */}
        <circle cx={CENTER.x} cy={CENTER.y} r="132" fill="url(#scan-glow)" />
        {[132, 100, 68, 36].map((r) => (
          <circle key={r} cx={CENTER.x} cy={CENTER.y} r={r} className="scan-ring" fill="none" />
        ))}

        {/* rotating radar sweep */}
        <g className="scan-sweep-group" style={{ transformOrigin: `${CENTER.x}px ${CENTER.y}px` }}>
          <path
            d={`M ${CENTER.x} ${CENTER.y} L ${CENTER.x + 132} ${CENTER.y} A 132 132 0 0 0 ${
              CENTER.x + 121
            } ${CENTER.y - 52} Z`}
            fill="url(#scan-sweep)"
          />
          <line
            x1={CENTER.x}
            y1={CENTER.y}
            x2={CENTER.x + 132}
            y2={CENTER.y}
            className="scan-sweep-line"
          />
        </g>

        {/* edges from center to each node */}
        {NODES.filter((n) => n.r > 0).map((n) => (
          <line
            key={`e-${n.x}-${n.y}`}
            x1={CENTER.x}
            y1={CENTER.y}
            x2={n.x}
            y2={n.y}
            className={`scan-edge scan-edge-${n.tone}`}
          />
        ))}

        {/* wallet / source nodes */}
        {NODES.filter((n) => n.r > 0).map((n) => (
          <circle
            key={`n-${n.x}-${n.y}`}
            cx={n.x}
            cy={n.y}
            r={n.r}
            className={`scan-node scan-node-${n.tone}`}
          />
        ))}

        {/* center: the contract under inspection */}
        <g style={{ transformOrigin: `${CENTER.x}px ${CENTER.y}px` }} className="scan-core-group">
          <rect
            x={CENTER.x - 11}
            y={CENTER.y - 11}
            width="22"
            height="22"
            rx="3"
            className="scan-core"
            transform={`rotate(45 ${CENTER.x} ${CENTER.y})`}
          />
        </g>
      </svg>

      <div className="scan-gauge">
        <div className="scan-gauge-num">
          82<span className="scan-gauge-max">/100</span>
        </div>
        <div className="scan-gauge-meta">
          <span className="scan-gauge-label">RISK INDEX</span>
          <span className="scan-bar">
            <span className="scan-bar-fill" />
          </span>
          <span className="scan-gauge-sub">12 signals · 3 flagged</span>
        </div>
      </div>
    </figure>
  );
}
