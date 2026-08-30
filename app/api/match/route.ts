import {
  readLockfile,
  getApiConfig,
  getPreGamePlayerId,
  getCoreGamePlayerId,
  getPreGameMatch,
  getCoreGameMatch,
  getCoreGameLoadouts,
  getPlayerMMR,
  getCompetitiveUpdates,
  getMatchDetails,
  getNameFromPuuid,
  getSelfPresenceScore,
} from "@/lib/valorant-api";
import { RANK_MAP, AGENT_MAP, MAP_MAP, GAMEMODE_MAP, DEATHMATCH_MODES } from "@/lib/constants";
import type { ValorantPlayer, MatchInfo, ApiConfig } from "@/lib/types";

export const dynamic = "force-dynamic";

const VANDAL_WEAPON_ID = "9c82e19d-4575-0200-1a81-3eacf00cf872";
const RECENT_GAMES_COUNT = 20;

let matchCache: {
  matchId: string;
  players: ValorantPlayer[];
  matchInfo: MatchInfo;
  gameState: string;
} | null = null;

function getPeakRank(seasonalInfo: Record<string, any>): number {
  let peak = 0;
  for (const seasonId in seasonalInfo) {
    const tier = seasonalInfo[seasonId]?.CompetitiveTier ?? 0;
    if (tier > peak) peak = tier;
  }
  return peak;
}

function getCurrentSeasonId(seasonalInfo: Record<string, any>, matchSeasonId: string): string | null {
  if (matchSeasonId && seasonalInfo[matchSeasonId]) return matchSeasonId;

  let best: string | null = null;
  for (const seasonId in seasonalInfo) {
    const games = seasonalInfo[seasonId]?.NumberOfGames ?? 0;
    if (games > 0 && (!best || seasonId > best)) {
      best = seasonId;
    }
  }
  return best;
}

function extractSkin(loadouts: any, puuid: string): string {
  try {
    const playerLoadout = Array.isArray(loadouts?.Loadouts)
      ? loadouts.Loadouts.find((l: any) => l.Subject === puuid)
      : loadouts;

    const items = playerLoadout?.Loadout?.Items;
    if (items && typeof items === "object" && !Array.isArray(items)) {
      const vandalEntry = items[VANDAL_WEAPON_ID];
      if (vandalEntry) {
        return vandalEntry.SkinID ?? vandalEntry.ChromaID ?? vandalEntry.Skins?.[0]?.SkinID ?? "Unknown";
      }
    }

    const guns = playerLoadout?.Guns ?? [];
    if (Array.isArray(guns)) {
      const vandal = guns.find((g: any) => g.ID === VANDAL_WEAPON_ID || g.ItemID === VANDAL_WEAPON_ID);
      if (vandal) {
        return vandal.SkinID ?? vandal.ChromaID ?? vandal.Skins?.[0]?.SkinID ?? "Unknown";
      }
    }

    return "Unknown";
  } catch {
    return "Unknown";
  }
}

// Sized to comfortably hold ~20 recent games for up to 10 players in a single lobby
// without evicting entries mid-session (details are keyed by immutable match id).
const MAX_MATCH_DETAIL_CACHE = 250;
const matchDetailCache = new Map<string, any>();
let matchDetailCacheForMatchId: string | null = null;

function cacheMatchDetail(id: string, detail: any, currentMatchId: string) {
  if (matchDetailCacheForMatchId && matchDetailCacheForMatchId !== currentMatchId) {
    matchDetailCache.clear();
  }
  matchDetailCacheForMatchId = currentMatchId;

  if (matchDetailCache.size >= MAX_MATCH_DETAIL_CACHE) {
    const first = matchDetailCache.keys().next().value;
    if (first) matchDetailCache.delete(first);
  }
  matchDetailCache.set(id, detail);
}

