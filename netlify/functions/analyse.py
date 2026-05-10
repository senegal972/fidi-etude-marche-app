#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Netlify Function — Analyse principale FIDI
POST /api/analyse
Body JSON : { adresse, type_bien, surface, perimetre }
Retourne : localisation, commune_info, dvf, valoris, dpe, risques, score, estimation
Les transactions individuelles sont chargées séparément via /api/transactions.
"""

import csv
import io
import json
import logging
import statistics
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

TIMEOUT       = 7          # par requête externe
GEO_DVF_YEARS = [2022, 2023, 2024]   # 3 ans – équilibre fraîcheur / vitesse

# ─── URLs ─────────────────────────────────────────────────────────────────────
BAN_URL          = "https://api-adresse.data.gouv.fr/search/"
GEO_COMMUNES     = "https://geo.api.gouv.fr/communes"
GEO_DVF_BASE     = "https://files.data.gouv.fr/geo-dvf/latest/csv"
DVF_ANNEES_URL   = ("https://opendata.caissedesdepots.fr/api/explore/v2.1/catalog/datasets"
                    "/donnees-valeurs-foncieres-a-la-commune-annee-par-annee/records")
DVF_PERIODES_URL = ("https://opendata.caissedesdepots.fr/api/explore/v2.1/catalog/datasets"
                    "/donnees-valeurs-foncieres-a-la-commune-par-periode/records")
VALORIS_URL      = "https://www.valoris-immo.fr/api/v1/prix-median"
DPE_URL          = "https://data.ademe.fr/data-fair/api/v1/datasets/dpe-france/lines"
DPE_V2_URL       = "https://data.ademe.fr/data-fair/api/v1/datasets/dpe-v2-logements-existants/lines"
GEORISQUES_URL   = "https://georisques.gouv.fr/api/v1"


# ─── Réponse HTTP ─────────────────────────────────────────────────────────────
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


# ─── Utilitaires ──────────────────────────────────────────────────────────────
def safe_get(url, params=None):
    try:
        r = requests.get(url, params=params, timeout=TIMEOUT)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        logger.warning("safe_get %s : %s", url, e)
        return None


def pick(record, *keys, default=None):
    for k in keys:
        v = record.get(k)
        if v is not None:
            return v
    return default


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


def _prix_m2_liste(transactions):
    result = []
    for t in transactions:
        val  = _parse_float(t.get("valeur_fonciere", ""))
        surf = _parse_float(t.get("surface_reelle_bati", ""))
        if val and surf and surf >= 10 and val >= 5_000:
            result.append(val / surf)
    return result


# ─── Géocodage BAN ────────────────────────────────────────────────────────────
def geocode_adresse(adresse):
    data = safe_get(BAN_URL, params={"q": adresse, "limit": 1})
    if not data or not data.get("features"):
        return None
    feat  = data["features"][0]
    props = feat["properties"]
    lon, lat = feat["geometry"]["coordinates"]
    citycode = props.get("citycode", "")
    dept = citycode[:2]
    if dept in ("97", "98") and len(citycode) >= 3:
        dept = citycode[:3]
    return {
        "label":       props.get("label"),
        "city":        props.get("city"),
        "postcode":    props.get("postcode"),
        "citycode":    citycode,
        "departement": dept,
        "lon":         lon,
        "lat":         lat,
        "score_geo":   round(props.get("score", 0) * 100, 1),
        "context":     props.get("context", ""),
    }


# ─── INSEE – Informations commune ─────────────────────────────────────────────
def get_commune_info(code_insee):
    return safe_get(
        f"{GEO_COMMUNES}/{code_insee}",
        params={"fields": "nom,population,codeRegion,codeDepartement,codesPostaux,superficie,centre"}
    ) or {}


# ─── DVF – CSV geo-dvf (source primaire) ──────────────────────────────────────
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


def get_dvf_data(code_insee):
    """
    Télécharge les CSV DVF des 3 dernières années EN PARALLÈLE.
    Retourne dvf_annees + dvf_periodes en un seul appel réseau optimisé.
    """
    year_rows = {}
    with ThreadPoolExecutor(max_workers=3) as ex:
        futures = {ex.submit(_fetch_dvf_csv, code_insee, y): y for y in GEO_DVF_YEARS}
        for fut in as_completed(futures):
            y = futures[fut]
            try:
                year_rows[y] = fut.result(timeout=6)
            except Exception:
                year_rows[y] = []

    annees        = []
    all_ventes    = []
    all_maisons   = []
    all_apparts   = []
    years_found   = []

    for year in sorted(GEO_DVF_YEARS):
        rows = year_rows.get(year, [])
        if not rows:
            continue
        ventes  = [r for r in rows if r.get("nature_mutation") == "Vente"]
        maisons = [r for r in ventes if r.get("type_local") == "Maison"]
        apparts = [r for r in ventes if r.get("type_local") == "Appartement"]
        pm2_m   = _prix_m2_liste(maisons)
        pm2_a   = _prix_m2_liste(apparts)
        annees.append({
            "annee":          year,
            "nb_maison":      len(maisons),
            "nb_appart":      len(apparts),
            "nb_total":       len(ventes),
            "prix_m2_maison": round(statistics.median(pm2_m)) if pm2_m else None,
            "prix_m2_appart": round(statistics.median(pm2_a)) if pm2_a else None,
        })
        all_ventes  += ventes
        all_maisons += maisons
        all_apparts += apparts
        years_found.append(year)

    if years_found:
        pm2_m = _prix_m2_liste(all_maisons)
        pm2_a = _prix_m2_liste(all_apparts)
        periodes = [{
            "periode":        f"{min(years_found)}–{max(years_found)}",
            "nb_maison":      len(all_maisons),
            "nb_appart":      len(all_apparts),
            "nb_total":       len(all_ventes),
            "prix_m2_maison": round(statistics.median(pm2_m)) if pm2_m else None,
            "prix_m2_appart": round(statistics.median(pm2_a)) if pm2_a else None,
        }]
        return {"dvf_annees": sorted(annees, key=lambda x: x["annee"]),
                "dvf_periodes": periodes}

    # Fallback Caisse des Dépôts (métropole)
    return {
        "dvf_annees":   _dvf_annees_fallback(code_insee),
        "dvf_periodes": _dvf_periodes_fallback(code_insee),
    }


def _dvf_annees_fallback(code_insee):
    data = safe_get(DVF_ANNEES_URL, params={
        "where": f'code_commune="{code_insee}"', "limit": 10, "order_by": "annee asc",
    })
    if not data or "results" not in data:
        return []
    result = []
    for r in data["results"]:
        annee = pick(r, "annee", "year", default=None)
        if annee is None:
            continue
        result.append({
            "annee":          int(annee),
            "nb_maison":      pick(r, "nbre_mutation_maison", "nb_mutations_maison", default=None),
            "nb_appart":      pick(r, "nbre_mutation_appartement", "nb_mutations_appartement", default=None),
            "nb_total":       pick(r, "nbre_mutation_total", "nb_mutations_total", default=None),
            "prix_m2_maison": pick(r, "prix_m2_median_maison", "mediane_prix_m2_maison",
                                   "px_med_m2_maison", default=None),
            "prix_m2_appart": pick(r, "prix_m2_median_appartement",
                                   "mediane_prix_m2_appartement", "px_med_m2_appart", default=None),
        })
    return result


def _dvf_periodes_fallback(code_insee):
    data = safe_get(DVF_PERIODES_URL, params={
        "where": f'code_commune="{code_insee}"', "limit": 5, "order_by": "periode desc",
    })
    if not data or "results" not in data:
        return []
    result = []
    for r in data["results"]:
        result.append({
            "periode":        pick(r, "periode", "libelle_periode", default="—"),
            "nb_maison":      pick(r, "nbre_mutation_maison", "nb_mutations_maison", default=None),
            "nb_appart":      pick(r, "nbre_mutation_appartement", "nb_mutations_appartement", default=None),
            "nb_total":       pick(r, "nbre_mutation_total", "nb_mutations_total", default=None),
            "prix_m2_maison": pick(r, "prix_m2_median_maison", "mediane_prix_m2_maison",
                                   "px_med_m2_maison", default=None),
            "prix_m2_appart": pick(r, "prix_m2_median_appartement",
                                   "mediane_prix_m2_appartement", "px_med_m2_appart", default=None),
        })
    return result


# ─── VALORIS ──────────────────────────────────────────────────────────────────
def get_valoris(code_insee, departement):
    if not departement:
        return {}
    result = {}
    for type_bien in ("maison", "appartement", "tous"):
        data = safe_get(VALORIS_URL, params={
            "dept": departement, "commune": code_insee,
            "type_bien": type_bien, "annee": 2024,
        })
        if not data:
            data = safe_get(VALORIS_URL, params={
                "dept": departement, "commune": code_insee, "type_bien": type_bien,
            })
        if data and data.get("success") is not False:
            result[type_bien] = data
    if not result:
        for type_bien in ("maison", "appartement", "tous"):
            data = safe_get(VALORIS_URL, params={
                "dept": departement, "type_bien": type_bien, "annee": 2023,
            })
            if data and data.get("success") is not False:
                result[type_bien] = data
    return result


# ─── DPE ──────────────────────────────────────────────────────────────────────
def _parse_dpe_lines(lines, label_field):
    dist = {}
    for item in lines:
        label = (item.get(label_field) or "NC").strip().upper()
        if label in ("A", "B", "C", "D", "E", "F", "G"):
            dist[label] = dist.get(label, 0) + 1
    return dist


def get_dpe(commune_name, postcode):
    dist = {}
    data_old = safe_get(DPE_URL, params={
        "size": 1000, "select": "Etiquette_DPE,Code_postal_BAN",
        "q": postcode or commune_name, "q_fields": "Code_postal_BAN",
    })
    if data_old and data_old.get("results"):
        dist = _parse_dpe_lines(data_old["results"], "Etiquette_DPE")
    data_v2 = safe_get(DPE_V2_URL, params={
        "size": 1000, "select": "etiquette_dpe,code_postal_ban",
        "q": postcode or commune_name, "q_fields": "code_postal_ban",
    })
    if data_v2 and data_v2.get("results"):
        d2 = _parse_dpe_lines(data_v2["results"], "etiquette_dpe")
        for k, v in d2.items():
            dist[k] = dist.get(k, 0) + v
    return dist


# ─── Géorisques ───────────────────────────────────────────────────────────────
def get_risques(lat, lon, code_insee):
    risques = {}
    sismo = safe_get(f"{GEORISQUES_URL}/zonage_sismicite", params={"latlon": f"{lat},{lon}"})
    if sismo:
        risques["sismicite"] = sismo
    radon = safe_get(f"{GEORISQUES_URL}/radon", params={"codeInsee": code_insee})
    if radon:
        risques["radon"] = radon
    ppr = safe_get(f"{GEORISQUES_URL}/ppr", params={"latlon": f"{lat},{lon}", "rayon": 1000})
    if ppr:
        risques["ppr"] = ppr
    icpe = safe_get(f"{GEORISQUES_URL}/installations_classees",
                    params={"codeInsee": code_insee, "rayon": 3000})
    if icpe:
        risques["icpe"] = icpe
    return risques


# ─── Score de potentiel (0-100) ───────────────────────────────────────────────
def _note_activite(dvf_periodes, dvf_annees):
    nb = None
    if dvf_periodes:
        nb = dvf_periodes[0].get("nb_total")
    if nb is None and dvf_annees:
        nb = dvf_annees[-1].get("nb_total")
    if nb is None:
        return 10, "Données non disponibles"
    nb = int(nb)
    if nb >= 500: return 20, f"Marché très actif ({nb} transactions)"
    if nb >= 200: return 17, f"Marché actif ({nb} transactions)"
    if nb >= 100: return 14, f"Marché dynamique ({nb} transactions)"
    if nb >= 50:  return 11, f"Marché modéré ({nb} transactions)"
    if nb >= 20:  return 8,  f"Marché peu actif ({nb} transactions)"
    return 4, f"Marché peu liquide ({nb} transactions)"


def _note_tendance(dvf_annees, type_bien):
    field = "prix_m2_maison" if "maison" in type_bien else "prix_m2_appart"
    prices = [(r["annee"], r[field]) for r in dvf_annees if r.get(field)]
    if len(prices) < 2:
        return 10, "Tendance non calculable"
    prices.sort()
    p0, pn = prices[0][1], prices[-1][1]
    if p0 and pn:
        evol = (float(pn) - float(p0)) / float(p0) * 100
        if evol >= 30:  return 20, f"Forte hausse +{evol:.0f}%"
        if evol >= 15:  return 17, f"Hausse significative +{evol:.0f}%"
        if evol >= 5:   return 14, f"Hausse modérée +{evol:.0f}%"
        if evol >= 0:   return 12, f"Prix stables (+{evol:.0f}%)"
        if evol >= -5:  return 9,  f"Légère baisse {evol:.0f}%"
        if evol >= -15: return 6,  f"Baisse des prix {evol:.0f}%"
        return 3, f"Forte baisse {evol:.0f}%"
    return 10, "Tendance non calculable"


def _note_attractivite(commune_info):
    pop = commune_info.get("population", 0) or 0
    if pop >= 200_000: return 20, f"Métropole ({pop:,} hab.)"
    if pop >= 100_000: return 18, f"Grande ville ({pop:,} hab.)"
    if pop >= 50_000:  return 16, f"Ville importante ({pop:,} hab.)"
    if pop >= 20_000:  return 14, f"Ville moyenne ({pop:,} hab.)"
    if pop >= 10_000:  return 12, f"Ville ({pop:,} hab.)"
    if pop >= 5_000:   return 10, f"Bourg ({pop:,} hab.)"
    if pop >= 2_000:   return 8,  f"Village ({pop:,} hab.)"
    if pop > 0:        return 5,  f"Commune rurale ({pop:,} hab.)"
    return 10, "Population non disponible"


def _note_dpe(distribution):
    if not distribution:
        return 10, "Données DPE non disponibles"
    total = sum(distribution.values())
    if total == 0:
        return 10, "Données DPE insuffisantes"
    bons    = sum(distribution.get(l, 0) for l in ("A", "B", "C"))
    mauvais = sum(distribution.get(l, 0) for l in ("F", "G"))
    pct_bon     = bons    / total * 100
    pct_mauvais = mauvais / total * 100
    if pct_bon >= 70:      return 20, f"Excellent parc énergétique ({pct_bon:.0f}% A-C)"
    if pct_bon >= 50:      return 16, f"Bon parc énergétique ({pct_bon:.0f}% A-C)"
    if pct_bon >= 35:      return 13, f"Parc énergétique moyen ({pct_bon:.0f}% A-C)"
    if pct_mauvais >= 50:  return 6,  f"Parc très énergivore ({pct_mauvais:.0f}% F-G)"
    return 10, f"Parc mixte ({pct_bon:.0f}% A-C, {pct_mauvais:.0f}% F-G)"


def _note_risques(risques):
    note = 20
    details = []
    sismo = risques.get("sismicite")
    if sismo:
        zone = None
        if isinstance(sismo, list) and sismo:
            zone = sismo[0].get("zone_sismicite") or sismo[0].get("zone")
        elif isinstance(sismo, dict):
            zone = sismo.get("zone_sismicite") or sismo.get("zone")
        if zone:
            z = str(zone).replace("zone", "").strip()
            if z in ("4", "5"):   note -= 8; details.append(f"Sismicité élevée (zone {z})")
            elif z == "3":        note -= 5; details.append(f"Sismicité modérée (zone {z})")
            elif z in ("1", "2"): note -= 2; details.append(f"Sismicité faible (zone {z})")
    radon = risques.get("radon")
    if radon:
        cat = None
        if isinstance(radon, list) and radon:
            cat = radon[0].get("categorie") or radon[0].get("classe_potentiel")
        elif isinstance(radon, dict):
            cat = radon.get("categorie") or radon.get("classe_potentiel")
        if cat:
            c = str(cat).strip()
            if c == "3":   note -= 4; details.append("Radon élevé (cat. 3)")
            elif c == "2": note -= 2; details.append("Radon modéré (cat. 2)")
    if not details:
        details.append("Aucun risque majeur identifié")
    return max(0, note), " | ".join(details)


def calculate_score(results, type_bien):
    axes = {}
    n, d = _note_activite(results["dvf_periodes"], results["dvf_annees"])
    axes["activite"]    = {"note": n, "max": 20, "label": "Activité du marché",  "detail": d}
    n, d = _note_tendance(results["dvf_annees"], type_bien)
    axes["tendance"]    = {"note": n, "max": 20, "label": "Tendance des prix",   "detail": d}
    n, d = _note_attractivite(results["commune_info"])
    axes["attractivite"]= {"note": n, "max": 20, "label": "Attractivité",        "detail": d}
    n, d = _note_dpe(results["dpe"])
    axes["dpe"]         = {"note": n, "max": 20, "label": "Parc énergétique",    "detail": d}
    n, d = _note_risques(results["risques"])
    axes["risques"]     = {"note": n, "max": 20, "label": "Risques naturels",    "detail": d}
    total = sum(a["note"] for a in axes.values())
    if total >= 80:   verdict, couleur = "Excellent",  "#198754"
    elif total >= 65: verdict, couleur = "Très bon",   "#0d6efd"
    elif total >= 50: verdict, couleur = "Bon",        "#0dcaf0"
    elif total >= 35: verdict, couleur = "Moyen",      "#ffc107"
    else:             verdict, couleur = "Faible",     "#dc3545"
    return {"total": total, "verdict": verdict, "couleur": couleur, "axes": axes}


def estimate_bien(valoris, dvf_annees, dvf_periodes, type_bien, surface):
    prix_m2 = None
    v = valoris.get(type_bien) or valoris.get("tous")
    if v:
        prix_m2 = v.get("prix_median_m2")
    if prix_m2 is None and dvf_annees:
        field = "prix_m2_maison" if "maison" in type_bien else "prix_m2_appart"
        for row in reversed(dvf_annees):
            if row.get(field):
                prix_m2 = float(row[field])
                break
    if prix_m2 is None or surface <= 0:
        return None
    prix_m2 = float(prix_m2)
    valeur  = prix_m2 * surface
    return {
        "prix_m2":    round(prix_m2),
        "surface":    surface,
        "valeur_med": round(valeur / 1000) * 1000,
        "valeur_min": round(valeur * 0.85 / 1000) * 1000,
        "valeur_max": round(valeur * 1.20 / 1000) * 1000,
    }


# ─── Handler Netlify ──────────────────────────────────────────────────────────
def handler(event, context):
    if event.get("httpMethod") == "OPTIONS":
        return _resp(200, {})

    try:
        body = json.loads(event.get("body") or "{}")
    except Exception:
        return _resp(400, {"error": "Corps JSON invalide"})

    adresse   = body.get("adresse", "").strip()
    type_bien = body.get("type_bien", "maison").lower()
    surface   = float(body.get("surface") or 0)

    if not adresse:
        return _resp(400, {"error": "Adresse requise"})

    geo = geocode_adresse(adresse)
    if not geo:
        return _resp(404, {"error": f"Adresse introuvable : « {adresse} »"})

    code_insee  = geo["citycode"]
    departement = geo["departement"]
    lat, lon    = geo["lat"], geo["lon"]

    tasks = {
        "dvf":          (get_dvf_data,      (code_insee,)),
        "commune_info": (get_commune_info,  (code_insee,)),
        "valoris":      (get_valoris,       (code_insee, departement)),
        "dpe":          (get_dpe,           (geo["city"], geo["postcode"])),
        "risques":      (get_risques,       (lat, lon, code_insee)),
    }
    results = {}
    with ThreadPoolExecutor(max_workers=5) as ex:
        futures = {ex.submit(fn, *args): key for key, (fn, args) in tasks.items()}
        for future in as_completed(futures):
            key = futures[future]
            try:
                results[key] = future.result(timeout=8)
            except Exception as e:
                logger.warning("Task %s failed: %s", key, e)
                results[key] = {} if key in ("commune_info", "valoris", "risques", "dvf") else []

    dvf_data   = results.get("dvf") or {}
    dvf_annees = dvf_data.get("dvf_annees", [])
    dvf_per    = dvf_data.get("dvf_periodes", [])

    all_results = {
        "dvf_annees":   dvf_annees,
        "dvf_periodes": dvf_per,
        "commune_info": results.get("commune_info", {}),
        "valoris":      results.get("valoris", {}),
        "dpe":          results.get("dpe", {}),
        "risques":      results.get("risques", {}),
    }

    score      = calculate_score(all_results, type_bien)
    estimation = estimate_bien(all_results["valoris"], dvf_annees, dvf_per, type_bien, surface)

    return _resp(200, {
        "localisation":  geo,
        "commune_info":  all_results["commune_info"],
        "dvf_annees":    dvf_annees,
        "dvf_periodes":  dvf_per,
        "valoris":       all_results["valoris"],
        "dpe":           all_results["dpe"],
        "risques":       all_results["risques"],
        "score":         score,
        "estimation":    estimation,
        "type_bien":     type_bien,
        "surface":       surface,
        "generated_at":  datetime.now().strftime("%d/%m/%Y %H:%M"),
    })
