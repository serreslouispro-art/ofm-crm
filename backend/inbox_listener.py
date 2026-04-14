"""
backend/inbox_listener.py — Listener DMs via Instagrapi (remplace Playwright)
"""

import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Optional, Callable

from instagrapi import Client
from instagrapi.exceptions import LoginRequired, ClientError

from database import get_connection
import crud
from sender import _session_file, IG_COOKIES_FILE
import json

CHECK_INTERVAL = 5 * 60

_listener_state = {
    "running":    False,
    "stopping":   False,
    "log":        [],
    "last_check": None,
    "stats":      None,
}
_listener_thread: Optional[threading.Thread] = None


def _log_cb(msg: str):
    ts = datetime.now().strftime("%H:%M:%S")
    entry = f"{ts}  {msg}"
    _listener_state["log"].append(entry)
    if len(_listener_state["log"]) > 200:
        _listener_state["log"] = _listener_state["log"][-200:]


def _login(username: str, password: str) -> Optional[Client]:
    cl = Client()
    cl.delay_range = [1, 2]

    # 1. Session instagrapi par compte
    sf = _session_file(username)
    if sf.exists():
        try:
            cl.load_settings(sf)
            sid = (cl.cookie_dict or {}).get("sessionid") or cl.sessionid
            if sid:
                cl.login_by_sessionid(sid)
                if cl.username.lower() == username.lower():
                    _log_cb(f"Session OK — @{cl.username}")
                    return cl
        except Exception as e:
            _log_cb(f"Session invalide : {e}")
        cl = Client()
        cl.delay_range = [1, 2]

    # 2. Cookies Playwright
    if IG_COOKIES_FILE.exists():
        try:
            cookies = json.loads(IG_COOKIES_FILE.read_text())
            sid = next((c["value"] for c in cookies if c.get("name") == "sessionid"), None)
            if sid:
                cl.login_by_sessionid(sid)
                if cl.username.lower() == username.lower():
                    cl.dump_settings(_session_file(username))
                    _log_cb(f"Connecté via ig_session.json — @{cl.username}")
                    return cl
        except Exception as e:
            _log_cb(f"Cookies Playwright invalides : {e}")
        cl = Client()
        cl.delay_range = [1, 2]

    # 3. Login password
    try:
        cl.login(username, password)
        cl.dump_settings(_session_file(username))
        _log_cb(f"Login réussi — @{cl.username}")
        return cl
    except Exception as e:
        _log_cb(f"Login échoué : {e}")
        return None


def _scan(cl: Client) -> dict:
    stats = {"checked": 0, "new_messages": 0, "errors": 0}

    with get_connection() as conn:
        modeles = crud.lister_modeles(conn)
    modeles = [m for m in modeles if m["statut"] != "archivé"]

    if not modeles:
        _log_cb("Aucun modèle actif.")
        return stats

    _log_cb(f"Scan {len(modeles)} modèle(s)…")

    try:
        threads = cl.direct_threads(amount=30)
    except Exception as e:
        _log_cb(f"Erreur lecture inbox : {e}")
        return stats

    # Indexer les threads par username
    thread_map = {}
    for t in threads:
        for user in (t.users or []):
            thread_map[user.username.lower()] = t

    for modele in modeles:
        username = modele["username"].lstrip("@").lower()
        thread = thread_map.get(username)
        if not thread:
            continue

        try:
            # Lire les messages du thread
            msgs = cl.direct_messages(thread.id, amount=20)

            with get_connection() as conn:
                existing = crud.lister_messages(conn, modele["id"])

            existing_texts = {m["contenu"] for m in existing if m["direction"] == "entrant"}
            my_user_id = cl.user_id

            new_count = 0
            for msg in msgs:
                # Message entrant = pas envoyé par nous
                if str(msg.user_id) == str(my_user_id):
                    continue
                text = getattr(msg, "text", None) or ""
                if not text or text in existing_texts:
                    continue
                with get_connection() as conn:
                    crud.ajouter_message(conn, modele["id"], text, direction="entrant")
                existing_texts.add(text)
                new_count += 1
                _log_cb(f"  Nouveau msg de @{username} : {text[:60]}")

            stats["new_messages"] += new_count
            stats["checked"] += 1

        except Exception as e:
            _log_cb(f"  Erreur @{username} : {e}")
            stats["errors"] += 1

    _log_cb(f"Scan terminé — {stats['new_messages']} nouveau(x) message(s)")
    return stats


def _listener_loop(credentials: dict, headless: bool, interval: int):
    _listener_state["running"]  = True
    _listener_state["stopping"] = False
    _listener_state["log"]      = []

    cl = _login(credentials["username"], credentials["password"])
    if not cl:
        _log_cb("Connexion impossible. Arrêt.")
        _listener_state["running"] = False
        return

    while not _listener_state["stopping"]:
        _log_cb("--- Nouvelle passe ---")
        try:
            stats = _scan(cl)
            _listener_state["last_check"] = datetime.now().isoformat()
            _listener_state["stats"]      = stats
        except LoginRequired:
            _log_cb("Session expirée — tentative reconnexion…")
            cl = _login(credentials["username"], credentials["password"])
            if not cl:
                _log_cb("Reconnexion impossible. Arrêt.")
                break
        except Exception as e:
            _log_cb(f"Erreur scan : {e}")

        for _ in range(interval):
            if _listener_state["stopping"]:
                break
            time.sleep(1)

    _log_cb("Listener arrêté.")
    _listener_state["running"]  = False
    _listener_state["stopping"] = False


def start_listener(credentials: dict, headless: bool = True, interval: int = CHECK_INTERVAL) -> bool:
    global _listener_thread
    if _listener_state["running"]:
        return False
    _listener_thread = threading.Thread(
        target=_listener_loop,
        args=(credentials, headless, interval),
        daemon=True,
    )
    _listener_thread.start()
    return True


def stop_listener() -> bool:
    if not _listener_state["running"]:
        return False
    _listener_state["stopping"] = True
    return True


def get_status() -> dict:
    return {
        "running":    _listener_state["running"],
        "stopping":   _listener_state["stopping"],
        "log":        _listener_state["log"][-100:],
        "last_check": _listener_state["last_check"],
        "stats":      _listener_state["stats"],
    }
