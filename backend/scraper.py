"""
backend/scraper.py — Scraper Instagram via Playwright

Fonctionnement :
  1. Se connecte à Instagram (avec gestion de session via cookies)
  2. Ouvre la liste des abonnés d'un compte cible
  3. Scrolle la modale pour charger tous les profils
  4. Visite chaque profil et extrait : followers, bio, lien externe
  5. Applique les filtres définis
  6. Enregistre chaque profil retenu en statut "prospect" dans la BDD

Utilisation CLI :
    python3 scraper.py \\
        --target  nike \\
        --min-followers 5000 --max-followers 500000 \\
        --keywords model creator \\
        --require-link \\
        --limit 100

    # Associer à un compte Instagram spécifique (id dans la BDD) :
    python3 scraper.py --account-id 1 --target nike --limit 50

Utilisation programmatique :
    import asyncio
    from scraper import scrape, ScraperFilters

    stats = asyncio.run(scrape(
        credentials={"username": "mon_ig", "password": "motdepasse"},
        target="nike",
        filters=ScraperFilters(min_followers=10_000, bio_keywords=["model"]),
        limit=50,
    ))
    # → {"added": 8, "skipped": 2, "filtered_out": 35, "errors": 5}
"""

import argparse
import asyncio
import json
import re
import random
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional, Callable

from playwright.async_api import (
    async_playwright,
    Page,
    TimeoutError as PWTimeout,
)

from database import get_connection, init_db
import crud

# ---------------------------------------------------------------------------
# Constantes
# ---------------------------------------------------------------------------

IG_BASE = "https://www.instagram.com"

# Fichier de session — évite de se re-connecter à chaque run
COOKIES_FILE = Path(__file__).parent / "ig_session.json"

# Délais aléatoires (secondes) pour imiter un comportement humain
DELAY_BETWEEN_PROFILES = (3.0, 6.0)   # entre deux visites de profil
DELAY_SCROLL           = (1.5, 2.5)   # entre deux scrolls dans la modale
SCROLL_STEP_PX         = 700          # pixels par scroll (fallback)
MAX_EMPTY_SCROLLS      = 8            # arrête si N scrolls consécutifs ne chargent rien

# Comptes système Instagram à ignorer dans les résultats
EXCLUDED = {
    "instagram", "meta", "facebook", "whatsapp", "threads",
    "instagramforbusiness", "creators",
}


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

@dataclass
class ScraperFilters:
    """Critères de sélection des profils scrapés."""
    min_followers:         int            = 0
    max_followers:         Optional[int]  = None
    bio_keywords:          list[str]      = field(default_factory=list)
    require_external_link: bool           = False


@dataclass
class ScrapedProfile:
    username:  str
    followers: int
    bio:       str
    lien:      str


# ---------------------------------------------------------------------------
# Utilitaires
# ---------------------------------------------------------------------------

async def _delay(lo: float, hi: float) -> None:
    await asyncio.sleep(random.uniform(lo, hi))


def _parse_followers(text: str) -> int:
    """Convertit '45.2K', '1.2M', '1,234', '850' en entier."""
    if not text:
        return 0
    t = text.strip().replace(",", "").replace(" ", "")
    try:
        if t.upper().endswith("M"):
            return int(float(t[:-1]) * 1_000_000)
        if t.upper().endswith("K"):
            return int(float(t[:-1]) * 1_000)
        digits = re.sub(r"[^\d]", "", t)
        return int(digits) if digits else 0
    except (ValueError, TypeError):
        return 0


def _passes_filters(p: ScrapedProfile, f: ScraperFilters) -> tuple[bool, str]:
    """Retourne (True, '') ou (False, raison)."""
    if p.followers < f.min_followers:
        return False, f"{p.followers:,} followers < min {f.min_followers:,}"
    if f.max_followers and p.followers > f.max_followers:
        return False, f"{p.followers:,} followers > max {f.max_followers:,}"
    if f.require_external_link and not p.lien:
        return False, "pas de lien externe"
    if f.bio_keywords:
        bio_lower = p.bio.lower()
        if not any(kw.lower() in bio_lower for kw in f.bio_keywords):
            return False, f"aucun mot-clé [{', '.join(f.bio_keywords)}] dans la bio"
    return True, ""


