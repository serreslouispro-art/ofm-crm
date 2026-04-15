"""
Point d'entrée de l'API REST (Flask).
Lance le serveur : python3 main.py
"""

import asyncio
import threading

from flask import Flask, request, jsonify, abort
from flask_cors import CORS
from database import get_connection, init_db
import crud
from scraper_instagrapi import scrape as run_scrape, ScraperFilters
from sender import send_campaign, DEFAULT_TEMPLATES
from inbox_listener import start_listener, stop_listener, get_status as get_listener_status

app = Flask(__name__)
CORS(app)


# ---------------------------------------------------------------------------
# Routes — comptes_instagram
# ---------------------------------------------------------------------------

@app.get("/comptes")
def get_comptes():
    with get_connection() as conn:
        rows = crud.lister_comptes(conn)
        return jsonify([dict(r) for r in rows])


@app.post("/comptes")
def post_compte():
    data = request.get_json(force=True)
    username = data.get("username", "").strip()
    password = data.get("password", "").strip()
    if not username or not password:
        abort(400, "username et password requis")
    with get_connection() as conn:
        compte_id = crud.ajouter_compte(conn, username, password)
        return jsonify({"id": compte_id}), 201


@app.patch("/comptes/<int:compte_id>/actif")
def patch_compte_actif(compte_id):
    data = request.get_json(force=True)
    actif = bool(data.get("actif", True))
    with get_connection() as conn:
        crud.basculer_actif(conn, compte_id, actif)
        return jsonify({"ok": True})


@app.delete("/comptes/<int:compte_id>")
def delete_compte(compte_id):
    with get_connection() as conn:
        conn.execute("DELETE FROM comptes_instagram WHERE id = ?", (compte_id,))
        conn.commit()
        return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Routes — modeles
# ---------------------------------------------------------------------------

@app.get("/modeles")
def get_modeles():
    statut    = request.args.get("statut")
    compte_id = request.args.get("compte_id", type=int)
    with get_connection() as conn:
        rows = crud.lister_modeles(conn, statut, compte_id)
        return jsonify([dict(r) for r in rows])


@app.get("/modeles/<int:modele_id>")
def get_modele(modele_id):
    with get_connection() as conn:
        row = crud.get_modele(conn, modele_id)
        if not row:
            abort(404, "Modèle introuvable")
        return jsonify(dict(row))


@app.post("/modeles")
def post_modele():
    data = request.get_json(force=True)
    username = data.get("username", "").strip()
    if not username:
        abort(400, "username requis")
    with get_connection() as conn:
        modele_id = crud.ajouter_modele(
            conn,
            username=username,
            followers=data.get("followers", 0),
            bio=data.get("bio", ""),
            lien=data.get("lien", ""),
            statut=data.get("statut", "prospect"),
            compte_utilisé=data.get("compte_utilisé"),
        )
        return jsonify({"id": modele_id}), 201


@app.patch("/modeles/<int:modele_id>/statut")
def patch_statut(modele_id):
    data = request.get_json(force=True)
    statut = data.get("statut", "").strip()
    if not statut:
        abort(400, "statut requis")
    with get_connection() as conn:
        crud.mettre_a_jour_statut(conn, modele_id, statut)
        return jsonify({"ok": True})


@app.delete("/modeles/<int:modele_id>")
def delete_modele(modele_id):
    with get_connection() as conn:
        crud.supprimer_modele(conn, modele_id)
        return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Routes — messages
# ---------------------------------------------------------------------------

@app.get("/modeles/<int:modele_id>/messages")
def get_messages(modele_id):
    with get_connection() as conn:
        crud.marquer_lu(conn, modele_id)
        rows = crud.lister_messages(conn, modele_id)
        return jsonify([dict(r) for r in rows])

@app.get("/modeles/non_lus")
def get_non_lus():
    with get_connection() as conn:
        modeles = crud.lister_modeles(conn)
        result = {m["id"]: crud.compter_non_lus(conn, m["id"]) for m in modeles}
        return jsonify(result)


