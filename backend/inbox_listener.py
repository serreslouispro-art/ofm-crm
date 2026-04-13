"""
backend/inbox_listener.py — Listener de DMs Instagram via Playwright

Fonctionnement :
  1. Se connecte à Instagram (réutilise ig_session.json)
  2. Navigue vers /direct/inbox/
  3. Pour chaque modèle connu en base (statut ≠ archivé) :
     - Cherche la conversation correspondante dans l'inbox IG
     - Lit les messages du thread
     - Compare avec les messages déjà en base
     - Sauvegarde les nouveaux messages "entrant"
  4. Attend 5 minutes, recommence

Utilisation CLI :
    python3 inbox_listener.py --headless

Utilisation programmatique (Flask) :
    from inbox_listener import start_listener, stop_listener, get_status
"""

import asyncio
import logging
import re
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional

from playwright.async_api import (
    async_playwright,
    Page,
    TimeoutError as PWTimeout,
)

from database import get_connection, init_db
import crud
from scraper import COOKIES_FILE

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

IG_INBOX_URL   = "https://www.instagram.com/direct/inbox/"
CHECK_INTERVAL = 5 * 60       # secondes entre deux passes
LOG_FILE       = Path(__file__).parent / "inbox_listener.log"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(message)s",
    handlers=[logging.FileHandler(LOG_FILE), logging.StreamHandler()],
)
log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Playwright helper
# ---------------------------------------------------------------------------

