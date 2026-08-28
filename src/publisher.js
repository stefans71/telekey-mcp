// Publisher identity — reads the ONE thing the MCP Registry actually proves:
// namespace-verified identity ("is this server published by who it claims?").
//
// It deliberately does NOT infer trust from identity. Per the registry's own
// docs: identity ≠ trustworthiness, and a legitimate publisher can ship bad
// code. So this returns only a status that adjusts prompt friction + default
// budget scale — never a grant.
//
// Fails SAFE: unknown namespace, unreachable registry, or preview-schema drift
// all resolve to "unverified" (the more restrictive bucket).

const REGISTRY = "https://registry.modelcontextprotocol.io";

// A verified namespace looks like io.github.<owner>/* or <reverse-dns>/*
// (e.g. com.google.*). We treat a server whose name is namespace-verified in
// the registry as "verified" IDENTITY — nothing more.
export async function publisherStatus(serverName, { fetchImpl = fetch, timeoutMs = 1500 } = {}) {
  if (!serverName || typeof serverName !== "string") return unverified("no server name");

  // Offline / no-network default: caller may pass a cached map instead.
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetchImpl(
      `${REGISTRY}/v0/servers?search=${encodeURIComponent(serverName)}`,
      { signal: ctrl.signal }
    );
    clearTimeout(t);
    if (!res.ok) return unverified(`registry HTTP ${res.status}`);
    const data = await res.json();
    const match = (data.servers || data.results || []).find(
      (s) => s.name === serverName
    );
    if (!match) return unverified("not found in registry");

    // The registry only lists servers that passed namespace verification, so a
    // match means identity is established. We do NOT read this as "safe".
    return {
      status: "verified",
      identity: match.name,
      note: "namespace-verified identity ONLY — not a trust or safety assertion",
    };
  } catch (e) {
    return unverified(`registry unreachable: ${e.message}`);
  }
}

function unverified(why) {
  return { status: "unverified", identity: null, note: why };
}

// Offline resolver: when the hook can't or shouldn't hit the network, callers
// pass a static allowlist of known-verified names (e.g. pinned at install time).
export function publisherStatusOffline(serverName, verifiedNames = []) {
  return verifiedNames.includes(serverName)
    ? { status: "verified", identity: serverName, note: "pinned at install (offline)" }
    : unverified("not in offline pinned set");
}
