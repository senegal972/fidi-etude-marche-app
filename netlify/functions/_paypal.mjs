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
  const d = await r.json().catch(() => ({}));
  // Identifiant ou secret refusé par PayPal (invalid_client) : erreur de réglage du site, pas du client qui paie.
  if (!r.ok) { const e = new Error(d.error_description || "PayPal auth échouée"); e.status = 502; e.paypal = { error: d.error || "auth", name: d.error || "auth" }; e.authPaypal = true; throw e; }
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
export async function createOrder({ montant, description, custom, marque }) {
  return ppFetch("/v2/checkout/orders", "POST", {
    intent: "CAPTURE",
    purchase_units: [{
      amount: { currency_code: "EUR", value: Number(montant).toFixed(2) },
      description: String(description || "").slice(0, 127),
      custom_id: String(custom || "").slice(0, 127),
    }],
    // Prestation sans livraison : sans « NO_SHIPPING », le formulaire carte (paiement sans compte PayPal)
    // exige une adresse postale complète ; avec, seul le code postal est demandé (vérifié en bac à sable).
    // « PAY_NOW » : le bouton final dit « Payer » et non « Continuer ». Bloc valable pour le compte PayPal
    // comme pour la carte.
    application_context: {
      shipping_preference: "NO_SHIPPING",
      user_action: "PAY_NOW",
      locale: "fr-FR",
      ...(marque ? { brand_name: String(marque).slice(0, 127) } : {}),
    },
  });
}

// Lecture d'une capture : { ok, statut, capture, pu }. Une commande peut revenir « COMPLETED » alors que
// la capture elle-même est refusée (DECLINED) ou en attente (PENDING) : seul capture.status fait foi.
export function lireCapture(cap) {
  const pu = ((cap && cap.purchase_units) || [])[0] || {};
  const capture = (((pu.payments || {}).captures) || [])[0] || {};
  const statut = capture.status || (cap && cap.status) || "";
  return { ok: !!cap && cap.status === "COMPLETED" && capture.status === "COMPLETED", statut, capture, pu };
}

// Erreur PayPal → { code, message (français, pour le client), restart }.
// restart : le moyen de paiement a été refusé, le client peut en choisir un autre sans tout recommencer.
export function erreurPaypal(e) {
  const d = (e && e.paypal) || {};
  const code = String((d.details && d.details[0] && d.details[0].issue) || d.name || d.error || "");
  const T = {
    INSTRUMENT_DECLINED: "Votre banque ou PayPal a refusé ce moyen de paiement. Choisissez-en un autre (autre carte, ou compte PayPal).",
    PAYER_ACTION_REQUIRED: "Une validation est encore demandée (par exemple la confirmation dans l'application de votre banque). Reprenez le paiement.",
    ORDER_NOT_APPROVED: "Le paiement n'a pas été validé jusqu'au bout. Reprenez le paiement.",
    ORDER_ALREADY_CAPTURED: "Ce paiement a déjà été enregistré. Rechargez la page.",
    PAYEE_ACCOUNT_RESTRICTED: "Le compte d'encaissement ne peut pas recevoir ce paiement pour le moment. Contactez-nous : nous vous proposerons un autre moyen de règlement.",
    PAYEE_ACCOUNT_LOCKED_OR_CLOSED: "Le compte d'encaissement ne peut pas recevoir ce paiement pour le moment. Contactez-nous : nous vous proposerons un autre moyen de règlement.",
    PAYER_ACCOUNT_RESTRICTED: "Votre compte PayPal est limité. Payez par carte bancaire, ou contactez PayPal.",
    PAYER_ACCOUNT_LOCKED_OR_CLOSED: "Votre compte PayPal est bloqué ou fermé. Payez par carte bancaire.",
    PAYER_CANNOT_PAY: "PayPal ne permet pas ce paiement avec ce compte. Payez par carte bancaire ou avec un autre compte.",
    TRANSACTION_REFUSED: "PayPal a refusé cette transaction. Essayez un autre moyen de paiement ou contactez-nous.",
    COMPLIANCE_VIOLATION: "PayPal a refusé cette transaction. Contactez-nous : nous vous proposerons un autre moyen de règlement.",
    TRANSACTION_RECEIVING_LIMIT_EXCEEDED: "Le compte d'encaissement a atteint un plafond. Contactez-nous : nous vous proposerons un autre moyen de règlement.",
    MAX_NUMBER_OF_PAYMENT_ATTEMPTS_EXCEEDED: "Trop de tentatives. Reprenez le paiement depuis le début.",
    invalid_client: "Le paiement en ligne est momentanément indisponible. Contactez-nous.",
  };
  const message = T[code] || "Le paiement n'a pas abouti. Réessayez, changez de moyen de paiement, ou contactez-nous.";
  return { code, message, restart: code === "INSTRUMENT_DECLINED" };
}

// Trace pour le journal des fonctions Netlify : code PayPal et identifiant de débogage, aucune donnée personnelle.
export function journalPaypal(etape, e) {
  const d = (e && e.paypal) || {};
  try {
    console.error("[paypal]", etape, JSON.stringify({
      http: e && e.status, nom: d.name || d.error || "", probleme: (d.details || []).map((x) => x.issue).join(","),
      debug_id: d.debug_id || "", message: String((e && e.message) || "").slice(0, 200),
    }));
  } catch { /* le journal ne doit jamais faire échouer un paiement */ }
}

export async function captureOrder(orderId) {
  return ppFetch(`/v2/checkout/orders/${orderId}/capture`, "POST", {});
}
export async function getOrder(orderId) {
  return ppFetch(`/v2/checkout/orders/${orderId}`, "GET");
}

// Contrôle des réglages : PayPal accepte-t-il l'identifiant et le secret enregistrés ? Ne crée rien, n'encaisse rien.
// → { configure, env, identifiant (abrégé), acces: "ok" | "refuse" | "injoignable", code }
export async function diagnosticPaypal() {
  const id = paypalClientId();
  const base = { configure: paypalConfigured(), env: ENV, identifiant: id ? id.slice(0, 6) + "…" + id.slice(-4) : "",
    secret_longueur: (process.env.PAYPAL_SECRET || "").length,
    espaces: /^\s|\s$/.test(process.env.PAYPAL_CLIENT_ID || "") || /^\s|\s$/.test(process.env.PAYPAL_SECRET || "") };
  if (!base.configure) return { ...base, acces: "absent", code: "" };
  _tok = null;
  try { await token(); return { ...base, acces: "ok", code: "" }; }
  catch (e) { return { ...base, acces: e.authPaypal ? "refuse" : "injoignable", code: (e.paypal && e.paypal.error) || String(e.message || "").slice(0, 80) }; }
}
