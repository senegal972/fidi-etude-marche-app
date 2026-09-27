// Netlify Function — Profil territorial de l'avis de valeur.
// GET /api/territoire?insee=97701  ou ?cp=97133
// Renvoie les paramètres par défaut (taux de capi, droits, coûts, DVF dispo…) du territoire.
// HYPOTHÈSES modifiables dans le formulaire — ni notaire ni expert.
import { territoirePourCode, TERRITOIRES } from "./_territoires.mjs";

const CORS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "public, max-age=86400",
};

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "{}" };
  const q = event.queryStringParameters || {};
  if (String(q.all || "") === "1") {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, territoires: TERRITOIRES }) };
  }
  const t = territoirePourCode(q.insee, q.cp);
  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, territoire: t }) };
};
