"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { Player } from "@/lib/types";
import { AGENT_ROLE_MAP, RANK_COLORS, rankColor, RANK_NAMES_SHORT } from "@/lib/constants";


interface Props {
  players: Player[];
  isDeathmatch?: boolean;
  selfPuuid?: string;
}

function agentImg(id: string) {
  return `https://media.valorant-api.com/agents/${id}/displayicon.png`;
}

function partyHue(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${Math.abs(h % 360)}, 50%, 58%)`;
}

const RANK_RANGES: Record<string, [number, number]> = {
  Iron: [3, 5], Bronze: [6, 8], Silver: [9, 11], Gold: [12, 14],
  Platinum: [15, 17], Diamond: [18, 20], Ascendant: [21, 23],
  Immortal: [24, 26], Radiant: [27, 27],
};

function avgTeamRank(players: Player[]): { avg: number; tier: number; name: string; color: string } | null {
  const ranked = players.filter((p) => p.rank >= 3);
  if (ranked.length === 0) return null;
  const avg = ranked.reduce((s, p) => s + p.rank + p.rr / 100, 0) / ranked.length;
  const tier = Math.max(3, Math.min(27, Math.round(avg)));
  const name = RANK_NAMES_SHORT[tier] ?? "??";
  const tintKey = Object.keys(RANK_RANGES).find((k) => {
    const r = RANK_RANGES[k];
    return tier >= r[0] && tier <= r[1];
  }) ?? "";
  return { avg, tier, name, color: rankColor(tintKey) };
}

function teamElo(players: Player[]): number {
  const ranked = players.filter((p) => p.rank >= 3);
  if (ranked.length === 0) return 0;
  return ranked.reduce((s, p) => s + p.rank * 100 + p.rr, 0) / ranked.length;
}

function smurfFlags(p: Player): string[] {
  const flags: string[] = [];
  if (p.accountLevel > 0 && p.accountLevel < 50 && p.rank >= 18) {
    flags.push("New account, high rank");
  }
  if (p.peakRank >= 3 && p.rank >= 3 && p.peakRank - p.rank >= 6) {
    flags.push(`Peak ${p.peakRankName}, now ${p.rankName}`);
  }
  if (p.accountLevel > 0 && p.accountLevel < 25 && p.rank >= 3) {
    flags.push("Very new account");
  }
  if (p.rank >= 3 && !p.isCurrentActRank && p.currentSeasonGames === 0) {
    flags.push("No games this act");
  }
  return flags;
}

function getPartyGroups(players: Player[]): Map<string, Player[]> {
  const groups = new Map<string, Player[]>();
  for (const p of players) {
    if (!p.isPartyMember || !p.partyId) continue;
    const existing = groups.get(p.partyId) ?? [];
    existing.push(p);
    groups.set(p.partyId, existing);
  }
  for (const [id, members] of groups) {
    if (members.length < 2) groups.delete(id);
  }
  return groups;
}

function partyLabel(players: Player[]): string | null {
  const groups = getPartyGroups(players);
  if (groups.size === 0) return null;
  const sizes = [...groups.values()].map((g) => g.length).sort((a, b) => b - a);
  if (sizes.length === 1) return `${sizes[0]}-stack`;
  return sizes.map((s) => `${s}-stack`).join(" + ");
}

function ExpandCollapse({ open, children }: { open: boolean; children: React.ReactNode }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  const measure = useCallback(() => {
    if (contentRef.current) {
      setHeight(contentRef.current.scrollHeight);
    }
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open, measure]);

  return (
    <div
      style={{
        maxHeight: open ? height : 0,
        overflow: "hidden",
        transition: "max-height 0.32s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.24s ease",
        opacity: open ? 1 : 0,
      }}
    >
      <div ref={contentRef}>{children}</div>
    </div>
  );
}

type BadgeType = "mvp" | "top" | "tf";

function Badge({ type }: { type: BadgeType }) {
  const config = {
    mvp: { label: "MVP", bg: "rgba(236, 194, 54, 0.15)", color: "#ecc236", border: "rgba(236, 194, 54, 0.3)" },
    top: { label: "TOP", bg: "rgba(59, 180, 160, 0.12)", color: "#3bb4a0", border: "rgba(59, 180, 160, 0.25)" },
    tf: { label: "TF", bg: "rgba(255, 255, 255, 0.06)", color: "var(--ink-faint)", border: "rgba(255, 255, 255, 0.1)" },
  }[type];

  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 3,
      padding: "1px 5px",
      borderRadius: 3,
      fontSize: 8,
      fontWeight: 700,
      letterSpacing: "0.6px",
      lineHeight: 1,
      background: config.bg,
      color: config.color,
      border: `1px solid ${config.border}`,
      boxShadow: type === "mvp" ? "0 0 8px rgba(251, 191, 36, 0.2)" : "none",
      transition: "all 0.2s ease",
      whiteSpace: "nowrap",
    }}>
      {type === "tf" && (
        <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="2" x2="12" y2="6" />
          <line x1="12" y1="18" x2="12" y2="22" />
          <line x1="2" y1="12" x2="6" y2="12" />
          <line x1="18" y1="12" x2="22" y2="12" />
        </svg>
      )}
      {config.label}
    </span>
  );
}

function Row({ p, all, self, i, expanded, onToggle, badges }: {
  p: Player; all: Player[]; self: boolean; i: number;
  expanded: boolean; onToggle: () => void;
  badges?: BadgeType[];
}) {
  const rc = rankColor(p.rankName);
  const pc = rankColor(p.peakRankName);
  const party = p.isPartyMember && all.filter((x) => x.partyId === p.partyId && x.isPartyMember).length > 1;
  const delay = i < 10 ? `a-d${i + 1}` : "a-enter";
  const flags = smurfFlags(p);
  const isMvp = badges?.includes("mvp");

  return (
    <div>
      <div
        className={`player-row ${delay}`}
        data-self={self || undefined}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
        style={{
          cursor: "pointer",
          userSelect: "none",
          ...(self && !isMvp ? {
            borderLeft: "2px solid rgba(var(--accent-raw, 99, 102, 241), 0.35)",
            background: "rgba(var(--accent-raw, 99, 102, 241), 0.03)",
            boxShadow: "inset 2px 0 12px rgba(var(--accent-raw, 99, 102, 241), 0.06), 0 0 0 0 transparent",
          } : {}),
          ...(isMvp ? {
            borderLeft: "2px solid rgba(236, 194, 54, 0.5)",
            background: "rgba(236, 194, 54, 0.04)",
          } : {}),
        }}
      >
        {party && (
          <div className="party-bar" style={{ background: partyHue(p.partyId), transition: "opacity 0.2s ease" }} />
        )}

        <div
          className="agent-icon agent-icon-hover"
          style={{
            "--team-glow": p.teamId === "Red" ? "rgba(239, 68, 68, 0.35)" : "rgba(59, 130, 246, 0.35)",
            transition: "border-color 0.2s ease, box-shadow 0.2s ease",
          } as React.CSSProperties}
        >
          {p.agentId ? (
            <img src={agentImg(p.agentId)} alt={p.agentName} style={{ width: "100%", height: "100%", objectFit: "cover", transition: "transform 0.2s ease" }} loading="lazy" />
          ) : (
            <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }} className="t-label">?</div>
          )}
        </div>

        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {p.name && p.tag ? (
              <a
                href={`https://tracker.gg/valorant/profile/riot/${encodeURIComponent(p.name)}%23${encodeURIComponent(p.tag)}/overview`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="tracker-link"
                style={{ display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none", color: "inherit", transition: "color 0.2s ease" }}
              >
                <span className="t-title" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }}>
                  {p.name}
                </span>
                <svg className="tracker-link-icon" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0, flexShrink: 0, transition: "opacity 0.2s ease, transform 0.2s ease" }}>
                  <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
                </svg>
              </a>
            ) : (
              <span className="t-title" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }}>
                {p.name || "Unknown"}
              </span>
            )}
            {p.tag && <span className="t-label" style={{ color: "var(--ink-dim)", transition: "color 0.2s ease" }}>#{p.tag}</span>}
            {self && <span className="you-badge" style={{ transition: "background 0.2s ease, border-color 0.2s ease" }}>you</span>}
            {flags.length > 0 && (
              <span className="smurf-badge" title={flags.join(" | ")} style={{ transition: "color 0.2s ease, transform 0.2s ease" }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
              </span>
            )}
            {badges && badges.map((b) => <Badge key={b} type={b} />)}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
            <span className="t-label">{p.agentName}</span>
            <span className="dot" />
            <span className="t-label" style={{ fontVariantNumeric: "tabular-nums" }}>LVL {p.accountLevel}</span>
          </div>
          {p.skin && (
            <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--ink-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.5 }}>
                <rect x="2" y="6" width="16" height="6" rx="1" />
                <path d="M18 9h4M8 12v5a1 1 0 01-1 1H6a1 1 0 01-1-1v-5" />
              </svg>
              <span className="t-label" style={{ color: "var(--ink-dim)", fontSize: 10, opacity: 0.7 }}>{p.skin}</span>
            </div>
          )}
        </div>

        <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ textAlign: "right", minWidth: 60 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
              <span className="t-title" style={{ color: rc, fontSize: 13, opacity: p.rank >= 3 && !p.isCurrentActRank ? 0.55 : 1, transition: "color 0.2s ease, opacity 0.2s ease" }}>{p.rankName}</span>
              {p.rank >= 3 && !p.isCurrentActRank && (
                <span className="t-micro" style={{ color: "var(--warn)", fontSize: 8, letterSpacing: "0.5px" }}>PREV</span>
              )}
            </div>
            <div className="t-mono" style={{ marginTop: 2 }}>{p.rr} RR</div>
          </div>
        </div>

        <div className="hidden md:flex" style={{ flexShrink: 0, alignItems: "center", gap: 6 }}>
          <div style={{ textAlign: "right", minWidth: 48 }}>
            <div className="t-micro" style={{ color: "var(--ink-dim)" }}>Peak</div>
            <div className="t-body" style={{ color: pc, marginTop: 2, fontSize: 11, transition: "color 0.2s ease" }}>{p.peakRankName}</div>
          </div>
        </div>

        <div className="hidden lg:flex" style={{ alignItems: "center", gap: 14, flexShrink: 0 }}>
          <StatCell label="ACS" val={p.acs > 0 ? `${p.acs}` : "-"} warn={p.acs >= 250} />
          <StatCell label="HS%" val={p.headshotPercent > 0 ? `${p.headshotPercent.toFixed(1)}` : "-"} warn={p.headshotPercent >= 30} />
          <StatCell label="K/D" val={p.kd > 0 ? p.kd.toFixed(2) : "-"} warn={p.kd >= 1.5} />
          <StatCell label="WR" val={p.winrate > 0 ? `${p.winrate.toFixed(0)}%` : "-"} warn={p.winrate >= 55} />
        </div>

        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--ink-dim)"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{
            flexShrink: 0,
            transition: "transform 0.28s cubic-bezier(0.22, 1, 0.36, 1), stroke 0.2s ease",
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      <ExpandCollapse open={expanded}>
        <ExpandedRow p={p} flags={flags} />
      </ExpandCollapse>
    </div>
  );
}

