"use client";

import { useState } from "react";

export type HistoryPoint = { id: string; label: string; values: Record<string, number | null> };
export type HistorySeries = { key: string; label: string; color: string };

const W = 720;
const H = 260;
const PAD = { top: 16, right: 148, bottom: 36, left: 44 };
const plotW = W - PAD.left - PAD.right;
const plotH = H - PAD.top - PAD.bottom;
const y = (v: number) => PAD.top + plotH * (1 - v);

/**
 * Headline rates (0–1) across eval runs. One y-axis (percent), 2px lines, end dots with a
 * surface ring, a legend, end labels when they don't collide, and a hover crosshair + tooltip.
 */
export default function HistoryChart({ points, series }: { points: HistoryPoint[]; series: HistorySeries[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const x = (i: number) => PAD.left + (points.length === 1 ? plotW / 2 : (plotW * i) / (points.length - 1));
  const band = points.length > 1 ? plotW / (points.length - 1) : plotW;

  // End labels: only those that stay ≥ 14px apart from their neighbours; the legend covers the rest.
  const last = points.length - 1;
  const ends = series
    .map((s) => ({ s, v: points[last]?.values[s.key] ?? null }))
    .filter((e): e is { s: HistorySeries; v: number } => e.v !== null)
    .sort((a, b) => b.v - a.v);
  const labelled = new Set(ends.filter((e, i) => [ends[i - 1], ends[i + 1]].every((n) => !n || Math.abs(y(n.v) - y(e.v)) >= 14)).map((e) => e.s.key));

  return (
    <figure className="viz-root">
      <ul className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--text-secondary)]">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded" style={{ background: s.color }} />
            {s.label}
          </li>
        ))}
      </ul>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Headline metrics across eval runs">
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={PAD.left + plotW} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--text-muted)">
                {t * 100}%
              </text>
            </g>
          ))}
          {points.map((p, i) => (
            <text key={p.id} x={x(i)} y={H - 12} textAnchor="middle" fontSize={11} fill="var(--text-secondary)">
              {p.label.length > 18 ? `${p.label.slice(0, 17)}…` : p.label}
            </text>
          ))}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--text-muted)" strokeWidth={1} />}

          {series.map((s) => {
            const pts = points.map((p, i) => ({ i, v: p.values[s.key] })).filter((p): p is { i: number; v: number } => p.v !== null);
            const d = pts.map((p, k) => `${k ? "L" : "M"}${x(p.i)},${y(p.v)}`).join(" ");
            const end = pts.at(-1);
            return (
              <g key={s.key}>
                {pts.length > 1 && <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
                {pts.map((p) => (
                  <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r={hover === p.i || p === end ? 4.5 : 3} fill={s.color} stroke="var(--surface-1)" strokeWidth={2} />
                ))}
                {end && labelled.has(s.key) && end.i === last && (
                  <text x={x(end.i) + 10} y={y(end.v)} dy="0.32em" fontSize={11} fill="var(--text-primary)">
                    {s.label} {Math.round(end.v * 100)}%
                  </text>
                )}
              </g>
            );
          })}

          {points.map((p, i) => (
            <rect
              key={p.id}
              x={x(i) - band / 2}
              y={PAD.top}
              width={band}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </svg>
        {hover !== null && (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-44 rounded-lg border border-stone-200 bg-white p-3 text-xs shadow-lg"
            style={{ left: `${(x(hover) / W) * 100}%`, transform: hover > points.length / 2 ? "translateX(calc(-100% - 12px))" : "translateX(12px)" }}
          >
            <p className="mb-1.5 font-semibold text-[var(--text-primary)]">{points[hover].label}</p>
            {series.map((s) => (
              <p key={s.key} className="flex items-center justify-between gap-4 text-[var(--text-secondary)]">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
                  {s.label}
                </span>
                <span className="font-medium text-[var(--text-primary)]">
                  {points[hover].values[s.key] === null ? "–" : `${Math.round(points[hover].values[s.key]! * 100)}%`}
                </span>
              </p>
            ))}
          </div>
        )}
      </div>
    </figure>
  );
}