@app.post("/modeles/<int:modele_id>/messages")
def post_message(modele_id):
    data = request.get_json(force=True)
    contenu = data.get("contenu", "").strip()
    if not contenu:
        abort(400, "contenu requis")
    direction = data.get("direction", "sortant")

    with get_connection() as conn:
        modele = crud.get_modele(conn, modele_id)
    if not modele:
        abort(404, "Modèle introuvable")

    # Sauvegarder en base
    with get_connection() as conn:
        msg_id = crud.ajouter_message(conn, modele_id, contenu, direction)

    ig_sent  = None
    ig_error = None

    # Envoyer sur Instagram si message sortant
    if direction == "sortant":
        compte_id = data.get("compte_id")
        creds = _get_account_credentials(compte_id)
        if creds:
            try:
                from sender import InstagramSender
                s = InstagramSender(creds["username"], creds["password"])
                logged_in = s.login()
                if logged_in:
                    ig_sent = s.send_dm(modele["username"], contenu)
                else:
                    ig_sent  = False
                    ig_error = "Connexion Instagram impossible — relancer save_session.py"
            except Exception as e:
                ig_sent  = False
                ig_error = str(e)
        else:
            ig_sent  = False
            ig_error = "Aucun compte Instagram configuré"

    return jsonify({"id": msg_id, "ig_sent": ig_sent, "ig_error": ig_error}), 201


# ---------------------------------------------------------------------------
# Route — scraper
# ---------------------------------------------------------------------------

# Etat global du scraper (une seule tâche à la fois)
_scrape_state = {"running": False, "log": [], "result": None}


@app.get("/scrape/status")
def scrape_status():
    return jsonify({
        "running": _scrape_state["running"],
        "log":     _scrape_state["log"][-50:],   # 50 dernières lignes
        "result":  _scrape_state["result"],
    })


@app.route("/scrape/start", methods=["GET", "POST"])
def scrape_start():
    if request.method == "GET":
        return jsonify({
            "info": "Utilisez POST pour démarrer un scraping",
            "running": _scrape_state["running"],
        })

    if _scrape_state["running"]:
        abort(409, "Un scraping est déjà en cours")

    data        = request.get_json(force=True)
    account_id  = data.get("account_id")
    if account_id not in (None, "", 0):
        try:
            account_id = int(account_id)
        except (TypeError, ValueError):
            abort(400, f"account_id invalide : {account_id!r}")
    else:
        account_id = None
    target      = (data.get("target") or "").strip().lstrip("@")
    limit        = int(data.get("limit", 50))
    scrape_limit = int(data.get("scrape_limit", 200))
    genre_scrape = data.get("genre", "tous")
    headless    = bool(data.get("headless", False))

    if not target:
        abort(400, "target requis")

    # Charger les credentials depuis la BDD
    with get_connection() as conn:
        comptes = crud.lister_comptes(conn)

    if not comptes:
        abort(400, "Aucun compte Instagram en base")

    if account_id:
        compte = next((c for c in comptes if c["id"] == account_id), None)
        if not compte:
            abort(404, f"Compte id={account_id} introuvable")
    else:
        compte = comptes[0]

    filters = ScraperFilters(
        min_followers=int(data.get("min_followers", 0)),
        max_followers=data.get("max_followers"),
        bio_keywords=data.get("bio_keywords") or [],
        require_external_link=bool(data.get("require_external_link", False)),
    )

    credentials = {"username": compte["username"], "password": compte["password"]}

    def _run():
        _scrape_state["running"] = True
        _scrape_state["log"]     = []
        _scrape_state["result"]  = None

        def log(msg):
            _scrape_state["log"].append(msg)

        try:
            result = asyncio.run(
                run_scrape(
                    credentials=credentials,
                    target=target,
                    filters=filters,
                    account_id=compte["id"],
                    limit=limit,
                    scrape_limit=scrape_limit,
                    genre=genre_scrape,
                    headless=headless,
                    on_progress=log,
                )
            )
            _scrape_state["result"] = result
        except Exception as e:
            _scrape_state["result"] = {"error": str(e)}
        finally:
            _scrape_state["running"] = False

    threading.Thread(target=_run, daemon=True).start()

    return jsonify({
        "ok":      True,
        "message": f"Scraping de @{target} lancé ({limit} profils max)",
        "compte":  compte["username"],
    }), 202


# ---------------------------------------------------------------------------
# Routes — campagne DM
# ---------------------------------------------------------------------------

_campaign_state = {"running": False, "log": [], "result": None}


def _get_account_credentials(account_id):
    """Retourne {"username": ..., "password": ..., "id": ...} ou None."""
    with get_connection() as conn:
        comptes = crud.lister_comptes(conn)
    if not comptes:
        return None
    if account_id:
        try:
            account_id = int(account_id)
        except (TypeError, ValueError):
            return None
        c = next((c for c in comptes if c["id"] == account_id), None)
    else:
        c = comptes[0]
    if not c:
        return None
    return {"username": c["username"], "password": c["password"], "id": c["id"]}