function ExpandedRow({ p, flags }: {
  p: Player; flags: string[];
}) {
  const totalShots = p.headshots + p.bodyshots + p.legshots;
  const hsPct = totalShots > 0 ? (p.headshots / totalShots * 100) : 0;
  const bsPct = totalShots > 0 ? (p.bodyshots / totalShots * 100) : 0;
  const lsPct = totalShots > 0 ? (p.legshots / totalShots * 100) : 0;

  const detailRowStyle: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    padding: "3px 0",
  };

  return (
    <div className="expanded-panel" style={{
      background: "rgba(0, 0, 0, 0.12)",
      boxShadow: "inset 0 1px 4px rgba(0, 0, 0, 0.3)",
    }}>
      <div className="expanded-grid">
        <div className="expanded-section">
          <div className="t-micro" style={{ color: "var(--ink-dim)", marginBottom: 8 }}>Last Match</div>
          <div style={{ display: "flex", gap: 14, alignItems: "baseline" }}>
            <div>
              <span className="t-title" style={{ fontSize: 20, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}>
                {p.kills}<span className="t-label" style={{ opacity: 0.35, margin: "0 1px" }}>/</span>{p.deaths}<span className="t-label" style={{ opacity: 0.35, margin: "0 1px" }}>/</span>{p.assists}
              </span>
              <div className="t-micro" style={{ color: "var(--ink-dim)", marginTop: 3 }}>K / D / A</div>
            </div>
            <div style={{ width: 1, height: 28, background: "var(--border)", flexShrink: 0 }} />
            <div>
              <div className="t-title" style={{ fontSize: 16, color: p.kd >= 1 ? "var(--up)" : "var(--down)", fontVariantNumeric: "tabular-nums", transition: "color 0.2s ease" }}>
                {p.kd > 0 ? p.kd.toFixed(2) : "-"}
              </div>
              <div className="t-micro" style={{ color: "var(--ink-dim)", marginTop: 3 }}>K/D</div>
            </div>
          </div>
        </div>

        {totalShots > 0 && (
          <div className="expanded-section">
            <div className="t-micro" style={{ color: "var(--ink-dim)", marginBottom: 8 }}>Shot Distribution</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <ShotBar label="Head" pct={hsPct} count={p.headshots} color="var(--up)" />
              <ShotBar label="Body" pct={bsPct} count={p.bodyshots} color="var(--info)" />
              <ShotBar label="Legs" pct={lsPct} count={p.legshots} color="var(--warn)" />
            </div>
          </div>
        )}

        <div className="expanded-section">
          <div className="t-micro" style={{ color: "var(--ink-dim)", marginBottom: 8 }}>Details</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div style={detailRowStyle}>
              <span className="t-label">ACS</span>
              <span className="t-body" style={{ fontVariantNumeric: "tabular-nums", color: p.acs >= 250 ? "var(--up)" : undefined, transition: "color 0.2s ease" }}>{p.acs > 0 ? p.acs : "-"}</span>
            </div>
            <div style={detailRowStyle}>
              <span className="t-label">ADR</span>
              <span className="t-body" style={{ fontVariantNumeric: "tabular-nums" }}>{p.adr > 0 ? p.adr.toFixed(1) : "-"}</span>
            </div>
            <div style={detailRowStyle}>
              <span className="t-label">Winrate</span>
              <span className="t-body" style={{ fontVariantNumeric: "tabular-nums" }}>{p.winrate > 0 ? `${p.winrate.toFixed(1)}%` : "-"}</span>
            </div>
            <div style={detailRowStyle}>
              <span className="t-label">Act Record</span>
              <span className="t-body" style={{ fontVariantNumeric: "tabular-nums" }}>
                {p.currentSeasonGames > 0
                  ? <><span style={{ color: "var(--up)", transition: "color 0.2s ease" }}>{p.currentSeasonWins}W</span> / {p.currentSeasonGames}G</>
                  : <span style={{ color: "var(--ink-dim)" }}>No games</span>
                }
              </span>
            </div>
            <div style={detailRowStyle}>
              <span className="t-label">Level</span>
              <span className="t-body" style={{ fontVariantNumeric: "tabular-nums" }}>{p.accountLevel}</span>
            </div>
            <div style={detailRowStyle}>
              <span className="t-label">Agent</span>
              <span className="t-body">{p.agentName}</span>
            </div>
          </div>
        </div>
      </div>

      {flags.length > 0 && (
        <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
          {flags.map((f, i) => (
            <span key={i} className="smurf-flag" style={{ transition: "background 0.2s ease, border-color 0.2s ease" }}>
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
              {f}
            </span>
          ))}
        </div>
      )}

    </div>
  );
}

