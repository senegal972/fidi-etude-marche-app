// Netlify Function — Autocomplétion d'adresse via BAN
// GET /api/autocomplete?q=...

const BAN_URL = "https://api-adresse.data.gouv.fr/search/";
const TIMEOUT_MS = 5000;

const CORS_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResp(status, body) {
  return {
    statusCode: status,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

async function fetchTimeout(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return jsonResp(200, []);

  const q = ((event.queryStringParameters || {}).q || "").trim();
  if (q.length < 3) return jsonResp(200, []);

  try {
    const url = `${BAN_URL}?q=${encodeURIComponent(q)}&limit=6&autocomplete=1`;
    const r = await fetchTimeout(url, TIMEOUT_MS);
    if (!r.ok) return jsonResp(200, []);
    const data = await r.json();
    const suggestions = (data.features || []).map((f) => ({
      label: f.properties.label,
      postcode: f.properties.postcode || "",
      city: f.properties.city || "",
    }));
    return jsonResp(200, suggestions);
  } catch (e) {
    return jsonResp(200, []);
  }
};
