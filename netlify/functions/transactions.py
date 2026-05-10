#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Netlify Function — Transactions DVF individuelles FIDI
POST /api/transactions
Body JSON : { code_insee, lat, lon, postcode, perimetre }
"""

import csv
import io
import json
import logging
import math
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

TIMEOUT       = 8
GEO_DVF_BASE  = "https://files.data.gouv.fr/geo-dvf/latest/csv"
GEO_DVF_YEARS = [2021, 2022, 2023, 2024]

RAYON_MAP = {
    "rayon_500m": 0.5, "rayon_1km": 1.0, "rayon_2km": 2.0,
    "rayon_5km": 5.0,  "rayon_10km": 10.0, "rayon_20km": 20.0, "rayon_50km": 50.0,
}


def _resp(status, body):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type",
        },
        "body": json.dumps(body, ensure_ascii=False, default=str),
    }


def _parse_float(val):
    try:
        return float(str(val).replace(",", ".").strip())
    except (ValueError, AttributeError):
        return None


def _dept_folder(code_commune):
    if code_commune[:2] in ("2A", "2B"):
        return code_commune[:2]
    if len(code_commune) >= 3 and code_commune[:2] in ("97", "98"):
        return code_commune[:3]
    return code_commune[:2]


def _haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _extract_section(id_parcelle):
    if not id_parcelle or len(id_parcelle) < 10:
        return ""
    if len(id_parcelle) >= 14:
        return id_parcelle[8:10].strip().upper()
    base = id_parcelle.rstrip("0123456789")
    return base[-2:].strip().upper() if len(base) >= 2 else ""


def _fetch_dvf_csv(code_commune, year):
    dept = _dept_folder(code_commune)
    url  = f"{GEO_DVF_BASE}/{year}/communes/{dept}/{code_commune}.csv"
    try:
        r = requests.get(url, timeout=TIMEOUT)
        if r.status_code == 404:
            return []
        r.raise_for_status()
        r.encoding = "utf-8"
        return list(csv.DictReader(io.StringIO(r.text)))
    except Exception as e:
        logger.warning("geo-dvf %s %s : %s", year, code_commune, e)
        return []


def _get_section_at_point(lat, lon):
    """Interroge apicarto IGN pour la section cadastrale d'un point GPS."""
    try:
        url = "https://apicarto.ign.fr/api/cadastre/parcelle"
        params = {"geom": f'{{"type":"Point","coordinates":[{lon},{lat}]}}'}
        r = requests.get(url, params=params, timeout=TIMEOUT)
        r.raise_for_status()
        data = r.json()
        if data and data.get("features"):
            props = data["features"][0].get("properties", {})
            return (props.get("section") or "").strip().upper()
    except Exception as e:
        logger.warning("apicarto IGN : %s", e)
    return ""


def _get_iris_at_point(lat, lon):
    """Récupère le code IRIS d'un point via pyris."""
    try:
        r = requests.get("https://pyris.datajazz.io/api/coords",
                         params={"lat": lat, "lon": lon}, timeout=TIMEOUT)
        r.raise_for_status()
        data = r.json()
        return data.get("complete_code", ""), data.get("name", "")
    except Exception as e:
        logger.warning("pyris : %s", e)
    return "", ""