# ---------------------------------------------------------------------------
# Classe principale
# ---------------------------------------------------------------------------

class InstagramScraper:
    """
    Wrapper autour de Playwright pour scraper Instagram.
    Utilise le context manager async :

        async with InstagramScraper("user", "pass") as s:
            await s.login()
            profiles = await s.scrape_and_save(...)
    """

    def __init__(self, username: str, password: str, headless: bool = False):
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
                "--disable-web-security",
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
        # Masquer la signature Playwright
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

    # ------------------------------------------------------------------ session

    async def _load_cookies(self) -> None:
        if COOKIES_FILE.exists():
            try:
                cookies = json.loads(COOKIES_FILE.read_text())
                await self._context.add_cookies(cookies)
                print("[session] Cookies chargés.")
            except Exception as e:
                print(f"[session] Impossible de charger les cookies : {e}")

    async def _save_cookies(self) -> None:
        if self._context:
            try:
                cookies = await self._context.cookies()
                COOKIES_FILE.write_text(json.dumps(cookies, indent=2))
                print("[session] Cookies sauvegardés.")
            except Exception:
                pass

    async def _dismiss_cookie_banner(self, log=None) -> bool:
        """Ferme la bannière de cookies IG affichée par-dessus n'importe quelle page."""
        labels = [
            "Autoriser tous les cookies",
            "Autoriser les cookies essentiels et facultatifs",
            "Tout autoriser",
            "Tout accepter",
            "Allow all cookies",
            "Allow essential and optional cookies",
            "Accept all",
            "Accept All",
            "Refuser les cookies optionnels",
            "Decline optional cookies",
        ]
        for label in labels:
            try:
                btn = await self.page.wait_for_selector(
                    f'button:has-text("{label}")', timeout=1500
                )
                if btn:
                    await btn.click()
                    if log:
                        log(f"Bannière cookies fermée via '{label}'")
                    await _delay(1, 2)
                    return True
            except PWTimeout:
                pass
        return False

    async def _handle_consent(self) -> bool:
        """Accepte la page de consentement cookies Instagram si présente."""
        if "consent" not in self.page.url and "cookie" not in self.page.url.lower():
            return False
        print("[session] Page de consentement cookies — acceptation...")
        for label in ["Tout accepter", "Accept All", "Allow all cookies",
                      "Accepter tout", "Allow essential and optional cookies"]:
            try:
                btn = await self.page.wait_for_selector(
                    f'button:has-text("{label}")', timeout=3000
                )
                if btn:
                    await btn.click()
                    await _delay(2, 3)
                    print(f"[session] Consentement accepté via '{label}'")
                    return True
            except PWTimeout:
                pass
        print("[session] Page de consentement détectée mais bouton non trouvé")
        return False

    async def _is_logged_in(self) -> bool:
        try:
            await self.page.goto(IG_BASE, wait_until="domcontentloaded", timeout=15000)
            await _delay(1.5, 2.5)
            # Gérer la page de consentement cookies
            if "consent" in self.page.url or "cookie" in self.page.url.lower():
                await self._handle_consent()
                await _delay(1, 2)
            await self._dismiss_cookie_banner()

            if "login" in self.page.url or "consent" in self.page.url:
                return False

            # Vérifie la présence d'un élément réservé aux utilisateurs connectés.
            # Instagram affiche le login wall en modal sans changer l'URL, donc
            # tester l'URL ne suffit pas.
            authed_selectors = [
                f'a[href="/{self.ig_username}/"]',          # lien vers son propre profil
                'svg[aria-label="Accueil"]',
                'svg[aria-label="Home"]',
                'a[href="/direct/inbox/"]',
                'a[href="/explore/"]',
            ]
            for sel in authed_selectors:
                el = await self.page.query_selector(sel)
                if el:
                    return True
            return False
        except Exception:
            return False

    # ------------------------------------------------------------------ login

    async def login(self, on_progress: Optional[Callable[[str], None]] = None) -> bool:
        """
        Tente la connexion. Si une session est déjà valide via les cookies,
        passe directement. Gère les popups post-login et les défis 2FA.
        """
        log = lambda m: (print(f"[login] {m}"), on_progress(f"[login] {m}") if on_progress else None)

        if await self._is_logged_in():
            log(f"Session valide — déjà connecté en tant que @{self.ig_username}.")
            return True

        log(f"Connexion à Instagram avec @{self.ig_username}...")
        await self.page.goto(f"{IG_BASE}/accounts/login/", wait_until="domcontentloaded")
        await _delay(2, 3.5)

        # Accepter la bannière de cookies si présente
        for selector in [
            'button:has-text("Tout accepter")',
            'button:has-text("Accept All")',
            'button:has-text("Allow all cookies")',
        ]:
            try:
                btn = await self.page.wait_for_selector(selector, timeout=2500)
                await btn.click()
                await _delay(0.5, 1)
                break
            except PWTimeout:
                pass

        # Dégager une éventuelle bannière cookies sur la page de login
        await self._dismiss_cookie_banner(log)

        # Trouver le champ username (Instagram varie les sélecteurs)
        username_selectors = [
            'input[name="username"]',
            'input[aria-label="Phone number, username, or email"]',
            'input[aria-label="Téléphone, nom d’utilisateur ou adresse e-mail"]',
            'input[aria-label*="username" i]',
            'input[aria-label*="utilisateur" i]',
            'input[autocomplete="username"]',
            'input[type="text"]',
        ]
        password_selectors = [
            'input[name="password"]',
            'input[aria-label="Password"]',
            'input[aria-label="Mot de passe"]',
            'input[autocomplete="current-password"]',
            'input[type="password"]',
        ]

        username_field = None
        for sel in username_selectors:
            try:
                username_field = await self.page.wait_for_selector(sel, timeout=3000)
                if username_field:
                    log(f"Champ username trouvé via : {sel}")
                    break
            except PWTimeout:
                pass

        if not username_field:
            log("Formulaire de connexion introuvable. Capture pour debug...")
            try:
                debug_dir = Path(__file__).parent / "debug"
                debug_dir.mkdir(exist_ok=True)
                shot = debug_dir / "login_fail.png"
                html = debug_dir / "login_fail.html"
                await self.page.screenshot(path=str(shot), full_page=True)
                html.write_text(await self.page.content(), encoding="utf-8")
                log(f"Screenshot : {shot}")
                log(f"HTML       : {html}")
                log(f"URL actuelle : {self.page.url}")
            except Exception as e:
                log(f"Échec capture debug : {e}")
            return False

        password_field = None
        for sel in password_selectors:
            el = await self.page.query_selector(sel)
            if el:
                password_field = el
                log(f"Champ password trouvé via : {sel}")
                break

        if not password_field:
            log("Champ password introuvable.")
            return False

        log(f"Saisie du username @{self.ig_username}...")
        await username_field.click()
        await username_field.fill(self.ig_username)
        await _delay(0.4, 0.9)
        log("Saisie du mot de passe...")
        await password_field.click()
        await password_field.fill(self.ig_password)
        await _delay(0.6, 1.2)
        log("Soumission du formulaire...")
        # Bouton submit : essayer plusieurs variantes
        for sel in [
            'button[type="submit"]',
            'button:has-text("Log in")',
            'button:has-text("Se connecter")',
            'button:has-text("Connexion")',
        ]:
            btn = await self.page.query_selector(sel)
            if btn:
                await btn.click()
                break
        else:
            await password_field.press("Enter")

        # Laisser Instagram réagir (5s) puis capturer l'état pour debug
        await _delay(5, 6)
        try:
            debug_dir = Path(__file__).parent / "debug"
            debug_dir.mkdir(exist_ok=True)
            shot = debug_dir / "login_after_submit.png"
            html = debug_dir / "login_after_submit.html"
            await self.page.screenshot(path=str(shot), full_page=True)
            html.write_text(await self.page.content(), encoding="utf-8")
            log(f"Capture post-submit : {shot}")
            log(f"URL post-submit     : {self.page.url}")

            # Chercher un message d'erreur visible
            for sel in [
                'div[role="alert"]',
                'p[data-testid="login-error-message"]',
                'div#slfErrorAlert',
                'p[id^="error"]',
            ]:
                el = await self.page.query_selector(sel)
                if el:
                    txt = (await el.text_content() or "").strip()
                    if txt:
                        log(f"Message Instagram : {txt}")
                        break
        except Exception as e:
            log(f"Échec capture post-submit : {e}")

        # Attendre la redirection ou une erreur
        try:
            await self.page.wait_for_url(
                lambda url: "login" not in url or "challenge" in url,
                timeout=20000,
            )
        except PWTimeout:
            log("Timeout après la soumission — identifiants incorrects ou captcha ?")
            return False

        await _delay(2, 3)

        # Défi de sécurité (2FA, vérification par SMS/email)
        if "challenge" in self.page.url or "two_factor" in self.page.url:
            print("\n[login] Instagram demande une vérification de sécurité.")
            print("         Complétez-la dans la fenêtre du navigateur (60 secondes max).\n")
            try:
                await self.page.wait_for_url(
                    lambda url: "challenge" not in url and "two_factor" not in url,
                    timeout=60_000,
                )
                print("[login] Vérification réussie.")
            except PWTimeout:
                print("[login] Délai dépassé — vérification non résolue.")
                return False

        # Fermer les popups post-connexion (enregistrer le mot de passe, notifs…)
        for _ in range(4):
            for label in ["Not Now", "Plus tard", "Ignorer", "Not now", "Skip"]:
                try:
                    btn = await self.page.wait_for_selector(
                        f'button:has-text("{label}")', timeout=2000
                    )
                    await btn.click()
                    await _delay(0.8, 1.5)
                    break
                except PWTimeout:
                    pass

        ok = "login" not in self.page.url
        print(f"[login] {'Connecté avec succès.' if ok else 'Echec de connexion.'}")
        return ok

    # ------------------------------------------------------------------ profil

    async def get_profile(self, username: str) -> Optional[ScrapedProfile]:
        """
        Visite https://instagram.com/{username}/ et extrait :
          - nombre de followers
          - bio
          - lien externe (si présent)
        Retourne None en cas d'erreur (compte privé, banni, etc.).
        """
        try:
            await self.page.goto(
                f"{IG_BASE}/{username}/",
                wait_until="domcontentloaded",
                timeout=20000,
            )
            await _delay(*DELAY_BETWEEN_PROFILES)

            # -- Compte introuvable / banni
            if await self.page.query_selector('h2[data-testid="user-not-found"]'):
                return None
            if "Page Not Found" in (await self.page.title() or ""):
                return None

            # ---- Followers (depuis la balise <meta name="description">) --------
            # Contenu typique : "45,2K Followers, 312 Following, 89 Posts – …"
            followers = 0
            meta = await self.page.get_attribute('meta[name="description"]', "content") or ""
            m = re.search(r"([\d][0-9,\.]*[KkMm]?)\s+Follower", meta, re.I)
            if m:
                followers = _parse_followers(m.group(1))

            # Fallback : chercher le <span> dans le header
            if followers == 0:
                for sel in [
                    f'a[href="/{username}/followers/"] span',
                    f'a[href="/{username}/followers/"] > span > span',
                    'span[title]',   # Instagram parfois met le nombre dans title
                ]:
                    try:
                        el = await self.page.wait_for_selector(sel, timeout=3000)
                        raw = await el.get_attribute("title") or await el.text_content() or ""
                        v = _parse_followers(raw)
                        if v > 0:
                            followers = v
                            break
                    except PWTimeout:
                        pass

            # ---- Bio -----------------------------------------------------------
            bio = ""
            for sel in [
                'h1 ~ div span',
                'header section div > span',
                'header section div[class] span[class]',
                'div[data-testid="user-bio"]',
                'div.-vDIg span',   # ancien sélecteur encore présent sur certains comptes
            ]:
                try:
                    el = await self.page.query_selector(sel)
                    if el:
                        bio = (await el.text_content() or "").strip()
                    if bio:
                        break
                except Exception:
                    pass

            # ---- Lien externe --------------------------------------------------
            lien = ""
            for sel in [
                'a[href*="l.instagram.com/?u="]',           # lien proxifié IG
                'a[rel="me nofollow noopener noreferrer"]',  # lien direct
                'header a[href^="https://linktr.ee"]',
                'header a[href^="https://beacons"]',
                'header a[href^="https://bio.link"]',
                'header a[href^="https://"]',               # tout lien externe dans le header
            ]:
                try:
                    el = await self.page.query_selector(sel)
                    if el:
                        href = await el.get_attribute("href") or ""
                        # Décoder le proxy Instagram (l.instagram.com/?u=URL_ENCODÉE)
                        if "l.instagram.com" in href:
                            decoded = re.search(r"[?&]u=([^&]+)", href)
                            lien = decoded.group(1) if decoded else href
                        else:
                            lien = href
                    if lien and lien.startswith("http"):
                        break
                except Exception:
                    pass

            return ScrapedProfile(
                username=username,
                followers=followers,
                bio=bio,
                lien=lien,
            )

        except PWTimeout:
            print(f"  [profil] Timeout pour @{username}")
            return None
        except Exception as e:
            print(f"  [profil] Erreur pour @{username} : {e}")
            return None

    # ------------------------------------------------------------------ followers list

    async def get_followers_list(
        self,
        target: str,
        limit: int = 100,
        on_progress: Optional[Callable[[str], None]] = None,
    ) -> list[str]:
        """
        Ouvre le profil de `target`, clique sur le compteur d'abonnements,
        scrolle la modale et retourne jusqu'à `limit` usernames.
        """
        log = lambda msg: print(f"[following] {msg}") or (on_progress(msg) if on_progress else None)

        log(f"Chargement du profil @{target}...")
        await self.page.goto(f"{IG_BASE}/{target}/", wait_until="domcontentloaded")
        await _delay(2, 3.5)
        await self._dismiss_cookie_banner(log)

        # Vérifier que le compte est public et accessible
        private_msg = await self.page.query_selector('h2:has-text("This Account is Private")')
        if private_msg:
            log("Ce compte est privé — impossible d'accéder aux abonnements.")
            return []

        # Cliquer sur le lien "X following / abonnements"
        clicked = False
        selectors = [
            f'a[href="/{target}/following/"]',
            f'a[href="/{target}/following"]',
            f'a[href$="/{target}/following/"]',
            f'a[href*="/following"]',
            'a:has-text("following")',
            'a:has-text("abonnements")',
            'a:has-text("Following")',
            'a:has-text("Abonnements")',
            'a:has-text("suivis")',
            'a:has-text("Suivi(e)s")',
        ]
        for sel in selectors:
            try:
                el = await self.page.wait_for_selector(sel, timeout=4000)
                if el:
                    await el.click()
                    clicked = True
                    log(f"Clic réussi via le sélecteur : {sel}")
                    break
            except PWTimeout:
                pass

        if not clicked:
            log("Lien 'following' introuvable. Capture de la page pour debug...")
            try:
                debug_dir = Path(__file__).parent / "debug"
                debug_dir.mkdir(exist_ok=True)
                shot_path = debug_dir / f"no_following_{target}.png"
                html_path = debug_dir / f"no_following_{target}.html"
                await self.page.screenshot(path=str(shot_path), full_page=True)
                html_path.write_text(await self.page.content(), encoding="utf-8")
                log(f"Screenshot : {shot_path}")
                log(f"HTML       : {html_path}")
                log(f"URL actuelle : {self.page.url}")
            except Exception as e:
                log(f"Échec capture debug : {e}")
            return []

        await _delay(2, 3)

        # Attendre l'ouverture de la modale
        try:
            dialog = await self.page.wait_for_selector('[role="dialog"]', timeout=12000)
        except PWTimeout:
            log("La modale des abonnés ne s'est pas ouverte.")
            return []

        log(f"Modale ouverte — collecte jusqu'à {limit} abonnés...")

        collected: set[str] = set()
        empty_scrolls = 0

        while len(collected) < limit:
            # Extraire les liens présents dans la modale
            links = await dialog.query_selector_all('a[href^="/"]')
            before = len(collected)

            for link in links:
                href = (await link.get_attribute("href") or "").strip("/")
                # Garder uniquement les usernames valides (format /username/)
                if (
                    href
                    and "/" not in href          # pas de sous-chemin
                    and "." not in href          # pas de domaine
                    and href not in EXCLUDED
                    and not href.startswith("#")
                    and href.lower() != target.lower()
                ):
                    collected.add(href)
                if len(collected) >= limit:
                    break

            gained = len(collected) - before
            log(f"Collecte : {len(collected)}/{limit} abonnés")

            if gained == 0:
                empty_scrolls += 1
                if empty_scrolls >= MAX_EMPTY_SCROLLS:
                    log(f"Fin de liste atteinte ({len(collected)} abonnés disponibles).")
                    break
            else:
                empty_scrolls = 0

            # Scroller dans la modale pour charger la suite.
            # Instagram rend le [role="dialog"] non-scrollable (overflow:hidden) ;
            # le conteneur scrollable réel est un div/ul enfant. On le détecte en
            # cherchant le premier descendant dont scrollHeight > clientHeight.
            scrolled = await self.page.evaluate("""
                () => {
                    const dialog = document.querySelector('[role="dialog"]');
                    if (!dialog) return false;
                    // Parcourir tous les descendants pour trouver celui qui scrolle
                    const candidates = Array.from(dialog.querySelectorAll('*'));
                    const scroller = candidates.find(
                        el => el.scrollHeight > el.clientHeight + 10
                    );
                    if (scroller) {
                        scroller.scrollTop = scroller.scrollHeight;
                        return true;
                    }
                    // Fallback : scroller le dialog lui-même
                    dialog.scrollTop = dialog.scrollHeight;
                    return false;
                }
            """)

            # Fallback supplémentaire : scrollIntoView sur le dernier élément li
            if not scrolled:
                items = await dialog.query_selector_all("li")
                if items:
                    await items[-1].scroll_into_view_if_needed()

            await _delay(*DELAY_SCROLL)

        result = list(collected)[:limit]
        log(f"{len(result)} abonnés collectés au total.")
        return result

    # ------------------------------------------------------------------ pipeline

    async def scrape_and_save(
        self,
        target: str,
        filters: ScraperFilters,
        account_id: Optional[int],
        limit: int = 50,
        scrape_limit: int = 200,
        genre: str = "tous",
        on_progress: Optional[Callable[[str], None]] = None,
    ) -> dict:
        """
        Pipeline complet :
          get_followers_list (scrape_limit bruts) → get_profile → filtres → genre IA → save to DB (max limit)

        Retourne un dictionnaire de statistiques.
        """
        stats = {"added": 0, "skipped": 0, "filtered_out": 0, "errors": 0}

        usernames = await self.get_followers_list(
            target, limit=scrape_limit, on_progress=on_progress
        )
        if not usernames:
            return stats

        # Pré-charger les usernames déjà en base pour éviter les doublons
        conn = get_connection()
        existing_raw = {row["username"] for row in crud.lister_modeles(conn)}
        conn.close()
        # Normaliser (avec et sans @)
        existing = existing_raw | {u.lstrip("@") for u in existing_raw}

        total = len(usernames)
        print(f"\n[scraper] Analyse de {total} profils...")

        for i, username in enumerate(usernames, 1):
            prefix = f"[{i:>3}/{total}] @{username}"

            if on_progress:
                on_progress(f"Analyse {i}/{total} : @{username}")

            # Doublon ?
            if username in existing or f"@{username}" in existing:
                stats["skipped"] += 1
                print(f"{prefix} — déjà en base, ignoré")
                continue

            # Scraper le profil
            profile = await self.get_profile(username)
            if profile is None:
                stats["errors"] += 1
                print(f"{prefix} — erreur ou compte privé")
                continue

            # Appliquer les filtres
            ok, reason = _passes_filters(profile, filters)
            if not ok:
                stats["filtered_out"] += 1
                print(f"{prefix} — filtré ({reason})")
                continue

            # Filtre genre IA si activé
            if genre in ("femme", "homme"):
                from sender import _detect_genre
                detected = _detect_genre(username, profile.bio or "", username)
                if detected != genre and detected != "inconnu":
                    stats["filtered_out"] += 1
                    print(f"{prefix} — filtré genre ({detected})")
                    continue

            # Stopper si on a atteint la limite souhaitée
            if stats["added"] >= limit:
                print(f"[scraper] Limite de {limit} profils ajoutés atteinte — arrêt")
                break

            # Enregistrer en base
            conn = get_connection()
            crud.ajouter_modele(
                conn,
                username=f"@{username}",
                followers=profile.followers,
                bio=profile.bio,
                lien=profile.lien,
                statut="prospect",
                compte_utilisé=account_id,
            )
            conn.close()

            stats["added"] += 1
            followers_fmt = f"{profile.followers:,}" if profile.followers else "?"
            link_tag = " [lien]" if profile.lien else ""
            print(f"{prefix} — AJOUTÉ  {followers_fmt} followers{link_tag}")

        return stats


