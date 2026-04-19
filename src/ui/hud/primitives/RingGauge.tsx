import React from "react";

const polarPoint = (cx: number, cy: number, r: number, angleRad: number) => ({
  x: cx + Math.cos(angleRad) * r,
  y: cy + Math.sin(angleRad) * r,
});

function arcPath(cx: number, cy: number, r: number, start: number, end: number) {
  const startPt = polarPoint(cx, cy, r, start);
  const endPt = polarPoint(cx, cy, r, end);
  const largeArcFlag = end - start <= Math.PI ? 0 : 1;
  return `M ${startPt.x.toFixed(3)} ${startPt.y.toFixed(3)} A ${r} ${r} 0 ${largeArcFlag} 1 ${endPt.x.toFixed(3)} ${endPt.y.toFixed(3)}`;
}

export function RingGauge({
  size,
  valuePct,
  startDeg = 135,
  sweepDeg = 270,
  strokeWidth = 10,
  track,
  color,
  glow,
  children,
}: {
  size: number;
  valuePct: number;
  startDeg?: number;
  sweepDeg?: number;
  strokeWidth?: number;
  track: string;
  color: string;
  glow?: string;
  children?: React.ReactNode;
}) {
  const center = size / 2;
  const radius = center - strokeWidth * 1.5;
  const start = (startDeg * Math.PI) / 180;
  const end = ((startDeg + sweepDeg) * Math.PI) / 180;
  const filledEnd = ((startDeg + sweepDeg * Math.max(0, Math.min(100, valuePct)) / 100) * Math.PI) / 180;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <defs>
        <filter id={`g-${color.replace(/[^a-z0-9]/gi, "")}`}>
          <feGaussianBlur stdDeviation="2.8" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <path d={arcPath(center, center, radius, start, end)} fill="none" stroke={track} strokeWidth={strokeWidth} strokeLinecap="round" />
      <path
        d={arcPath(center, center, radius, start, filledEnd)}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        filter={glow ? `url(#g-${color.replace(/[^a-z0-9]/gi, "")})` : undefined}
      />
      {children}
    </svg>
  );
}