function ShotBar({ label, pct, count, color }: { label: string; pct: number; count: number; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span className="t-micro" style={{ width: 30, textAlign: "right", flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 4, borderRadius: "var(--radius-xs)", background: "var(--surface-2)", overflow: "hidden" }}>
        <div style={{
          width: `${pct}%`,
          height: "100%",
          borderRadius: "var(--radius-xs)",
          background: color,
          transition: "width 0.5s cubic-bezier(0.22, 1, 0.36, 1)",
        }} />
      </div>
      <span className="t-mono" style={{ width: 40, textAlign: "right", fontSize: 10, flexShrink: 0 }}>{pct.toFixed(0)}%</span>
      <span className="t-micro" style={{ width: 24, textAlign: "right", color: "var(--ink-dim)", flexShrink: 0 }}>{count}</span>
    </div>
  );
}

function StatCell({ label, val, warn }: { label: string; val: string; warn?: boolean }) {
  return (
    <div style={{ textAlign: "center", minWidth: 36 }}>
      <div className="t-micro">{label}</div>
      <div className="t-body" style={{
        fontVariantNumeric: "tabular-nums",
        marginTop: 3,
        color: warn ? "var(--up)" : undefined,
        transition: "color 0.2s ease",
      }}>{val}</div>
    </div>
  );
}

