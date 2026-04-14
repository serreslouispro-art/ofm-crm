"""
scraper_instagrapi.py — Scraper Instagram via Instagrapi (remplace Playwright)
Plus stable sur VPS, pas besoin de navigateur headless.
"""
import os, random, time, logging
from typing import Optional, Callable
from dataclasses import dataclass
from db import get_connection, init_db
import crud

log = logging.getLogger("scraper_instagrapi")
logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s")

@dataclass
class ScraperFilters:
    min_followers: int = 0
    max_followers: Optional[int] = None
    bio_keywords: list = None
    require_external_link: bool = False

    def __post_init__(self):
        if self.bio_keywords is None:
            self.bio_keywords = []

@dataclass
class ScrapedProfile:
    username: str
    followers: int
    bio: str
    lien: str

def _passes_filters(p: ScrapedProfile, f: ScraperFilters) -> tuple[bool, str]:
    if f.min_followers and p.followers < f.min_followers:
        return False, f"followers trop bas ({p.followers})"
    if f.max_followers and p.followers > f.max_followers:
        return False, f"followers trop élevé ({p.followers})"
    if f.require_external_link and not p.lien:
        return False, "pas de lien externe"
    if f.bio_keywords:
        bio_lower = (p.bio or "").lower()
        if not any(kw.lower() in bio_lower for kw in f.bio_keywords):
            return False, "keywords bio absents"
    return True, ""

def scrape(
    credentials: dict,
    target: str,
    filters: Optional[ScraperFilters] = None,
    account_id: Optional[int] = None,
    limit: int = 50,
    scrape_limit: int = 200,
    genre: str = "tous",
    headless: bool = True,
    on_progress: Optional[Callable[[str], None]] = None,
) -> dict:
    """Point d'entrée principal — utilise Instagrapi."""
    from instagrapi import Client
    from instagrapi.exceptions import LoginRequired, ChallengeRequired

    if filters is None:
        filters = ScraperFilters()

    init_db()
    stats = {"added": 0, "skipped": 0, "filtered_out": 0, "errors": 0}

    cl = Client()
    session_file = f"ig_instagrapi_session_{credentials['username']}.json"

    # Charger session existante
    if os.path.exists(session_file):
        try:
            cl.load_settings(session_file)
            cl.login(credentials["username"], credentials["password"])
            log.info(f"[login] Session chargée — @{credentials['username']}")
        except Exception as e:
            log.warning(f"[login] Session invalide, reconnexion : {e}")
            cl = Client()
            cl.login(credentials["username"], credentials["password"])
    else:
        cl.login(credentials["username"], credentials["password"])

    cl.dump_settings(session_file)
    log.info(f"[login] Connecté en tant que @{credentials['username']}")

    if on_progress:
        on_progress(f"Connecté — @{credentials['username']}")

    # Résoudre le user_id de la cible
    try:
        target_clean = target.lstrip("@")
        target_id = cl.user_id_from_username(target_clean)
        log.info(f"[scraper] Cible : @{target_clean} (id={target_id})")
    except Exception as e:
        log.error(f"[scraper] Impossible de résoudre @{target_clean} : {e}")
        return stats

    if on_progress:
        on_progress(f"Collecte jusqu'à {scrape_limit} abonnés de @{target_clean}…")

    # Récupérer les abonnés
    try:
        followers = cl.user_following(target_id, amount=scrape_limit)
        usernames = list(followers.keys())
        log.info(f"[scraper] {len(usernames)} abonnés collectés")
    except Exception as e:
        log.error(f"[scraper] Erreur collecte abonnés : {e}")
        return stats

    if on_progress:
        on_progress(f"{len(usernames)} abonnés collectés — analyse en cours…")

    # Pré-charger les usernames déjà en base
    conn = get_connection()
    existing_raw = {row["username"] for row in crud.lister_modeles(conn)}
    conn.close()
    existing = existing_raw | {u.lstrip("@") for u in existing_raw}

    total = len(usernames)

    for i, user_id in enumerate(usernames, 1):
        if stats["added"] >= limit:
            log.info(f"[scraper] Limite de {limit} profils atteinte — arrêt")
            break

        try:
            user_info = followers[user_id]
            username = user_info.username
            followers_count = user_info.follower_count or 0
            bio = user_info.biography or ""
            lien = user_info.external_url or ""

            prefix = f"[{i:>3}/{total}] @{username}"

            if on_progress and i % 5 == 0:
                on_progress(f"Analyse {i}/{total} : @{username}")

            # Doublon ?
            if username in existing or f"@{username}" in existing:
                stats["skipped"] += 1
                continue

            profile = ScrapedProfile(username=username, followers=followers_count, bio=bio, lien=lien)

            # Filtres
            ok, reason = _passes_filters(profile, filters)
            if not ok:
                stats["filtered_out"] += 1
                log.debug(f"{prefix} — filtré ({reason})")
                continue

            # Filtre genre IA
            if genre in ("femme", "homme"):
                from sender import _detect_genre
                detected = _detect_genre(username, bio, username)
                if detected != genre and detected != "inconnu":
                    stats["filtered_out"] += 1
                    log.info(f"{prefix} — filtré genre ({detected})")
                    continue

            # Enregistrer
            conn = get_connection()
            crud.ajouter_modele(
                conn,
                username=f"@{username}",
                followers=followers_count,
                bio=bio,
                lien=lien,
                statut="prospect",
                compte_utilisé=account_id,
            )
            conn.close()

            stats["added"] += 1
            followers_fmt = f"{followers_count:,}" if followers_count else "?"
            link_tag = " [lien]" if lien else ""
            log.info(f"{prefix} — AJOUTÉ  {followers_fmt} followers{link_tag}")

            time.sleep(random.uniform(0.1, 0.3))

        except Exception as e:
            stats["errors"] += 1
            log.warning(f"[{i}/{total}] Erreur : {e}")
            continue

    if on_progress:
        on_progress(f"Scraping terminé — {stats['added']} ajoutés, {stats['filtered_out']} filtrés")

    log.info(f"\n{'='*40}\n  Ajoutés      : {stats['added']}\n  Deja en base : {stats['skipped']}\n  Filtrés      : {stats['filtered_out']}\n  Erreurs      : {stats['errors']}\n{'='*40}")

    return stats