def get_transactions(code_commune, lat_ref, lon_ref, mode, rayon_km,
                     code_postal_ref, section_ref, iris_ref):
    """Télécharge les CSV DVF en parallèle et filtre selon le mode."""
    all_rows = {}
    with ThreadPoolExecutor(max_workers=4) as ex:
        futures = {ex.submit(_fetch_dvf_csv, code_commune, y): y for y in GEO_DVF_YEARS}
        for fut in as_completed(futures):
            y = futures[fut]
            try:
                all_rows[y] = fut.result(timeout=7)
            except Exception:
                all_rows[y] = []

    transactions = []
    iris_cache   = {}

    for year in sorted(GEO_DVF_YEARS, reverse=True):
        for r in all_rows.get(year, []):
            if r.get("nature_mutation") != "Vente":
                continue

            lat_s = _parse_float(r.get("latitude", ""))
            lon_s = _parse_float(r.get("longitude", ""))
            dist_m = None
            if lat_s is not None and lon_s is not None:
                dist_m = round(_haversine_km(lat_ref, lon_ref, lat_s, lon_s) * 1000)

            # ── Filtre selon mode ──────────────────────────────────────────
            if mode == "rayon":
                if dist_m is None:
                    continue
                if rayon_km > 0 and dist_m > rayon_km * 1000:
                    continue
            elif mode == "code_postal":
                if not code_postal_ref:
                    continue
                if r.get("code_postal", "").strip() != code_postal_ref.strip():
                    continue
            elif mode == "section":
                if not section_ref:
                    continue
                if _extract_section(r.get("id_parcelle", "")) != section_ref.upper():
                    continue
            elif mode == "iris":
                if not iris_ref or lat_s is None or lon_s is None:
                    continue
                key = (round(lat_s, 4), round(lon_s, 4))
                if key not in iris_cache:
                    iris_cache[key] = _get_iris_at_point(lat_s, lon_s)[0]
                if iris_cache[key] != iris_ref:
                    continue
            # mode == "commune" → pas de filtre distance

            val  = _parse_float(r.get("valeur_fonciere", ""))
            surf = _parse_float(r.get("surface_reelle_bati", ""))
            prix_m2 = round(val / surf) if (val and surf and surf >= 5) else None

            num   = r.get("adresse_numero", "").strip()
            suffx = r.get("adresse_suffixe", "").strip()
            voie  = r.get("adresse_nom_voie", "").strip()
            adresse_str = " ".join(p for p in [num, suffx, voie] if p) or "—"

            transactions.append({
                "date":            r.get("date_mutation", "")[:10],
                "adresse":         adresse_str,
                "code_postal":     r.get("code_postal", ""),
                "id_parcelle":     r.get("id_parcelle", ""),
                "section":         _extract_section(r.get("id_parcelle", "")),
                "type_local":      r.get("type_local", "") or r.get("nature_culture", ""),
                "surface_bati":    round(surf) if surf else None,
                "nb_pieces":       r.get("nombre_pieces_principales", "") or None,
                "surface_terrain": round(_parse_float(r.get("surface_terrain", "")) or 0) or None,
                "valeur":          round(val) if val else None,
                "prix_m2":         prix_m2,
                "lat":             lat_s,
                "lon":             lon_s,
                "distance_m":      dist_m,
                "nature_culture":  r.get("nature_culture", ""),
            })

    transactions.sort(key=lambda x: x["date"] or "", reverse=True)
    if mode == "rayon":
        transactions.sort(key=lambda x: x["distance_m"] if x["distance_m"] is not None else 99_999_999)

    return transactions


# ─── Handler Netlify ──────────────────────────────────────────────────────────
def handler(event, context):
    if event.get("httpMethod") == "OPTIONS":
        return _resp(200, {})

    try:
        body = json.loads(event.get("body") or "{}")
    except Exception:
        return _resp(400, {"error": "Corps JSON invalide"})

    code_insee = body.get("code_insee", "").strip()
    lat        = float(body.get("lat") or 0)
    lon        = float(body.get("lon") or 0)
    postcode   = body.get("postcode", "").strip()
    perimetre  = body.get("perimetre", "rayon_1km")

    if not code_insee or not lat or not lon:
        return _resp(400, {"error": "code_insee, lat, lon requis"})

    # Décodage du mode
    if perimetre in RAYON_MAP:
        mode     = "rayon"
        rayon_km = RAYON_MAP[perimetre]
    elif perimetre in ("commune", "code_postal", "section", "iris"):
        mode     = perimetre
        rayon_km = 0.0
    else:
        mode     = "rayon"
        rayon_km = 1.0

    # Résolution section / IRIS si nécessaire
    section_ref = ""
    iris_ref    = ""
    iris_name   = ""
    perimetre_meta = {}

    if mode == "section":
        section_ref = _get_section_at_point(lat, lon)
        perimetre_meta["section"] = section_ref
        perimetre_meta["section_source"] = "apicarto IGN" if section_ref else "indisponible"
        if not section_ref:
            return _resp(422, {
                "error": "Section cadastrale introuvable. Essayez rayon, code postal ou commune."
            })

    if mode == "iris":
        iris_ref, iris_name = _get_iris_at_point(lat, lon)
        perimetre_meta["iris_code"] = iris_ref
        perimetre_meta["iris_name"] = iris_name
        if not iris_ref:
            return _resp(422, {
                "error": "Code IRIS indisponible. Essayez rayon, code postal ou commune."
            })

    code_postal_ref = postcode if mode == "code_postal" else ""
    if mode == "code_postal":
        perimetre_meta["code_postal"] = code_postal_ref

    transactions = get_transactions(
        code_insee, lat, lon, mode, rayon_km,
        code_postal_ref, section_ref, iris_ref,
    )

    return _resp(200, {
        "transactions":   transactions,
        "rayon_km":       rayon_km,
        "perimetre_mode": mode,
        "perimetre_meta": perimetre_meta,
        "count":          len(transactions),
    })