# ---------------------------------------------------------------------------
# Fonction publique
# ---------------------------------------------------------------------------

async def scrape(
    credentials: dict,
    target: str,
    filters: Optional[ScraperFilters] = None,
    account_id: Optional[int] = None,
    limit: int = 50,
    scrape_limit: int = 200,
    genre: str = "tous",
    headless: bool = False,
    on_progress: Optional[Callable[[str], None]] = None,
) -> dict:
    """
    Point d'entrée principal du scraper.

    Paramètres :
        credentials  : {"username": "...", "password": "..."}
        target       : @handle du compte Instagram cible (sans le @)
        filters      : instance ScraperFilters — None = aucun filtre
        account_id   : id dans la table comptes_instagram à associer aux prospects
        limit        : nombre max d'abonnés à analyser
        headless     : False (défaut) = fenêtre visible, True = mode invisible
        on_progress  : callback(str) appelé à chaque étape importante

    Retourne :
        {"added": int, "skipped": int, "filtered_out": int, "errors": int}
    """
    if filters is None:
        filters = ScraperFilters()

    init_db()

    async with InstagramScraper(
        username=credentials["username"],
        password=credentials["password"],
        headless=headless,
    ) as scraper:
        if not await scraper.login(on_progress=on_progress):
            raise RuntimeError(
                "Connexion Instagram impossible. Vérifiez vos identifiants."
            )

        result = await scraper.scrape_and_save(
            target=target,
            filters=filters,
            account_id=account_id,
            limit=limit,
            scrape_limit=scrape_limit,
            genre=genre,
            on_progress=on_progress,
        )

    print(f"\n{'='*40}")
    print(f"  Ajoutés      : {result['added']}")
    print(f"  Deja en base : {result['skipped']}")
    print(f"  Filtrés      : {result['filtered_out']}")
    print(f"  Erreurs      : {result['errors']}")
    print(f"{'='*40}")
    return result


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _cli_main() -> None:
    parser = argparse.ArgumentParser(
        description="Scraper Instagram → OFM CRM",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Exemples :
  # Scraper les abonnés de @nike avec filtres
  python3 scraper.py --target nike --min-followers 5000 --keywords model creator --limit 100

  # Compte Instagram spécifique (id 1 en BDD), mode headless
  python3 scraper.py --account-id 1 --target nike --limit 50 --headless

  # Filtres stricts
  python3 scraper.py --target nike --min-followers 10000 --max-followers 500000 \\
                     --keywords "onlyfans" "model" "creator" --require-link --limit 200
        """,
    )
    parser.add_argument("--account-id",    type=int,  default=None,
                        help="ID du compte Instagram dans la BDD (défaut : premier compte)")
    parser.add_argument("--target",        required=True,
                        help="Compte Instagram cible à scraper (sans le @)")
    parser.add_argument("--min-followers", type=int,  default=0,
                        help="Nombre minimum de followers (défaut : 0)")
    parser.add_argument("--max-followers", type=int,  default=None,
                        help="Nombre maximum de followers (défaut : illimité)")
    parser.add_argument("--keywords",      nargs="*", default=[],
                        help="Mots-clés dans la bio (logique OU)")
    parser.add_argument("--require-link",  action="store_true",
                        help="Exiger la présence d'un lien externe dans le profil")
    parser.add_argument("--limit",         type=int,  default=100,
                        help="Nombre maximum d'abonnés à analyser (défaut : 100)")
    parser.add_argument("--headless",      action="store_true",
                        help="Mode sans fenêtre (déconseillé au premier lancement)")
    args = parser.parse_args()

    # Charger les credentials depuis la BDD
    conn    = get_connection()
    comptes = crud.lister_comptes(conn)
    conn.close()

    if not comptes:
        print("[erreur] Aucun compte Instagram en base.")
        print("         Ajoutez-en un via POST /comptes ou depuis le frontend.")
        sys.exit(1)

    compte = None
    if args.account_id:
        compte = next((c for c in comptes if c["id"] == args.account_id), None)
        if not compte:
            print(f"[erreur] Compte ID={args.account_id} introuvable en base.")
            sys.exit(1)
    else:
        compte = comptes[0]
        print(f"[info] Utilisation du compte @{compte['username']} (id={compte['id']})")

    filters = ScraperFilters(
        min_followers=args.min_followers,
        max_followers=args.max_followers,
        bio_keywords=args.keywords or [],
        require_external_link=args.require_link,
    )

    print(f"\n[config] Cible      : @{args.target}")
    print(f"[config] Compte     : @{compte['username']}")
    print(f"[config] Limite     : {args.limit} profils")
    print(f"[config] Min follow : {filters.min_followers:,}")
    print(f"[config] Max follow : {filters.max_followers or 'illimité'}")
    print(f"[config] Mots-clés  : {filters.bio_keywords or 'aucun'}")
    print(f"[config] Lien requis: {'oui' if filters.require_external_link else 'non'}")
    print(f"[config] Headless   : {'oui' if args.headless else 'non (fenêtre visible)'}\n")

    asyncio.run(
        scrape(
            credentials={"username": compte["username"], "password": compte["password"]},
            target=args.target,
            filters=filters,
            account_id=compte["id"],
            limit=args.limit,
            headless=args.headless,
            on_progress=lambda msg: print(f"  > {msg}"),
        )
    )


if __name__ == "__main__":
    _cli_main()