function RankDistribution({ myPlayers, enemyPlayers, myColor, enemyColor }: {
  myPlayers: Player[]; enemyPlayers: Player[]; myColor: string; enemyColor: string;
}) {
  const allRanked = [...myPlayers, ...enemyPlayers].filter((p) => p.rank >= 3);
  if (allRanked.length === 0) return null;

  const minRank = Math.min(...allRanked.map((p) => p.rank));
  const maxRank = Math.max(...allRanked.map((p) => p.rank));
  const range = Math.max(1, maxRank - minRank);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div className="t-micro" style={{ color: "var(--ink-dim)", textAlign: "center" }}>Rank Spread</div>
      <div style={{ position: "relative", height: 24, background: "var(--surface-1)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
        {Array.from(new Set(allRanked.map((p) => p.rank))).map((tier) => {
          const left = ((tier - minRank) / range) * 100;
          return (
            <div key={`label-${tier}`} style={{
              position: "absolute", left: `${left}%`, bottom: 0, transform: "translateX(-50%)",
              fontSize: 7, fontFamily: "var(--mono)", color: "var(--ink-dim)", letterSpacing: "0.5px",
              transition: "left 0.4s cubic-bezier(0.22, 1, 0.36, 1)",
            }}>
              {RANK_NAMES_SHORT[tier] ?? ""}
            </div>
          );
        })}
        {myPlayers.filter((p) => p.rank >= 3).map((p) => {
          const left = ((p.rank - minRank) / range) * 100;
          return (
            <div key={p.puuid} title={`${p.name} - ${p.rankName}`} style={{
              position: "absolute", left: `${left}%`, top: 3, transform: "translateX(-50%)",
              width: 8, height: 8, borderRadius: "50%", background: myColor, opacity: 0.8,
              border: "1.5px solid var(--void)",
              transition: "left 0.4s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.2s ease",
            }} />
          );
        })}
        {enemyPlayers.filter((p) => p.rank >= 3).map((p) => {
          const left = ((p.rank - minRank) / range) * 100;
          return (
            <div key={p.puuid} title={`${p.name} - ${p.rankName}`} style={{
              position: "absolute", left: `${left}%`, top: 3, transform: "translateX(-50%)",
              width: 8, height: 8, borderRadius: "50%", background: enemyColor, opacity: 0.8,
              border: "1.5px solid var(--void)",
              transition: "left 0.4s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.2s ease",
            }} />
          );
        })}
      </div>
    </div>
  );
}

function Team({ label, color, players, all, selfPuuid, expandedPuuid, setExpanded, playerBadges }: {
  label: string; color: string; players: Player[]; all: Player[]; selfPuuid: string;
  expandedPuuid: string | null; setExpanded: (id: string | null) => void;
  playerBadges?: Map<string, BadgeType[]>;
}) {
  const avg = avgTeamRank(players);
  const party = partyLabel(players);

  const ROLE_COLORS: Record<string, string> = {
    Duelist: "var(--down)", Initiator: "var(--info)", Controller: "var(--up)", Sentinel: "var(--warn)",
  };
  const roleCounts: Record<string, number> = {};
  for (const p of players) {
    const role = AGENT_ROLE_MAP[p.agentName];
    if (role) roleCounts[role] = (roleCounts[role] ?? 0) + 1;
  }
  const roleEntries = ["Duelist", "Initiator", "Controller", "Sentinel"]
    .filter((r) => (roleCounts[r] ?? 0) > 0)
    .map((r) => ({ role: r, count: roleCounts[r] ?? 0, color: ROLE_COLORS[r] }));
  const compWarnings: string[] = [];
  if ((roleCounts["Controller"] ?? 0) === 0 && players.length >= 5) compWarnings.push("No smokes");
  if ((roleCounts["Duelist"] ?? 0) >= 3) compWarnings.push("3+ Duelists");

  return (
    <div>
      <div className="section-label">
        <div style={{ width: 3, height: 14, borderRadius: 1, background: color, transition: "background 0.2s ease" }} />
        <span className="t-label" style={{ color, transition: "color 0.2s ease" }}>{label}</span>
        {party && (
          <span className="party-badge" style={{ transition: "background 0.2s ease, border-color 0.2s ease, color 0.2s ease" }}>{party}</span>
        )}
        {avg && (
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 5 }}>
            <span className="t-label" style={{ color: avg.color, fontWeight: 600, letterSpacing: 0.5, transition: "color 0.2s ease" }}>{avg.name}</span>
          </span>
        )}
      </div>
      <div style={{
        height: 1, marginTop: 4,
        background: `linear-gradient(90deg, ${color}, transparent 60%)`,
        opacity: 0.2,
      }} />
      {roleEntries.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "4px 8px 4px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {roleEntries.map(({ role, count, color: roleColor }) => (
              <span key={role} className="t-micro" style={{ color: roleColor, letterSpacing: "0.3px", transition: "color 0.2s ease" }}>
                {count} {role}
              </span>
            ))}
          </div>
          {compWarnings.length > 0 && compWarnings.map((w) => (
            <span key={w} className="smurf-flag" style={{ color: "var(--warn)", fontSize: 9, padding: "1px 6px", display: "inline-flex", alignItems: "center", gap: 3, transition: "background 0.2s ease, border-color 0.2s ease" }}>
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
              {w}
            </span>
          ))}
        </div>
      )}
      <div className="card" style={{ padding: 4 }}>
        {players.map((p, i) => (
          <Row
            key={p.puuid}
            p={p}
            all={all}
            self={p.puuid === selfPuuid}
            i={i}
            expanded={expandedPuuid === p.puuid}
            onToggle={() => setExpanded(expandedPuuid === p.puuid ? null : p.puuid)}
            badges={playerBadges?.get(p.puuid)}
          />
        ))}
      </div>
    </div>
  );
}

