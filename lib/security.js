import crypto from "crypto";
import dns from "dns/promises";
import net from "net";

const DEFAULT_TIMEOUT_MS = 15_000;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export function timingSafeEqualText(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

export function requireApiSecret(req, res, next) {
  const expected = process.env.API_SECRET;
  if (!expected) {
    return res.status(503).json({
      error: "admin API disabled",
      reason: "API_SECRET is not configured",
    });
  }

  const supplied = req.headers["x-api-key"] || "";
  if (!timingSafeEqualText(String(supplied), expected)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

export function requireApprovalSecret(req, res, next) {
  const expected = process.env.APPROVAL_SECRET;
  if (!expected) {
    return res.status(503).json({
      error: "approval API disabled",
      reason: "APPROVAL_SECRET is not configured",
    });
  }

  const supplied = req.headers["x-approval-key"] || "";
  if (!timingSafeEqualText(String(supplied), expected)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

export function isPrivateIp(address) {
  if (!address) return true;
  const family = net.isIP(address);
  if (!family) return true;

  if (family === 4) {
    const octets = address.split(".").map(Number);
    const [a, b] = octets;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }

  const normalized = address.toLowerCase();
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  );
}

function hostnameAllowed(hostname, allowedHosts) {
  if (!allowedHosts?.length) return true;
  const h = hostname.toLowerCase();
  return allowedHosts.some((allowed) => {
    const a = String(allowed).toLowerCase().replace(/^\./, "");
    return h === a || h.endsWith(`.${a}`);
  });
}

export async function assertSafeRemoteUrl(rawUrl, { allowedHosts = [] } = {}) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Invalid remote URL");
  }

  if (url.protocol !== "https:") throw new Error("Remote URL must use HTTPS");
  if (url.username || url.password) throw new Error("Credentialed URLs are not allowed");
  if (!hostnameAllowed(url.hostname, allowedHosts)) throw new Error("Remote host is not allowed");
  if (["localhost", "localhost.localdomain"].includes(url.hostname.toLowerCase())) {
    throw new Error("Localhost URLs are not allowed");
  }

  if (net.isIP(url.hostname)) {
    if (isPrivateIp(url.hostname)) throw new Error("Private-network URLs are not allowed");
  } else {
    const resolved = await dns.lookup(url.hostname, { all: true, verbatim: true });
    if (!resolved.length || resolved.some((r) => isPrivateIp(r.address))) {
      throw new Error("Remote host resolves to a private network");
    }
  }

  return url;
}

export async function fetchWithRetry(url, options = {}, config = {}) {
  const {
    retries = 3,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    allowedHosts = [],
    validateRemote = false,
  } = config;

  if (validateRemote) await assertSafeRemoteUrl(url, { allowedHosts });

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: options.signal || AbortSignal.timeout(timeoutMs),
      });
      if (!RETRYABLE_STATUS.has(response.status) || attempt === retries) return response;
      const retryAfter = Number(response.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter)
        ? retryAfter * 1000
        : Math.min(500 * 2 ** attempt + Math.floor(Math.random() * 250), 8_000);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    } catch (error) {
      lastError = error;
      if (attempt === retries) throw error;
      const waitMs = Math.min(500 * 2 ** attempt + Math.floor(Math.random() * 250), 8_000);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  throw lastError || new Error("Request failed");
}