function extractPlayerStats(matchDetail: any, puuid: string) {
  const playerStats = matchDetail?.players?.find((p: any) => p.subject === puuid);
  let kills = 0, deaths = 0, assists = 0, kd = 0;
  let headshots = 0, bodyshots = 0, legshots = 0, headshotPercent = 0;
  let winrate = 0;

  if (playerStats?.stats) {
    kills = playerStats.stats.kills ?? 0;
    deaths = playerStats.stats.deaths ?? 0;
    assists = playerStats.stats.assists ?? 0;
    kd = deaths > 0 ? Math.round((kills / deaths) * 100) / 100 : kills;
  }

  const rounds = matchDetail?.roundResults ?? [];
  let totalHeadshots = 0, totalBodyshots = 0, totalLegshots = 0;
  let totalDamage = 0;
  for (const round of rounds) {
    const playerRound = round?.playerStats?.find((p: any) => p.subject === puuid);
    if (playerRound?.damage) {
      for (const d of playerRound.damage) {
        totalHeadshots += d.headshots ?? 0;
        totalBodyshots += d.bodyshots ?? 0;
        totalLegshots += d.legshots ?? 0;
        totalDamage += d.damage ?? 0;
      }
    }
  }
  headshots = totalHeadshots;
  bodyshots = totalBodyshots;
  legshots = totalLegshots;
  const totalShots = totalHeadshots + totalBodyshots + totalLegshots;
  headshotPercent = totalShots > 0
    ? Math.round((totalHeadshots / totalShots) * 1000) / 10
    : 0;

  const roundsPlayed = playerStats?.stats?.roundsPlayed ?? rounds.length;
  const acs = roundsPlayed > 0 ? Math.round((playerStats?.stats?.score ?? 0) / roundsPlayed) : 0;
  const adr = roundsPlayed > 0 ? Math.round((totalDamage / roundsPlayed) * 10) / 10 : 0;

  const teamId = playerStats?.teamId;
  let won = false;
  if (teamId) {
    const team = matchDetail?.teams?.find((t: any) => t.teamId === teamId);
    const wins = team?.roundsWon ?? 0;
    const total = team?.roundsPlayed ?? 0;
    winrate = total > 0 ? Math.round((wins / total) * 1000) / 10 : 0;
    if (typeof team?.won === "boolean") {
      won = team.won;
    } else {
      const opponent = matchDetail?.teams?.find((t: any) => t.teamId !== teamId);
      won = wins > (opponent?.roundsWon ?? 0);
    }
  }

  return { kills, deaths, assists, kd, headshots, bodyshots, legshots, headshotPercent, winrate, acs, adr, won };
}

/** Averages a player's stats across their N most recent completed matches. */
function aggregatePlayerStats(matchDetails: any[], puuid: string) {
  let sumKills = 0, sumDeaths = 0, sumAssists = 0;
  let sumHeadshots = 0, sumBodyshots = 0, sumLegshots = 0;
  let sumAcs = 0, sumAdr = 0, wins = 0;
  let gamesCounted = 0;

  for (const matchDetail of matchDetails) {
    if (!matchDetail) continue;
    const stats = extractPlayerStats(matchDetail, puuid);
    sumKills += stats.kills;
    sumDeaths += stats.deaths;
    sumAssists += stats.assists;
    sumHeadshots += stats.headshots;
    sumBodyshots += stats.bodyshots;
    sumLegshots += stats.legshots;
    sumAcs += stats.acs;
    sumAdr += stats.adr;
    if (stats.won) wins++;
    gamesCounted++;
  }

  if (gamesCounted === 0) {
    return {
      kills: 0, deaths: 0, assists: 0, kd: 0,
      headshots: 0, bodyshots: 0, legshots: 0, headshotPercent: 0,
      winrate: 0, acs: 0, adr: 0, recentGamesCount: 0,
    };
  }

  const kd = sumDeaths > 0 ? Math.round((sumKills / sumDeaths) * 100) / 100 : sumKills;
  const totalShots = sumHeadshots + sumBodyshots + sumLegshots;
  const headshotPercent = totalShots > 0 ? Math.round((sumHeadshots / totalShots) * 1000) / 10 : 0;
  const acs = Math.round(sumAcs / gamesCounted);
  const adr = Math.round((sumAdr / gamesCounted) * 10) / 10;
  const winrate = Math.round((wins / gamesCounted) * 1000) / 10;
  const kills = Math.round((sumKills / gamesCounted) * 10) / 10;
  const deaths = Math.round((sumDeaths / gamesCounted) * 10) / 10;
  const assists = Math.round((sumAssists / gamesCounted) * 10) / 10;

  return {
    kills, deaths, assists, kd,
    headshots: sumHeadshots, bodyshots: sumBodyshots, legshots: sumLegshots, headshotPercent,
    winrate, acs, adr, recentGamesCount: gamesCounted,
  };
}

