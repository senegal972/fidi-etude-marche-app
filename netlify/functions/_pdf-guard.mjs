// Garde réseau du rendu PDF : le HTML reçu est fourni par le client, donc Chromium ne doit
// atteindre ni le réseau interne de la fonction ni le disque local.
//
// Limite connue : entre notre résolution DNS et celle de Chromium, un domaine peut changer
// d'adresse (rebinding). JavaScript désactivé et web security active réduisent ce qui peut
// en être tiré, sans l'exclure.

import net from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";

const ALLOWED_LOCAL_SCHEMES = new Set(["data:", "blob:", "about:"]);
const BLOCKED_RESOURCE_TYPES = new Set(["media", "websocket"]);

function isPrivateIPv4(ip) {
  const [a, b, c] = ip.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function ipv6ToBytes(ip) {
  let s = ip.split("%")[0];
  const lastColon = s.lastIndexOf(":");
  if (s.includes(".")) {
    const v4 = s.slice(lastColon + 1).split(".").map(Number);
    s = s.slice(0, lastColon + 1) +
      ((v4[0] << 8) | v4[1]).toString(16) + ":" + ((v4[2] << 8) | v4[3]).toString(16);
  }
  const [head, tail] = s.split("::");
  const groups = (part) => (part ? part.split(":") : []);
  const h = groups(head);
  const t = tail === undefined ? [] : groups(tail);
  const zeros = tail === undefined ? 0 : 8 - h.length - t.length;
  const all = [...h, ...Array(zeros).fill("0"), ...t];
  const bytes = [];
  for (const g of all) {
    const n = parseInt(g, 16);
    bytes.push((n >> 8) & 0xff, n & 0xff);
  }
  return bytes;
}

function isPrivateIPv6(ip) {
  const b = ipv6ToBytes(ip);
  const v4At = (i) => b.slice(i, i + 4).join(".");
  const zerosUntil = (n) => b.slice(0, n).every((x) => x === 0);
  // ::/96 (dont :: et ::1, et les anciennes adresses compatibles IPv4)
  if (zerosUntil(12)) return true;
  // ::ffff:a.b.c.d (IPv4 mappée)
  if (zerosUntil(10) && b[10] === 0xff && b[11] === 0xff) return isPrivateIPv4(v4At(12));
  // 64:ff9b::/96 (NAT64)
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) return isPrivateIPv4(v4At(12));
  // 2002::/16 (6to4)
  if (b[0] === 0x20 && b[1] === 0x02) return isPrivateIPv4(v4At(2));
  // 2001:db8::/32 (documentation)
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true;
  // fc00::/7 (unique locale), fe80::/10 (lien local), ff00::/8 (multicast)
  return (b[0] & 0xfe) === 0xfc || (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) || b[0] === 0xff;
}

export function isPrivateAddress(ip) {
  const family = net.isIP(ip);
  if (family === 4) return isPrivateIPv4(ip);
  if (family === 6) return isPrivateIPv6(ip);
  return true; // ce qui n'est pas une adresse valide n'est jamais autorisé
}

function isInternalHostname(host) {
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    !host.includes(".")
  );
}

async function hostAllowed(host, lookup) {
  if (!host) return false;
  const bare = host.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (net.isIP(bare)) return !isPrivateAddress(bare);
  if (isInternalHostname(bare)) return false;
  const addresses = await lookup(bare, { all: true });
  return addresses.length > 0 && addresses.every((a) => !isPrivateAddress(a.address));
}

// `cache` évite de résoudre plusieurs fois le même hôte au cours d'un rendu.
export async function urlAllowed(rawUrl, { lookup = dnsLookup, cache = new Map() } = {}) {
  let url;
  try { url = new URL(rawUrl); } catch { return false; }
  if (ALLOWED_LOCAL_SCHEMES.has(url.protocol)) return true;
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (!cache.has(url.hostname)) {
    cache.set(url.hostname, hostAllowed(url.hostname, lookup).catch(() => false));
  }
  return cache.get(url.hostname);
}

// À appeler avant page.setContent. Chromium redéclenche « request » à chaque redirection :
// une URL publique qui redirige vers une adresse interne est donc bloquée aussi.
export async function installRequestGuard(page, { lookup = dnsLookup } = {}) {
  const cache = new Map();
  await page.setJavaScriptEnabled(false);
  await page.setRequestInterception(true);
  page.on("request", async (req) => {
    let allowed = false;
    try {
      allowed = !BLOCKED_RESOURCE_TYPES.has(req.resourceType()) &&
        await urlAllowed(req.url(), { lookup, cache });
    } catch { allowed = false; }
    try {
      if (allowed) await req.continue();
      else await req.abort("blockedbyclient");
    } catch { /* requête déjà terminée (page fermée) */ }
  });
}

// JavaScript étant coupé, ni les écouteurs ni setTimeout ne s'exécutent dans la page : une
// promesse d'attente n'y aboutirait jamais. On interroge donc l'état des images depuis Node.
export async function waitForImages(page, timeoutMs = 8000, pollMs = 100) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const done = await page.evaluate(() => Array.from(document.images).every((img) => img.complete));
    if (done) return true;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return false;
}

// @sparticuz/chromium active --disable-web-security, qui rendrait lisibles par la page
// les réponses d'autres origines, dont les adresses internes.
export function hardenedArgs(args) {
  return args.filter((a) => a !== "--disable-web-security");
}
