#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Netlify Function — Autocomplétion d'adresse via BAN
GET /api/autocomplete?q=...
"""

import json
import requests

BAN_URL = "https://api-adresse.data.gouv.fr/search/"
TIMEOUT = 5


def _resp(status, body):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps(body, ensure_ascii=False),
    }


def handler(event, context):
    if event.get("httpMethod") == "OPTIONS":
        return _resp(200, [])

    params = event.get("queryStringParameters") or {}
    q = (params.get("q") or "").strip()

    if len(q) < 3:
        return _resp(200, [])

    try:
        r = requests.get(BAN_URL, params={"q": q, "limit": 6, "autocomplete": 1}, timeout=TIMEOUT)
        r.raise_for_status()
        data = r.json()
    except Exception:
        return _resp(200, [])

    suggestions = [
        {
            "label":    f["properties"]["label"],
            "postcode": f["properties"].get("postcode", ""),
            "city":     f["properties"].get("city", ""),
        }
        for f in data.get("features", [])
    ]
    return _resp(200, suggestions)