@app.get("/campaign/status")
def campaign_status():
    return jsonify({
        "running": _campaign_state["running"],
        "log":     _campaign_state["log"][-100:],
        "result":  _campaign_state["result"],
    })



@app.post("/campaign/stop")
def campaign_stop():
    global _campaign_state, _scrape_state
    _campaign_state["running"] = False
    _campaign_state["result"]  = {"aborted": True, "abort_reason": "Arrêt manuel"}
    _scrape_state["running"]   = False
    return jsonify({"ok": True})

@app.post("/campaign/start")
def campaign_start():
    if _campaign_state["running"]:
        abort(409, "Une campagne est déjà en cours")

    data        = request.get_json(force=True)
    account_id  = data.get("account_id")
    modele_ids  = data.get("modele_ids") or None        # liste d'IDs ciblés
    templates   = data.get("templates") or None
    dms         = int(data.get("dms_per_day", 50))
    headless    = bool(data.get("headless", True))
    dry_run     = bool(data.get("dry_run", False))

    creds = _get_account_credentials(account_id)
    if not creds:
        abort(400, "Aucun compte Instagram en base")

    def _run():
        from datetime import datetime
        _campaign_state["running"] = True
        _campaign_state["log"]     = []
        _campaign_state["result"]  = None

        def log_cb(msg):
            ts = datetime.now().strftime("%H:%M:%S")
            _campaign_state["log"].append(f"{ts}  {msg}")

        try:
            r = asyncio.run(send_campaign(
                credentials = {"username": creds["username"], "password": creds["password"]},
                account_id  = creds["id"],
                modele_ids  = modele_ids,
                templates   = templates,
                dms_per_day = dms,
                headless    = headless,
                dry_run     = dry_run,
                on_progress = log_cb,
            ))
            _campaign_state["result"] = {
                "total_sent":    r.total_sent,
                "total_failed":  r.total_failed,
                "total_skipped": r.total_skipped,
                "aborted":       r.aborted,
                "abort_reason":  r.abort_reason,
                "sessions":      len(r.sessions),
            }
        except Exception as e:
            _campaign_state["result"] = {"error": str(e)}
        finally:
            _campaign_state["running"] = False

    threading.Thread(target=_run, daemon=True).start()

    return jsonify({
        "ok":      True,
        "message": f"Campagne démarrée — {dms} DMs / 4 sessions",
        "compte":  creds["username"],
        "dry_run": dry_run,
    }), 202




# ---------------------------------------------------------------------------
# Route — campagne automatique (scrape + DM)
# ---------------------------------------------------------------------------

@app.post("/campaign/auto")
def campaign_auto():
    """Lance scrape + DM en séquence pour un compte donné."""
    if _campaign_state["running"] or _scrape_state["running"]:
        abort(409, "Une campagne ou un scraping est déjà en cours")

    data       = request.get_json(force=True)
    account_id = int(data.get("account_id") or data.get("compte_id") or 0)
    target     = (data.get("target") or "").strip().lstrip("@")
    limit        = int(data.get("limit",        50))
    scrape_limit = int(data.get("scrape_limit", 200))
    templates  = data.get("templates") or None
    dms        = int(data.get("dms_per_day", 40))
    delay_s_min = int(data.get("delay_session_min", 45)) * 60
    delay_s_max = int(data.get("delay_session_max", 90)) * 60
    genre       = data.get("genre", "tous")

    if not target:
        abort(400, "target requis")

    with get_connection() as conn:
        comptes = crud.lister_comptes(conn)
    compte = next((c for c in comptes if c["id"] == account_id), None)
    if not compte:
        abort(404, "Compte introuvable")

    credentials = {"username": compte["username"], "password": compte["password"]}
    filters = ScraperFilters()

    def _run():
        _scrape_state["running"] = True
        _scrape_state["log"]     = []
        _scrape_state["result"]  = None
        _campaign_state["running"] = True
        _campaign_state["log"]     = []
        _campaign_state["result"]  = None

        def log(msg):
            _scrape_state["log"].append(msg)
            _campaign_state["log"].append(msg)

        try:
            log(f"[AUTO] Scraping @{target} avec @{compte['username']}…")
            result = run_scrape(
                    credentials=credentials,
                    target=target,
                    filters=filters,
                    account_id=account_id,
                    limit=limit,
                    scrape_limit=scrape_limit,
                    headless=True,
                    on_progress=log,
                )
            _scrape_state["result"] = result
            _scrape_state["running"] = False
            log(f"[AUTO] Scraping terminé — {result.get('added', 0)} profils ajoutés")
            log(f"[AUTO] Lancement des DMs…")

            from datetime import datetime
            def log_dm(msg):
                ts = datetime.now().strftime("%H:%M:%S")
                _campaign_state["log"].append(f"{ts}  {msg}")

            r = asyncio.run(send_campaign(
                credentials=credentials,
                account_id=account_id,
                templates=templates,
                dms_per_day=dms,
                headless=True,
                dry_run=False,
                delay_session=(delay_s_min, delay_s_max),
                genre=genre,
                on_progress=log_dm,
            ))
            _campaign_state["result"] = {
                "total_sent":    r.total_sent,
                "total_failed":  r.total_failed,
                "total_skipped": r.total_skipped,
                "aborted":       r.aborted,
                "abort_reason":  r.abort_reason,
            }
        except Exception as e:
            _campaign_state["result"] = {"error": str(e)}
            _scrape_state["result"]   = {"error": str(e)}
        finally:
            _scrape_state["running"]   = False
            _campaign_state["running"] = False

    threading.Thread(target=_run, daemon=True).start()

    return jsonify({
        "ok":     True,
        "message": f"Campagne auto lancée — scrape @{target} + {dms} DMs",
        "compte": compte["username"],
    }), 202