class InboxReader:
    """Lit les DMs Instagram et sauvegarde les nouveaux messages entrants."""

    def __init__(self, username: str, password: str, headless: bool = True):
        self.ig_username = username
        self.ig_password = password
        self.headless    = headless
        self._pw         = None
        self._browser    = None
        self._context    = None
        self.page: Optional[Page] = None

    # ------------------------------------------------------------------ lifecycle

    async def __aenter__(self):
        self._pw = await async_playwright().start()
        self._browser = await self._pw.chromium.launch(
            headless=self.headless,
            args=[
                "--no-sandbox",
                "--disable-blink-features=AutomationControlled",
            ],
        )
        self._context = await self._browser.new_context(
            viewport={"width": 1280, "height": 900},
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            locale="fr-FR",
            timezone_id="Europe/Paris",
        )
        await self._context.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
        )
        self.page = await self._context.new_page()
        await self._load_cookies()
        return self

    async def __aexit__(self, *_):
        await self._save_cookies()
        if self._browser:
            await self._browser.close()
        if self._pw:
            await self._pw.stop()

    # ------------------------------------------------------------------ cookies

    async def _load_cookies(self) -> None:
        if COOKIES_FILE.exists():
            import json
            cookies = json.loads(COOKIES_FILE.read_text())
            await self._context.add_cookies(cookies)
            log.info("Session chargée depuis %s", COOKIES_FILE)

    async def _save_cookies(self) -> None:
        import json
        cookies = await self._context.cookies()
        COOKIES_FILE.write_text(json.dumps(cookies, indent=2))

    # ------------------------------------------------------------------ login

    async def _handle_consent(self) -> bool:
        """Accepte la page de consentement cookies Instagram si présente."""
        if "consent" not in self.page.url and "cookie" not in self.page.url.lower():
            return False
        log.info("Page de consentement cookies — acceptation...")
        for label in ["Tout accepter", "Accept All", "Allow all cookies",
                      "Accepter tout", "Allow essential and optional cookies"]:
            try:
                btn = await self.page.wait_for_selector(
                    f'button:has-text("{label}")', timeout=3000
                )
                if btn:
                    await btn.click()
                    await asyncio.sleep(2.5)
                    log.info(f"Consentement accepté via '{label}'")
                    return True
            except Exception:
                pass
        return False

    async def ensure_logged_in(self) -> bool:
        """Vérifie la session ; tente de se connecter si nécessaire."""
        await self.page.goto("https://www.instagram.com/", wait_until="domcontentloaded")
        await asyncio.sleep(2)

        # Gérer la page de consentement cookies
        if "consent" in self.page.url or "cookie" in self.page.url.lower():
            await self._handle_consent()
            await asyncio.sleep(2)
            if "consent" in self.page.url:
                await self.page.goto("https://www.instagram.com/", wait_until="domcontentloaded")
                await asyncio.sleep(2)

        if "login" not in self.page.url and "consent" not in self.page.url and await self.page.query_selector('[aria-label="Home"]'):
            log.info("Session valide (pas besoin de login)")
            return True

        log.info("Session expirée — connexion en cours...")
        await self.page.goto("https://www.instagram.com/accounts/login/", wait_until="domcontentloaded")
        await asyncio.sleep(2)

        try:
            await self.page.fill('input[name="username"]', self.ig_username, timeout=10_000)
            await self.page.fill('input[name="password"]', self.ig_password, timeout=5_000)
            await asyncio.sleep(0.8)
            await self.page.click('button[type="submit"]', timeout=5_000)
            await asyncio.sleep(4)

            if "login" in self.page.url:
                log.error("Echec connexion — mauvais identifiants ?")
                return False

            log.info("Connecté avec succès")
            return True
        except Exception as e:
            log.error("Erreur de connexion : %s", e)
            return False

    # ------------------------------------------------------------------ inbox scan

    async def scan_inbox(self, on_progress: Optional[Callable] = None) -> dict:
        """
        Parcourt les conversations Instagram des modèles connus et enregistre
        les nouveaux messages entrants.

        Retourne {"checked": N, "new_messages": M, "errors": K}
        """
        def emit(msg: str):
            log.info(msg)
            if on_progress:
                on_progress(msg)

        # Charger les modèles connus (hors archivé)
        with get_connection() as conn:
            modeles = crud.lister_modeles(conn)
        modeles = [m for m in modeles if m["statut"] != "archivé"]

        if not modeles:
            emit("Aucun modèle actif en base.")
            return {"checked": 0, "new_messages": 0, "errors": 0}

        emit(f"Scan inbox — {len(modeles)} modèle(s) à vérifier")

        # Ouvrir l'inbox Instagram
        await self.page.goto(IG_INBOX_URL, wait_until="domcontentloaded")
        await asyncio.sleep(3)

        # Fermer éventuelles popups
        for selector in ['button:has-text("Not Now")', 'button:has-text("Plus tard")', '[aria-label="Close"]']:
            try:
                btn = await self.page.query_selector(selector)
                if btn:
                    await btn.click()
                    await asyncio.sleep(1)
            except Exception:
                pass

        stats = {"checked": 0, "new_messages": 0, "errors": 0}

        for modele in modeles:
            username = modele["username"].lstrip("@")
            try:
                new_msgs = await self._read_conversation(username, modele["id"], emit)
                stats["new_messages"] += new_msgs
                stats["checked"] += 1
            except Exception as e:
                emit(f"  Erreur pour @{username} : {e}")
                stats["errors"] += 1

        emit(f"Scan terminé — {stats['new_messages']} nouveau(x) message(s) entrant(s)")
        return stats

    async def _read_conversation(
        self,
        username: str,
        modele_id: int,
        emit: Callable,
    ) -> int:
        """
        Ouvre la conversation avec `username`, lit les messages,
        sauvegarde ceux qui ne sont pas encore en base.
        Retourne le nombre de nouveaux messages sauvegardés.
        """
        # Chercher la conversation dans la liste gauche
        # On essaie d'abord la recherche directe par URL de thread
        # puis le fallback via la liste de conversations
        thread_found = await self._navigate_to_thread(username)
        if not thread_found:
            return 0   # pas de conversation ouverte avec ce modèle

        await asyncio.sleep(2)

        # Lire les messages visibles dans le thread
        messages_in_thread = await self._extract_messages()
        if not messages_in_thread:
            return 0

        # Récupérer les messages entrants déjà en base
        with get_connection() as conn:
            existing = crud.lister_messages(conn, modele_id)

        existing_contents = {
            m["contenu"] for m in existing if m["direction"] == "entrant"
        }

        new_count = 0
        for contenu in messages_in_thread:
            if contenu and contenu not in existing_contents:
                with get_connection() as conn:
                    crud.ajouter_message(conn, modele_id, contenu, direction="entrant")
                existing_contents.add(contenu)
                new_count += 1
                emit(f"  Nouveau message entrant de @{username} : {contenu[:60]}…")

        return new_count

    async def _navigate_to_thread(self, username: str) -> bool:
        """
        Tente de naviguer vers le thread Instagram avec `username`.
        Cherche dans la liste des conversations à gauche.
        Retourne True si trouvé et ouvert.
        """
        # Chercher une conversation dans la sidebar avec ce username
        try:
            # Attendre que la sidebar se charge
            await self.page.wait_for_selector('[role="listbox"], [role="list"]', timeout=8_000)
        except PWTimeout:
            pass

        # Chercher un lien/bouton qui contient le username dans la sidebar DM
        # Instagram affiche les conversations dans une liste à gauche
        selectors_to_try = [
            f'a[href*="/direct/t/"][title="{username}"]',
            f'span:text("{username}")',
        ]

        for sel in selectors_to_try:
            try:
                elem = await self.page.query_selector(sel)
                if elem:
                    # Remonter au lien cliquable si nécessaire
                    link = await elem.evaluate_handle(
                        "el => el.closest('a') || el.closest('[role=\"button\"]') || el"
                    )
                    await link.click()
                    await asyncio.sleep(2)
                    return True
            except Exception:
                continue

        # Fallback : cherche le username dans les threads visibles via texte
        try:
            all_threads = await self.page.query_selector_all('[role="listitem"] a[href*="/direct/t/"]')
            for thread in all_threads:
                text = await thread.inner_text()
                if username.lower() in text.lower():
                    await thread.click()
                    await asyncio.sleep(2)
                    return True
        except Exception:
            pass

        return False

    async def _extract_messages(self) -> list[str]:
        """
        Extrait les messages reçus (entrants) du thread actuellement ouvert.
        Instagram affiche les bulles dans des divs avec aria-label ou rôle particulier.
        """
        try:
            await self.page.wait_for_selector('[role="row"], [role="listitem"]', timeout=8_000)
        except PWTimeout:
            return []

        messages = []

        # Les messages dans un thread IG sont dans des divs avec role="row"
        # On cherche les messages qui NE sont PAS alignés à droite (= entrants)
        try:
            # Approche 1 : divs avec la direction du message via style/class
            rows = await self.page.query_selector_all('[role="row"]')
            for row in rows:
                # Vérifier si ce message est "entrant" (de l'interlocuteur)
                # Les messages reçus ont souvent un avatar à gauche
                has_avatar = await row.query_selector('img[alt*="profile"]')
                if not has_avatar:
                    # Essayer aria-label sur le conteneur
                    aria = await row.get_attribute("aria-label") or ""
                    # Ignorer si c'est un message sortant (sent by us)
                    if "Sent" in aria or "Envoyé" in aria:
                        continue

                # Extraire le texte du message
                txt_el = await row.query_selector('[dir="auto"], p, span[class]')
                if txt_el:
                    txt = (await txt_el.inner_text()).strip()
                    if txt and len(txt) > 1:
                        messages.append(txt)
        except Exception:
            pass

        # Approche 2 (fallback) : chercher les spans dans les bulles
        if not messages:
            try:
                # Cibler les messages reçus (à gauche) — Instagram les met dans des divs
                # sans justify-content: flex-end
                elems = await self.page.query_selector_all(
                    '[data-testid="message-text-content"] span, '
                    '[data-scope="messages_table"] [dir="auto"]'
                )
                for el in elems:
                    txt = (await el.inner_text()).strip()
                    if txt and len(txt) > 1:
                        # Dédupliquer via set en amont (dans _read_conversation)
                        messages.append(txt)
            except Exception:
                pass

        return messages