function WinBar({ myPct, myLabel, enemyLabel, myColor, enemyColor, myPlayers, enemyPlayers }: {
  myPct: number; myLabel: string; enemyLabel: string; myColor: string; enemyColor: string;
  myPlayers: Player[]; enemyPlayers: Player[];
}) {
  const clamped = Math.max(5, Math.min(95, myPct));
  const enemyPct = 100 - myPct;
  const myRound = Math.round(myPct);
  const enemyRound = Math.round(enemyPct);
  const favored = myRound > enemyRound ? "you" : myRound < enemyRound ? "them" : "even";

  return (
    <div className="card a-enter winbar-card">
      <div className="winbar-header">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 3, height: 12, borderRadius: 1, background: myColor, transition: "background 0.3s ease" }} />
          <span className="t-label" style={{ color: myColor, transition: "color 0.3s ease" }}>{myLabel}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <span className="t-micro" style={{ color: "var(--ink-dim)" }}>Win Chance</span>
          {favored !== "even" && (
            <span className="t-micro" style={{ color: favored === "you" ? "var(--up)" : "var(--down)", transition: "color 0.3s ease" }}>
              {favored === "you" ? "Favored" : "Underdog"}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="t-label" style={{ color: enemyColor, transition: "color 0.3s ease" }}>{enemyLabel}</span>
          <div style={{ width: 3, height: 12, borderRadius: 1, background: enemyColor, transition: "background 0.3s ease" }} />
        </div>
      </div>

      <div className="winbar-track">
        <div className="winbar-fill" style={{
          width: `${clamped}%`,
          background: `linear-gradient(90deg, ${myColor}, ${myColor}cc)`,
          boxShadow: `0 2px 8px ${myColor}30`,
          transition: "width 0.6s cubic-bezier(0.22, 1, 0.36, 1), background 0.3s ease",
        }} />
        <div className="winbar-fill" style={{
          width: `${100 - clamped}%`,
          background: `linear-gradient(90deg, ${enemyColor}cc, ${enemyColor})`,
          boxShadow: `0 2px 8px ${enemyColor}30`,
          transition: "width 0.6s cubic-bezier(0.22, 1, 0.36, 1), background 0.3s ease",
        }} />
        <div className="winbar-notch" />
      </div>

      <div className="winbar-footer">
        <span className="t-title" style={{ color: myColor, fontSize: 18, fontVariantNumeric: "tabular-nums", transition: "color 0.3s ease", filter: "brightness(1.15)" }}>
          {myRound}<span className="t-label" style={{ color: myColor, opacity: 0.7 }}>%</span>
        </span>
        <span className="t-title" style={{ color: enemyColor, fontSize: 18, fontVariantNumeric: "tabular-nums", transition: "color 0.3s ease", filter: "brightness(1.15)" }}>
          {enemyRound}<span className="t-label" style={{ color: enemyColor, opacity: 0.7 }}>%</span>
        </span>
      </div>

      <RankDistribution myPlayers={myPlayers} enemyPlayers={enemyPlayers} myColor={myColor} enemyColor={enemyColor} />
    </div>
  );
}

