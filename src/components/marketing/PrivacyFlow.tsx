import React from "react";

/*
 * Background for the privacy band: traffic lines across the section. Bright packets run to the provider
 * along the main lines, green packets loop locally (your code stays on your machine), and small amber
 * ticks branch up to ArgusOps (only counts reach us). Pure SVG + CSS; decorative; still under reduced motion.
 */
const LANES: { d: string; color: string; dur: number; delay: number; dash: string; width: number }[] = [
  { d: "M-50 120 C 300 60, 520 180, 820 120 S 1340 70, 1650 130", color: "#e2e8f0", dur: 7, delay: 0, dash: "28 172", width: 2 },
  { d: "M-50 200 C 260 240, 560 150, 860 210 S 1300 250, 1650 190", color: "#e2e8f0", dur: 9, delay: -3, dash: "34 166", width: 2 },
  { d: "M-50 285 C 320 330, 600 250, 900 300 S 1380 340, 1650 280", color: "#34d399", dur: 8, delay: -1.5, dash: "24 176", width: 2 },
  { d: "M-50 350 C 280 320, 640 380, 940 345 S 1320 310, 1650 360", color: "#e2e8f0", dur: 11, delay: -6, dash: "30 170", width: 1.75 },
  { d: "M-50 60 C 340 90, 700 20, 1000 70 S 1420 100, 1650 50", color: "#34d399", dur: 10, delay: -4, dash: "24 176", width: 1.75 },
];
// short branches rising off the lanes toward the top: the counts that reach ArgusOps
const BRANCHES: { d: string; dur: number; delay: number }[] = [
  { d: "M520 150 C 540 110, 560 70, 600 -20", dur: 3.2, delay: 0 },
  { d: "M980 205 C 1000 150, 1030 90, 1060 -20", dur: 3.8, delay: -1.2 },
  { d: "M1240 115 C 1260 80, 1280 40, 1310 -20", dur: 3.4, delay: -2.1 },
];

export function PrivacyFlow() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10"
      style={{
        maskImage: "linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent), linear-gradient(#000, #000)",
        WebkitMaskImage: "linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent)",
      }}
    >
      <svg viewBox="0 0 1600 400" preserveAspectRatio="xMidYMid slice" className="h-full w-full">
        {/* faint rails */}
        {LANES.map((l, i) => (
          <path key={`rail-${i}`} d={l.d} fill="none" stroke="#273449" strokeWidth="1.5" />
        ))}
        {BRANCHES.map((b, i) => (
          <path key={`brail-${i}`} d={b.d} fill="none" stroke="#1e293b" strokeWidth="1" strokeDasharray="2 5" />
        ))}

        {/* soft glow under the packets */}
        {LANES.map((l, i) => (
          <path
            key={`glow-${i}`}
            d={l.d}
            fill="none"
            stroke={l.color}
            strokeOpacity="0.18"
            strokeWidth={l.width * 4}
            strokeLinecap="round"
            pathLength={1000}
            strokeDasharray={l.dash}
            className="flow-packet"
            style={{ animationDuration: `${l.dur}s`, animationDelay: `${l.delay}s` }}
          />
        ))}

        {/* moving packets */}
        {LANES.map((l, i) => (
          <path
            key={`pkt-${i}`}
            d={l.d}
            fill="none"
            stroke={l.color}
            strokeOpacity={l.color === "#34d399" ? 0.95 : 0.85}
            strokeWidth={l.width + 0.5}
            strokeLinecap="round"
            pathLength={1000}
            strokeDasharray={l.dash}
            className="flow-packet"
            style={{ animationDuration: `${l.dur}s`, animationDelay: `${l.delay}s` }}
          />
        ))}
        {BRANCHES.map((b, i) => (
          <path
            key={`bpkt-${i}`}
            d={b.d}
            fill="none"
            stroke="#fbbf24"
            strokeOpacity="0.8"
            strokeWidth="2"
            strokeLinecap="round"
            pathLength={1000}
            strokeDasharray="40 960"
            className="flow-packet"
            style={{ animationDuration: `${b.dur}s`, animationDelay: `${b.delay}s` }}
          />
        ))}

        {/* junction dots where counts leave the lanes */}
        {[
          [520, 150],
          [980, 205],
          [1240, 115],
        ].map(([cx, cy]) => (
          <g key={`${cx}`}>
            <circle cx={cx} cy={cy} r="7" fill="#fbbf24" fillOpacity="0.1" className="flow-pulse" />
            <circle cx={cx} cy={cy} r="2.5" fill="#fbbf24" fillOpacity="0.85" />
          </g>
        ))}
      </svg>
      {/* keep the copy readable: a soft dark wash behind the text column */}
      <div className="absolute inset-0 bg-[radial-gradient(45%_70%_at_28%_50%,rgb(2_6_23/0.8),transparent_72%),radial-gradient(40%_60%_at_68%_45%,rgb(2_6_23/0.7),transparent_72%)]" />
    </div>
  );
}
