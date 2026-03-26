"use client";

import { useState, useCallback, useRef, useEffect, memo } from "react";
import type { MatchInfo, Player } from "@/lib/types";
import { RANK_NAMES_SHORT } from "@/lib/constants";

function useElapsedTimer(startTime?: number): string | null {
  const [elapsed, setElapsed] = useState<number>(0);

  useEffect(() => {
    if (!startTime) {
      setElapsed(0);
      return;
    }
    setElapsed(Math.floor((Date.now() - startTime) / 1000));

    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    return () => clearInterval(id);
  }, [startTime]);

  if (!startTime) return null;
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

interface MatchHeaderProps {
  matchInfo: MatchInfo;
  gameState: string;
  onRefresh: () => void;
  refreshing: boolean;
  players?: Player[];
  onCopyToast?: () => void;
  stateStartTime?: number;
}

function avgRankLabel(players: Player[]): string {
  const ranked = players.filter((p) => p.rank >= 3);
  if (ranked.length === 0) return "Unranked";
  const avg = ranked.reduce((s, p) => s + p.rank + p.rr / 100, 0) / ranked.length;
  const tier = Math.max(3, Math.min(27, Math.round(avg)));
  return RANK_NAMES_SHORT[tier] ?? "??";
}

function formatMatchStats(matchInfo: MatchInfo, players: Player[]): string {
  const blue = players.filter((p) => p.teamId === "Blue");
  const red = players.filter((p) => p.teamId === "Red");

  const formatPlayer = (p: Player) =>
    `${p.name}#${p.tag} — ${p.agentName || "?"} — ${p.rankName || "Unranked"} — ${p.kills}/${p.deaths}/${p.assists} — ${p.acs.toFixed(1)} ACS`;

  const lines: string[] = [];
  lines.push(`Valorant — ${matchInfo.mapName} (${matchInfo.gameModeName})`);
  lines.push("");
  lines.push(`Team Blue (Avg: ${avgRankLabel(blue)})`);
  blue.forEach((p) => lines.push(formatPlayer(p)));
  lines.push("");
  lines.push(`Team Red (Avg: ${avgRankLabel(red)})`);
  red.forEach((p) => lines.push(formatPlayer(p)));

  return lines.join("\n");
}

const tagTransition = "all 0.2s ease";

export default function MatchHeader({ matchInfo, gameState, onRefresh, refreshing, players, onCopyToast, stateStartTime }: MatchHeaderProps) {
  const live = gameState === "INGAME";
  const showTimer = gameState === "PREGAME" || gameState === "INGAME";
  const timerDisplay = useElapsedTimer(showTimer ? stateStartTime : undefined);
  return (
    <div
      className="a-enter"
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        overflow: "hidden",
        background: "linear-gradient(to bottom, var(--surface-1), var(--surface-0))",
        borderRadius: 12,
        border: "1px solid var(--border)",
        boxShadow: "0 0 0 1px var(--surface-1), var(--shadow-md)",
        padding: "28px 24px 24px",
      }}
    >
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 2, zIndex: 2,
        background: "linear-gradient(90deg, transparent, rgba(var(--accent-raw), 0.5), transparent)",
      }} />
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 1,
          background: "linear-gradient(90deg, transparent, var(--border-hover) 30%, var(--border-hover) 70%, transparent)",
          zIndex: 2,
        }}
      />
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none", zIndex: 1,
        background: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.03) 2px, rgba(0,0,0,0.03) 4px)",
        mixBlendMode: "multiply",
      }} />

      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(ellipse 80% 100% at 0% 0%, var(--accent-soft) 0%, transparent 60%)",
          opacity: 0.85,
          borderRadius: "var(--radius-md)",
          pointerEvents: "none",
          zIndex: 1,
        }}
      />

      <h1
        className="t-display"
        style={{
          position: "relative",
          zIndex: 2,
          fontSize: 42,
          letterSpacing: "-0.5px",
          background: "linear-gradient(to bottom, var(--ink) 30%, var(--ink-sub) 100%)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
          textShadow: "0 0 30px rgba(var(--accent-raw), 0.15)",
        }}
      >
        {matchInfo.mapName}
      </h1>

      {live && matchInfo.allyScore !== undefined && matchInfo.enemyScore !== undefined && (
        <div
          style={{
            position: "relative",
            zIndex: 2,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span
            className="stat-hero stat-glow"
            style={{
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 36,
              fontWeight: 700,
              letterSpacing: "2px",
              lineHeight: 1,
              display: "flex",
              alignItems: "center",
              gap: 0,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <span style={{
              color: matchInfo.allyScore > matchInfo.enemyScore ? "var(--up)" : matchInfo.allyScore < matchInfo.enemyScore ? "var(--red, #ff4655)" : "var(--ink-faint)",
              ...(matchInfo.allyScore > matchInfo.enemyScore ? { textShadow: "0 0 12px rgba(74, 222, 128, 0.4), 0 0 24px rgba(74, 222, 128, 0.15)" } : {}),
            }}>
              {matchInfo.allyScore}
            </span>
            <span style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              margin: "0 10px",
              gap: 0,
            }}>
              <span style={{
                width: 1,
                height: 12,
                background: "linear-gradient(to bottom, transparent, var(--ink-dim), transparent)",
              }} />
              <span style={{ color: "var(--ink-faint)", fontSize: 20, lineHeight: 1, margin: "2px 0" }}>:</span>
              <span style={{
                width: 1,
                height: 12,
                background: "linear-gradient(to bottom, transparent, var(--ink-dim), transparent)",
              }} />
            </span>
            <span style={{
              color: matchInfo.enemyScore > matchInfo.allyScore ? "var(--up)" : matchInfo.enemyScore < matchInfo.allyScore ? "var(--red, #ff4655)" : "var(--ink-faint)",
              ...(matchInfo.enemyScore > matchInfo.allyScore ? { textShadow: "0 0 12px rgba(74, 222, 128, 0.4), 0 0 24px rgba(74, 222, 128, 0.15)" } : {}),
            }}>
              {matchInfo.enemyScore}
            </span>
          </span>
          <span
            className="t-micro"
            style={{
              color: "var(--ink-dim)",
              fontSize: 10,
              letterSpacing: "0.5px",
              opacity: 0.7,
            }}
          >
            R{matchInfo.allyScore + matchInfo.enemyScore + 1}
          </span>
        </div>
      )}

      <div
        style={{
          position: "relative",
          zIndex: 2,
          height: 1,
          background: "linear-gradient(90deg, var(--border-accent), var(--border) 50%, transparent 85%)",
          opacity: 0.7,
        }}
      />

      <div
        style={{
          position: "relative",
          zIndex: 2,
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <span
          className="tag"
          style={{
            transition: tagTransition,
            borderColor: live ? "rgba(74, 222, 128, 0.3)" : "rgba(251, 191, 36, 0.25)",
            ...(live
              ? { boxShadow: "0 0 16px rgba(74, 222, 128, 0.2), 0 0 6px rgba(74, 222, 128, 0.1), inset 0 0 8px rgba(74, 222, 128, 0.06), inset 0 1px 0 rgba(74, 222, 128, 0.08)" }
              : { boxShadow: "inset 0 1px 0 var(--surface-1), inset 0 0 4px var(--surface-3)" }),
          }}
        >
          <span
            className="a-pulse"
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: live ? "var(--up)" : "var(--warn)",
              transition: tagTransition,
              ...(live ? { boxShadow: "0 0 6px var(--up), 0 0 12px rgba(74, 222, 128, 0.3)" } : {}),
              animationDuration: "2.4s",
              animationTimingFunction: "ease-in-out",
            }}
          />
          <span style={{ color: live ? "var(--up)" : "var(--warn)", transition: "color 0.2s ease" }}>
            {live ? "Live" : "Agent Select"}
          </span>
          {timerDisplay && (
            <span style={{
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 11,
              color: "var(--ink-dim)",
              opacity: 0.7,
              marginLeft: 2,
              fontVariantNumeric: "tabular-nums",
              padding: "2px 10px",
              borderRadius: "var(--radius-sm)",
              background: "rgba(var(--accent-raw), 0.06)",
              border: "1px solid rgba(var(--accent-raw), 0.12)",
            }}>
              {timerDisplay}
            </span>
          )}
        </span>

        <span className="tag" style={{ transition: tagTransition, boxShadow: "inset 0 1px 0 var(--surface-1), inset 0 0 4px var(--surface-3)" }}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: matchInfo.isRanked ? "var(--accent)" : "var(--info)",
              flexShrink: 0,
              transition: tagTransition,
            }}
          />
          {matchInfo.gameModeName}
        </span>

        {matchInfo.isRanked && (
          <span
            className="tag"
            style={{
              color: "var(--accent)",
              borderColor: "var(--border-accent)",
              transition: tagTransition,
              boxShadow: "0 0 12px rgba(var(--accent-raw), 0.15), inset 0 1px 0 var(--surface-1), inset 0 0 4px var(--surface-3)",
            }}
          >
            Ranked
          </span>
        )}

        {matchInfo.server && (
          <span className="tag" style={{ transition: tagTransition, boxShadow: "inset 0 1px 0 var(--surface-1), inset 0 0 4px var(--surface-3)" }}>
            {matchInfo.server}
          </span>
        )}

        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="btn-ghost"
          aria-label={refreshing ? "Refreshing match data" : "Refresh match data"}
          style={{
            transition: "all 0.2s ease, transform 0.15s cubic-bezier(0.22, 1, 0.36, 1)",
          }}
          onMouseDown={(e) => {
            if (!refreshing) e.currentTarget.style.transform = "scale(0.93)";
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.transform = "scale(1)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "scale(1)";
          }}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={refreshing ? "a-spin" : ""}
          >
            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3" />
          </svg>
          Refresh
        </button>

        {players && players.length > 0 && (
          <CopyMatchButton matchInfo={matchInfo} players={players} onCopyToast={onCopyToast} />
        )}
      </div>
    </div>
  );
}

const CopyMatchButton = memo(function CopyMatchButton({
  matchInfo,
  players,
  onCopyToast,
}: {
  matchInfo: MatchInfo;
  players: Player[];
  onCopyToast?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      const text = formatMatchStats(matchInfo, players);
      await navigator.clipboard.writeText(text);
      setCopied(true);
      onCopyToast?.();
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy match stats to clipboard:", err);
    }
  }, [matchInfo, players, onCopyToast]);

  return (
    <button
      onClick={handleCopy}
      className="btn-ghost"
      aria-label={copied ? "Match ID copied" : "Copy match ID"}
      style={{
        transition: "all 0.2s ease, transform 0.15s cubic-bezier(0.22, 1, 0.36, 1)",
      }}
      onMouseDown={(e) => {
        e.currentTarget.style.transform = "scale(0.93)";
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = "scale(1)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "scale(1)";
      }}
    >
      {copied ? (
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
      {copied ? "Copied" : "Copy"}
    </button>
  );
});
