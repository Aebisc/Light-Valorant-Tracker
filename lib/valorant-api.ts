import { readFile } from "node:fs/promises";
import type { LockfileData, ApiConfig } from "./types";

const REGION_CONFIG: Record<string, { pd: string; glz: string; shard: string }> = {
  na: { pd: "https://pd.na.a.pvp.net", glz: "https://glz-na-1.na.a.pvp.net", shard: "na" },
  eu: { pd: "https://pd.eu.a.pvp.net", glz: "https://glz-eu-1.eu.a.pvp.net", shard: "eu" },
  ap: { pd: "https://pd.ap.a.pvp.net", glz: "https://glz-ap-1.ap.a.pvp.net", shard: "ap" },
  kr: { pd: "https://pd.kr.a.pvp.net", glz: "https://glz-kr-1.kr.a.pvp.net", shard: "kr" },
  br: { pd: "https://pd.br.a.pvp.net", glz: "https://glz-br-1.br.a.pvp.net", shard: "br" },
  latam: { pd: "https://pd.latam.a.pvp.net", glz: "https://glz-latam-1.latam.a.pvp.net", shard: "latam" },
};

let tlsRefCount = 0;
let tlsPrev: string | undefined;

async function localFetch(url: string, options: RequestInit = {}, timeoutMs = 8000): Promise<Response> {
  if (tlsRefCount === 0) {
    tlsPrev = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }
  tlsRefCount++;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      return res;
    } finally {
      clearTimeout(timer);
    }
  } finally {
    tlsRefCount--;
    if (tlsRefCount === 0) {
      if (tlsPrev === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = tlsPrev;
    }
  }
}

async function safeJson(res: Response): Promise<any> {
  const text = await res.text();
  if (text.startsWith("<!") || text.startsWith("<html")) {
    console.warn("[safeJson] Received HTML instead of JSON from", res.url);
    return null;
  }
  try {
    const data = JSON.parse(text);
    if (data?.httpStatus && data.httpStatus >= 400) {
      console.warn("[safeJson] Riot error envelope from", res.url, "status:", data.httpStatus);
      return null;
    }
    return data;
  } catch (err) {
    console.warn("[safeJson] JSON parse failure from", res.url, "—", (err as Error)?.message, "body preview:", text.slice(0, 120));
    return null;
  }
}

export async function readLockfile(): Promise<LockfileData> {
  const lockfilePath = `${process.env.LOCALAPPDATA}/Riot Games/Riot Client/Config/lockfile`;
  const content = await readFile(lockfilePath, "utf-8");
  const [name, pid, port, password, protocol] = content.split(":");
  return { name, pid, port, password, protocol };
}

export async function getApiConfig(lockfile: LockfileData): Promise<ApiConfig> {
  const auth = Buffer.from(`riot:${lockfile.password}`).toString("base64");

  const entitlementsRes = await localFetch(
    `https://127.0.0.1:${lockfile.port}/entitlements/v1/token`,
    {
      headers: { Authorization: `Basic ${auth}` },
    }
  );
  const entitlements = await entitlementsRes.json();
  const puuid: string = entitlements.subject ?? "";
  const accessToken: string = entitlements.accessToken ?? "";
  const entitlementsToken: string = entitlements.token ?? "";

  if (!puuid || !accessToken) {
    throw new Error("Valorant is not running or entitlements unavailable");
  }

  const logPath = `${process.env.LOCALAPPDATA}/VALORANT/Saved/Logs/ShooterGame.log`;
  const logContent = await readFile(logPath, "utf-8");

  const glzMatch = logContent.match(/https:\/\/glz-(.+?)-\d+\.\1\.a\.pvp\.net/);
  const region = glzMatch ? glzMatch[1] : "na";

  const versionMatch = logContent.match(/release-(\d+\.\d+-shipping-\d+-\d+)/);
  const version = versionMatch ? versionMatch[1] : "unknown";

  const regionConfig = REGION_CONFIG[region] || REGION_CONFIG.na;

  return {
    pdUrl: regionConfig.pd,
    glzUrl: regionConfig.glz,
    region,
    shard: regionConfig.shard,
    puuid,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-Riot-Entitlements-JWT": entitlementsToken,
      "X-Riot-ClientVersion": `release-${version}`,
      "X-Riot-ClientPlatform": Buffer.from(
        JSON.stringify({
          platformType: "PC",
          platformOS: "Windows",
          platformOSVersion: "10.0.19042.1.256.64bit",
          platformChipset: "Unknown",
        })
      ).toString("base64"),
    },
    version,
  };
}