# ---------------------------------------------------------------------------
# Routes — inbox listener
# ---------------------------------------------------------------------------

@app.get("/inbox/status")
def inbox_status():
    return jsonify(get_listener_status())


@app.post("/inbox/start")
def inbox_start():
    data      = request.get_json(force=True)
    account_id = data.get("account_id")
    headless  = bool(data.get("headless", True))
    interval  = int(data.get("interval", 300))   # 5 min par défaut

    creds = _get_account_credentials(account_id)
    if not creds:
        abort(400, "Aucun compte Instagram en base")

    started = start_listener(
        credentials={"username": creds["username"], "password": creds["password"]},
        headless=headless,
        interval=interval,
    )
    if not started:
        abort(409, "Le listener est déjà en cours d'exécution")

    return jsonify({
        "ok":      True,
        "message": "Listener démarré",
        "compte":  creds["username"],
        "interval": interval,
    }), 202


@app.post("/inbox/stop")
def inbox_stop():
    stopped = stop_listener()
    if not stopped:
        abort(409, "Le listener n'est pas actif")
    return jsonify({"ok": True, "message": "Arrêt demandé"})


# ---------------------------------------------------------------------------


# ── Templates ──────────────────────────────────────────────────────────────────

@app.get("/templates")
def templates_list():
    with get_connection() as conn:
        rows = conn.execute("SELECT * FROM templates ORDER BY id DESC").fetchall()
    return jsonify([dict(r) for r in rows])

@app.post("/templates")
def templates_create():
    data = request.get_json()
    with get_connection() as conn:
        cur = conn.execute(
            "INSERT INTO templates (nom, contenu, actif) VALUES (?,?,1)",
            (data["nom"], data["contenu"])
        )
        conn.commit()
        row = conn.execute("SELECT * FROM templates WHERE id=?", (cur.lastrowid,)).fetchone()
    return jsonify(dict(row)), 201

@app.patch("/templates/<int:tid>")
def templates_update(tid):
    data = request.get_json()
    fields, vals = [], []
    for k in ("nom", "contenu", "actif"):
        if k in data:
            fields.append(f"{k}=?")
            vals.append(data[k])
    vals.append(tid)
    with get_connection() as conn:
        conn.execute(f"UPDATE templates SET {', '.join(fields)} WHERE id=?", vals)
        conn.commit()
        row = conn.execute("SELECT * FROM templates WHERE id=?", (tid,)).fetchone()
    return jsonify(dict(row))

@app.delete("/templates/<int:tid>")
def templates_delete(tid):
    with get_connection() as conn:
        conn.execute("DELETE FROM templates WHERE id=?", (tid,))
        conn.commit()
    return jsonify({"ok": True})

if __name__ == "__main__":
    init_db()
    print("=" * 60)
    print("ROUTES ENREGISTRÉES :")
    for rule in sorted(app.url_map.iter_rules(), key=lambda r: str(r)):
        methods = ",".join(sorted(m for m in rule.methods if m not in {"HEAD", "OPTIONS"}))
        print(f"  [{methods:20}] {rule}")
    print("=" * 60)
    app.run(host='0.0.0.0', debug=False, port=5000)