# ---------------------------------------------------------------------------
# Boucle de fond (threading)
# ---------------------------------------------------------------------------

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
    # Garder max 200 lignes
    if len(_listener_state["log"]) > 200:
        _listener_state["log"] = _listener_state["log"][-200:]


def _listener_loop(credentials: dict, headless: bool, interval: int):
    """Boucle principale du listener (tourne dans un thread daemon)."""
    _listener_state["running"]  = True
    _listener_state["stopping"] = False
    _listener_state["log"]      = []

    async def _async_loop():
        async with InboxReader(
            username=credentials["username"],
            password=credentials["password"],
            headless=headless,
        ) as reader:
            logged_in = await reader.ensure_logged_in()
            if not logged_in:
                _log_cb("Impossible de se connecter à Instagram. Arrêt.")
                return

            while not _listener_state["stopping"]:
                _log_cb("--- Nouvelle passe de vérification des DMs ---")
                try:
                    stats = await reader.scan_inbox(on_progress=_log_cb)
                    _listener_state["last_check"] = datetime.now().isoformat()
                    _listener_state["stats"]      = stats
                except Exception as e:
                    _log_cb(f"Erreur lors du scan : {e}")

                # Attendre l'intervalle en vérifiant l'arrêt
                for _ in range(interval):
                    if _listener_state["stopping"]:
                        break
                    await asyncio.sleep(1)

        _log_cb("Listener arrêté proprement.")

    try:
        asyncio.run(_async_loop())
    except Exception as e:
        _log_cb(f"Erreur fatale listener : {e}")
    finally:
        _listener_state["running"]  = False
        _listener_state["stopping"] = False


def start_listener(credentials: dict, headless: bool = True, interval: int = CHECK_INTERVAL) -> bool:
    """Démarre le listener en arrière-plan. Retourne False si déjà actif."""
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
    """Demande l'arrêt du listener. Retourne False s'il n'est pas actif."""
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


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Listener DMs Instagram")
    parser.add_argument("--headless",  action="store_true", help="Mode headless")
    parser.add_argument("--interval",  type=int, default=CHECK_INTERVAL, help="Intervalle en secondes")
    parser.add_argument("--account-id", type=int, default=None)
    args = parser.parse_args()

    init_db()
    with get_connection() as conn:
        comptes = crud.lister_comptes(conn)

    if not comptes:
        print("Aucun compte Instagram en base. Ajoutez-en un via l'API.")
        exit(1)

    if args.account_id:
        compte = next((c for c in comptes if c["id"] == args.account_id), None)
        if not compte:
            print(f"Compte id={args.account_id} introuvable.")
            exit(1)
    else:
        compte = comptes[0]

    creds = {"username": compte["username"], "password": compte["password"]}
    print(f"Démarrage du listener avec @{creds['username']} (intervalle={args.interval}s)")

    start_listener(creds, headless=args.headless, interval=args.interval)

    try:
        while _listener_state["running"]:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nArrêt demandé...")
        stop_listener()
        time.sleep(3)