async function buildPlayer(
  puuid: string,
  config: ApiConfig,
  matchPlayerData: any,
  loadouts: any,
  nameData: { GameName?: string; DisplayName?: string; TagLine?: string } | null,
  matchSeasonId: string
): Promise<ValorantPlayer & { _recentMatchIds?: string[] }> {
  const [mmrRaw, compUpdates] = await Promise.all([
    getPlayerMMR(config, puuid).catch((e) => { console.error("[mmr throw]", puuid, e?.message); return null; }),
    getCompetitiveUpdates(config, puuid, RECENT_GAMES_COUNT).catch((e) => { console.error("[comp throw]", puuid, e?.message); return null; }),
  ]);

  const mmrData = mmrRaw?.httpStatus ? null : mmrRaw;
  const latestComp = mmrData?.LatestCompetitiveUpdate;
  const seasonalInfo = mmrData?.QueueSkills?.competitive?.SeasonalInfoBySeasonID ?? {};

  const rank = latestComp?.TierAfterUpdate ?? 0;
  const previousRank = latestComp?.TierBeforeUpdate ?? 0;

  let peakRank = getPeakRank(seasonalInfo);
  if (rank > peakRank) peakRank = rank;

  const recentMatches: any[] = Array.isArray(compUpdates?.Matches) ? compUpdates.Matches : [];

  // The live-match APIs (pregame/core-game) don't actually expose a SeasonID field
  // (contrary to what `matchSeasonId` implies), so it's always empty in practice.
  // The most reliable signal for "current act" we actually have is the season of the
  // player's own most recent competitive match.
  const latestMatchSeasonId: string = recentMatches[0]?.SeasonID || "";
  const currentSeason = latestMatchSeasonId || getCurrentSeasonId(seasonalInfo, matchSeasonId);

  const currentSeasonData = currentSeason ? seasonalInfo[currentSeason] : null;
  const currentSeasonWins = currentSeasonData?.NumberOfWinsWithPlacements ?? currentSeasonData?.NumberOfWins ?? 0;
  const currentSeasonGames = currentSeasonData?.NumberOfGames ?? 0;
  const isCurrentActRank = !!(currentSeason && (currentSeasonWins + currentSeasonGames) > 0);

  // Matches come back newest-first, so take the leading run that shares the same
  // season as the most recent match — once the season changes we've crossed into
  // a previous act and should stop there.
  const currentActMatches: any[] = [];
  for (const m of recentMatches) {
    if (currentSeason && m?.SeasonID !== currentSeason) break;
    currentActMatches.push(m);
  }

  const latestUpdate = currentActMatches[0] ?? recentMatches[0];
  const rr = latestComp?.RankedRatingAfterUpdate ?? latestUpdate?.RankedRatingAfterUpdate ?? 0;
  const earnedRr = latestComp?.RankedRatingEarned ?? latestUpdate?.RankedRatingEarned ?? 0;
  const leaderboardPosition = latestUpdate?.LeaderboardPosition ?? 0;
  const recentMatchIds = currentActMatches.map((m) => m?.MatchID).filter(Boolean) as string[];

  const agentId = matchPlayerData?.CharacterID ?? matchPlayerData?.CharacterSelectionID ?? "";
  const identity = matchPlayerData?.PlayerIdentity ?? {};

  const skin = extractSkin(loadouts, puuid);

  const displayName = nameData?.GameName ?? (nameData as any)?.DisplayName ?? "";
  const tagLine = nameData?.TagLine ?? "";

  return {
    puuid,
    name: displayName,
    tag: tagLine,
    agentId,
    agentName: AGENT_MAP[agentId] ?? "Unknown",
    teamId: matchPlayerData?.TeamID ?? "",
    accountLevel: identity?.AccountLevel ?? 0,
    rank,
    rankName: RANK_MAP[rank] ?? "Unranked",
    peakRank,
    peakRankName: RANK_MAP[peakRank] ?? "Unranked",
    previousRank,
    rr,
    earnedRr,
    leaderboardPosition,
    headshots: 0,
    bodyshots: 0,
    legshots: 0,
    headshotPercent: 0,
    winrate: 0,
    kd: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    acs: 0,
    adr: 0,
    skin,
    currentSeasonWins,
    currentSeasonGames,
    isCurrentActRank,
    recentGamesCount: 0,
    lastMatchKills: 0,
    lastMatchDeaths: 0,
    lastMatchAssists: 0,
    lastMatchKD: 0,
    _recentMatchIds: recentMatchIds,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const forceRefresh = searchParams.get("force") === "1";

  if (forceRefresh) {
    matchCache = null;
  }

  try {
    const lockfile = await readLockfile();
    const config = await getApiConfig(lockfile);

    const [coreGameMatchId, preGameMatchId] = await Promise.all([
      getCoreGamePlayerId(config),
      getPreGamePlayerId(config),
    ]);

    let players: any[] = [];
    let mapId = "";
    let gameMode = "";
    let gameModeId = "";
    let server = "";
    let isRanked = false;
    let resolvedMatchId = "";
    let seasonId = "";
    let loadouts: any = null;
    let resolvedGameState: "PREGAME" | "INGAME" | "MENUS" = "MENUS";

    if (coreGameMatchId) {
      resolvedGameState = "INGAME";
      resolvedMatchId = coreGameMatchId;
      const [coreGame, coreLoadouts] = await Promise.all([
        getCoreGameMatch(config, coreGameMatchId),
        getCoreGameLoadouts(config, coreGameMatchId),
      ]);
      mapId = coreGame?.MapID ?? "";
      gameMode = coreGame?.Mode ?? "";
      gameModeId = coreGame?.QueueID || coreGame?.ModeID || "";
      isRanked = coreGame?.IsRanked ?? gameModeId === "competitive";
      server = coreGame?.GamePodID ?? "";
      seasonId = coreGame?.SeasonID ?? "";
      players = coreGame?.Players ?? [];
      loadouts = coreLoadouts;
    } else if (preGameMatchId) {
      resolvedGameState = "PREGAME";
      resolvedMatchId = preGameMatchId;
      const preGame = await getPreGameMatch(config, preGameMatchId);
      mapId = preGame?.MapID ?? "";
      gameMode = preGame?.Mode ?? "";
      gameModeId = preGame?.QueueID || preGame?.ModeID || "";
      isRanked = preGame?.IsRanked ?? gameModeId === "competitive";
      seasonId = preGame?.SeasonID ?? "";

      const allyPlayers = (preGame?.AllyTeam?.Players ?? []).map((p: any) => ({
    ...p,
    TeamID: p?.TeamID ?? "Blue",
    }));
      const enemyPlayers = (preGame?.EnemyTeam?.Players ?? []).map((p: any) => ({
    ...p,
      TeamID: p?.TeamID ?? "Red",
}));
      players = [...allyPlayers, ...enemyPlayers];
    } else {
      matchCache = null;

      return Response.json({
        gameState: "MENUS",
        players: [],
        match: null,
        party: null,
        selfPuuid: config.puuid,
      });
    }

    const puuids = players
      .map((p: any) => p?.Subject ?? p?.PlayerIdentity?.Subject ?? "")
      .filter(Boolean);

    if (matchCache && matchCache.matchId !== resolvedMatchId) {
      matchCache = null;
      matchDetailCache.clear();
      matchDetailCacheForMatchId = null;
    }

    if (matchCache && matchCache.matchId === resolvedMatchId) {
      let cachedMatch = matchCache.matchInfo;
      if (resolvedGameState === "INGAME") {
        const score = await getSelfPresenceScore(config, lockfile).catch(() => null);
        if (score) {
          cachedMatch = { ...cachedMatch, allyScore: score.allyScore, enemyScore: score.enemyScore };
        }
      }
      return Response.json({
        gameState: matchCache.gameState,
        match: cachedMatch,
        players: matchCache.players,
        selfPuuid: config.puuid,
      });
    }

    const allNames = await getNameFromPuuid(config, puuids).catch(() => []);
    const nameMap = new Map<string, any>();
    if (Array.isArray(allNames)) {
      for (const n of allNames) {
        if (n?.Subject) nameMap.set(n.Subject, n);
      }
    }

    const rawPlayers = await Promise.all(
      players.map((p: any, i: number) => {
        const puuid = puuids[i];
        if (!puuid) return null;
        const nameData = nameMap.get(puuid) ?? null;
        return buildPlayer(puuid, config, p, loadouts, nameData, seasonId)
          .catch(() => null);
      })
    );
    const validPlayers = rawPlayers.filter((p): p is (ValorantPlayer & { _recentMatchIds?: string[] }) => p !== null);

    const uniqueMatchIds = new Set<string>();
    for (const p of validPlayers) {
      for (const mid of p._recentMatchIds ?? []) {
        if (!matchDetailCache.has(mid)) uniqueMatchIds.add(mid);
      }
    }

    const detailResults = await Promise.all(
      [...uniqueMatchIds].map((mid) =>
        getMatchDetails(config, mid)
          .then((detail) => ({ mid, detail }))
          .catch(() => ({ mid, detail: null }))
      )
    );

    // Combine newly fetched details with whatever's already cached before writing back —
    // this avoids losing entries mid-computation if the cache cap gets hit during this batch.
    const detailLookup = new Map<string, any>(matchDetailCache);
    for (const { mid, detail } of detailResults) {
      if (detail) detailLookup.set(mid, detail);
    }
    for (const { mid, detail } of detailResults) {
      if (detail) cacheMatchDetail(mid, detail, resolvedMatchId);
    }

    const builtPlayers: ValorantPlayer[] = validPlayers.map((p) => {
      const { _recentMatchIds, ...player } = p;
      const details = (_recentMatchIds ?? [])
        .map((mid) => detailLookup.get(mid))
        .filter(Boolean);
      const lastMatchStats = details.length > 0 ? extractPlayerStats(details[0], p.puuid) : null;
      const lastMatch = {
        lastMatchKills: lastMatchStats?.kills ?? 0,
        lastMatchDeaths: lastMatchStats?.deaths ?? 0,
        lastMatchAssists: lastMatchStats?.assists ?? 0,
        lastMatchKD: lastMatchStats?.kd ?? 0,
      };
      if (details.length > 0) {
        const stats = aggregatePlayerStats(details, p.puuid);
        return { ...player, ...stats, ...lastMatch };
      }
      return { ...player, ...lastMatch };
    });
    const mapLower = mapId.toLowerCase().replace(/\.[^/]+$/, "");
    const mapName =
      MAP_MAP[mapId] ??
      MAP_MAP[mapLower] ??
      MAP_MAP[mapId.toLowerCase()] ??
      (mapId?.split("/").pop()?.replace(/\.[^.]+$/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())) ??
      "Unknown";

    const queueLower = gameModeId.toLowerCase();
    const modeLower = gameMode.toLowerCase();

    function stripAndExtract(path: string) {
      const stripped = path.replace(/\.[^/]+$/, "");
      const segs = stripped.split("/").filter(Boolean);
      const keyword = segs.length >= 3 ? segs[2] : "";
      return { stripped, keyword };
    }

    const q = stripAndExtract(queueLower);
    const m = stripAndExtract(modeLower);
    const modeKeyword = q.keyword || m.keyword;

    const cleanFallback = modeKeyword
      ? modeKeyword.charAt(0).toUpperCase() + modeKeyword.slice(1).toLowerCase()
      : gameModeId && !gameModeId.includes("/")
        ? gameModeId.charAt(0).toUpperCase() + gameModeId.slice(1).toLowerCase()
        : "Unknown";

    let gameModeName =
      GAMEMODE_MAP[queueLower] ??
      GAMEMODE_MAP[modeLower] ??
      GAMEMODE_MAP[q.stripped] ??
      GAMEMODE_MAP[m.stripped] ??
      GAMEMODE_MAP[q.keyword] ??
      GAMEMODE_MAP[m.keyword] ??
      cleanFallback;

    if (gameModeName === "Standard") {
      gameModeName = isRanked ? "Competitive" : "Unrated";
    }
    const isDeathmatch = DEATHMATCH_MODES.has(queueLower) || DEATHMATCH_MODES.has(modeKeyword);

    let allyScore: number | undefined;
    let enemyScore: number | undefined;
    if (resolvedGameState === "INGAME") {
      const score = await getSelfPresenceScore(config, lockfile).catch(() => null);
      if (score) {
        allyScore = score.allyScore;
        enemyScore = score.enemyScore;
      }
    }

    const matchInfo: MatchInfo = {
      matchId: resolvedMatchId,
      mapId,
      mapName,
      gameMode,
      gameModeId,
      gameModeName,
      isDeathmatch,
      server,
      isRanked,
      gameState: resolvedGameState,
      seasonId,
      allyScore,
      enemyScore,
    };

    matchCache = {
      matchId: resolvedMatchId,
      players: builtPlayers,
      matchInfo,
      gameState: resolvedGameState,
    };

    return Response.json({
      gameState: resolvedGameState,
      match: matchInfo,
      players: builtPlayers,
      selfPuuid: config.puuid,
    });
  } catch (err: any) {
    const message = err?.message ?? String(err);
    if (
      message.includes("ENOENT") ||
      message.includes("lockfile") ||
      message.includes("ECONNREFUSED") ||
      message.includes("not running")
    ) {
      return Response.json({
        error: "Valorant is not running",
        gameState: "OFFLINE",
      });
    }
    return Response.json(
      { error: message, gameState: "ERROR" },
      { status: 500 }
    );
  }
}