export async function getSelfPresenceScore(
  config: ApiConfig,
  lockfile: LockfileData
): Promise<{ allyScore: number; enemyScore: number } | null> {
  try {
    const auth = Buffer.from(`riot:${lockfile.password}`).toString("base64");
    const res = await localFetch(
      `https://127.0.0.1:${lockfile.port}/chat/v4/presences`,
      { headers: { Authorization: `Basic ${auth}` } }
    );
    const data = await res.json();
    const presences: Array<{ puuid: string; private: string }> = data.presences || [];
    const self = presences.find((p) => p.puuid === config.puuid);
    if (!self?.private) return null;

    const decoded = JSON.parse(Buffer.from(self.private, "base64").toString("utf-8"));
    const ally = decoded.partyOwnerMatchScoreAllyTeam;
    const enemy = decoded.partyOwnerMatchScoreEnemyTeam;

    if (typeof ally === "number" && typeof enemy === "number") {
      return { allyScore: ally, enemyScore: enemy };
    }
    return null;
  } catch {
    return null;
  }
}

async function remoteFetch(url: string, options: RequestInit = {}, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function getPreGamePlayerId(config: ApiConfig): Promise<string | null> {
  try {
    const res = await remoteFetch(`${config.glzUrl}/pregame/v1/players/${config.puuid}`, {
      headers: config.headers,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.MatchID ?? null;
  } catch {
    return null;
  }
}

export async function getCoreGamePlayerId(config: ApiConfig): Promise<string | null> {
  try {
    const res = await remoteFetch(`${config.glzUrl}/core-game/v1/players/${config.puuid}`, {
      headers: config.headers,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.MatchID ?? null;
  } catch {
    return null;
  }
}

export async function getPreGameMatch(config: ApiConfig, matchId: string): Promise<any> {
  const res = await remoteFetch(`${config.glzUrl}/pregame/v1/matches/${matchId}`, {
    headers: config.headers,
  });
  return safeJson(res);
}

export async function getCoreGameMatch(config: ApiConfig, matchId: string): Promise<any> {
  const res = await remoteFetch(`${config.glzUrl}/core-game/v1/matches/${matchId}`, {
    headers: config.headers,
  });
  return safeJson(res);
}

export async function getPlayerMMR(config: ApiConfig, puuid: string): Promise<any> {
  const res = await remoteFetch(`${config.pdUrl}/mmr/v1/players/${puuid}`, {
    headers: config.headers,
  });
  return safeJson(res);
}

export async function getCompetitiveUpdates(config: ApiConfig, puuid: string, count = 1): Promise<any> {
  const res = await remoteFetch(
    `${config.pdUrl}/mmr/v1/players/${puuid}/competitiveupdates?startIndex=0&endIndex=${count}&queue=competitive`,
    { headers: config.headers }
  );
  return safeJson(res);
}

export async function getMatchDetails(config: ApiConfig, matchId: string): Promise<any> {
  const res = await remoteFetch(`${config.pdUrl}/match-details/v1/matches/${matchId}`, {
    headers: config.headers,
  });
  return safeJson(res);
}

export async function getNameFromPuuid(
  config: ApiConfig,
  puuids: string[]
): Promise<Array<{ Subject: string; GameName: string; TagLine: string }>> {
  const res = await remoteFetch(`${config.pdUrl}/name-service/v2/players`, {
    method: "PUT",
    headers: {
      ...config.headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(puuids),
  });
  return (await safeJson(res)) ?? [];
}