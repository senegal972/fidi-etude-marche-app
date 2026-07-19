// Helper PayPal (REST v2) — OAuth + création/capture de commande.
// Env : PAYPAL_CLIENT_ID, PAYPAL_SECRET, PAYPAL_ENV ("live" ou "sandbox").

const ENV = (process.env.PAYPAL_ENV || "sandbox").toLowerCase();
export const PAYPAL_BASE = ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
export function paypalConfigured() {
  return !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_SECRET);
}
export function paypalClientId() { return process.env.PAYPAL_CLIENT_ID || ""; }
export function paypalEnv() { return ENV; }

let _tok = null; // { token, exp }
export async function token() {
  const now = Date.now();
  if (_tok && _tok.exp > now + 5000) return _tok.token;
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`).toString("base64");
  const r = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const d = await r.json();
  if (!r.ok) { const e = new Error(d.error_description || "PayPal auth échouée"); e.status = 502; throw e; }
  _tok = { token: d.access_token, exp: now + (d.expires_in || 3000) * 1000 };
  return _tok.token;
}

async function ppFetch(path, method, body) {
  const t = await token();
  const r = await fetch(`${PAYPAL_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!r.ok) { const e = new Error(data?.message || `PayPal HTTP ${r.status}`); e.status = r.status; e.paypal = data; throw e; }
  return data;
}

// Crée une commande CAPTURE. montant en euros (nombre). custom = données de suivi.
export async function createOrder({ montant, description, custom }) {
  return ppFetch("/v2/checkout/orders", "POST", {
    intent: "CAPTURE",
    purchase_units: [{
      amount: { currency_code: "EUR", value: Number(montant).toFixed(2) },
      description: String(description || "").slice(0, 127),
      custom_id: String(custom || "").slice(0, 127),
    }],
  });
}

export async function captureOrder(orderId) {
  return ppFetch(`/v2/checkout/orders/${orderId}/capture`, "POST", {});
}
export async function getOrder(orderId) {
  return ppFetch(`/v2/checkout/orders/${orderId}`, "GET");
}