export default function PlayerTable({ players, isDeathmatch, selfPuuid = "" }: Props) {
  const [expandedPuuid, setExpanded] = useState<string | null>(null);

  if (isDeathmatch) {
    return (
      <Team
        label="Players" color="var(--ink-faint)" players={players} all={players}
        selfPuuid={selfPuuid} expandedPuuid={expandedPuuid} setExpanded={setExpanded}
      />
    );
  }

  const blue = players.filter((p) => p.teamId === "Blue");
  const red = players.filter((p) => p.teamId === "Red");
  const selfTeam = players.find((p) => p.puuid === selfPuuid)?.teamId ?? "Blue";
  const my = selfTeam === "Blue" ? blue : red;
  const enemy = selfTeam === "Blue" ? red : blue;
  const myColor = selfTeam === "Blue" ? "var(--blue)" : "var(--red)";
  const enemyColor = selfTeam === "Blue" ? "var(--red)" : "var(--blue)";

  const playerBadges = useMemo(() => {
    const badges = new Map<string, BadgeType[]>();
    if (players.length === 0) return badges;

    const sorted = [...players].filter(p => p.acs > 0).sort((a, b) => b.acs - a.acs);
    const mvp = sorted[0];
    if (mvp) {
      badges.set(mvp.puuid, ["mvp"]);
    }

    const topFragger = [...players].filter(p => p.kills > 0).sort((a, b) => b.kills - a.kills)[0];
    if (topFragger && topFragger.puuid !== mvp?.puuid) {
      const existing = badges.get(topFragger.puuid) ?? [];
      badges.set(topFragger.puuid, [...existing, "tf"]);
    }

    const teams = new Set(players.map(p => p.teamId));
    for (const teamId of teams) {
      const teamPlayers = players.filter(p => p.teamId === teamId && p.acs > 0).sort((a, b) => b.acs - a.acs);
      const teamMvp = teamPlayers[0];
      if (teamMvp && teamMvp.puuid !== mvp?.puuid) {
        const existing = badges.get(teamMvp.puuid) ?? [];
        if (!existing.includes("tf")) {
          badges.set(teamMvp.puuid, [...existing, "top"]);
        }
      }
    }

    return badges;
  }, [players]);

  const myElo = teamElo(my);
  const enemyElo = teamElo(enemy);
  const showWinBar = myElo > 0 && enemyElo > 0;
  const myWinPct = showWinBar ? 100 / (1 + Math.pow(10, (enemyElo - myElo) / 400)) : 50;

  if (my.length === 5 && enemy.length === 5) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {showWinBar && (
          <WinBar
            myPct={myWinPct} myLabel="Your Team" enemyLabel="Enemy Team"
            myColor={myColor} enemyColor={enemyColor}
            myPlayers={my} enemyPlayers={enemy}
          />
        )}
        <div className="grid grid-cols-1 xl:grid-cols-2" style={{ gap: 16 }}>
          <Team label="Your Team" color={myColor} players={my} all={players} selfPuuid={selfPuuid} expandedPuuid={expandedPuuid} setExpanded={setExpanded} playerBadges={playerBadges} />
          <Team label="Enemy Team" color={enemyColor} players={enemy} all={players} selfPuuid={selfPuuid} expandedPuuid={expandedPuuid} setExpanded={setExpanded} playerBadges={playerBadges} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {showWinBar && (
        <WinBar
          myPct={myWinPct} myLabel="Your Team" enemyLabel="Enemy Team"
          myColor={myColor} enemyColor={enemyColor}
          myPlayers={my} enemyPlayers={enemy}
        />
      )}
      {my.length > 0 && <Team label="Your Team" color={myColor} players={my} all={players} selfPuuid={selfPuuid} expandedPuuid={expandedPuuid} setExpanded={setExpanded} playerBadges={playerBadges} />}
      {enemy.length > 0 && <Team label="Enemy Team" color={enemyColor} players={enemy} all={players} selfPuuid={selfPuuid} expandedPuuid={expandedPuuid} setExpanded={setExpanded} playerBadges={playerBadges} />}
    </div>
  );
}
