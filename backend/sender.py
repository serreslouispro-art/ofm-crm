"""
backend/sender.py — Envoi automatique de DMs Instagram via instagrapi

Stratégie d'envoi :
  50 DMs/jour par compte, découpés en 4 sessions :
    Session 1  Matin        ≈ 08h-10h   12-13 DMs
    Session 2  Midi         ≈ 12h-14h   12-13 DMs
    Session 3  Après-midi   ≈ 15h-17h   12-13 DMs
    Session 4  Soir         ≈ 19h-21h   12-13 DMs

  Délai inter-DM      : 60-180 s  (aléatoire)
  Délai inter-session : 45-90 min (aléatoire)

Session :
  Sauvegardée dans ig_instagrapi_session.json (réutilisée au redémarrage).

Utilisation CLI :
    python3 sender.py --account-id 1
    python3 sender.py --account-id 1 --dms-per-day 30 --dry-run

Utilisation programmatique :
    import asyncio
    from sender import send_campaign

    asyncio.run(send_campaign(
        credentials={"username": "mon_ig", "password": "motdepasse"},
        templates=["Salut {username}, ..."],
        dms_per_day=50,
    ))
"""

import argparse
import asyncio
import json
import logging
import random
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, Callable

from instagrapi import Client
from instagrapi.exceptions import (
    LoginRequired,
    UserNotFound,
    RateLimitError,
    FeedbackRequired,
    BadPassword,
    ChallengeRequired,
    ClientError,
    DirectError,
)

from database import get_connection
import crud

# Fichier de cookies Playwright (partagé avec scraper / save_session)
IG_COOKIES_FILE = Path(__file__).parent / "ig_session.json"

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# SESSION_FILE est maintenant par compte : ig_instagrapi_session_{username}.json
# L'ancien fichier partagé est conservé en fallback de compatibilité.
SESSION_FILE_LEGACY = Path(__file__).parent / "ig_instagrapi_session.json"
LOG_FILE            = Path(__file__).parent / "sender.log"


def _session_file(username: str) -> Path:
    """Retourne le chemin du fichier de session instagrapi pour un compte donné."""
    return Path(__file__).parent / f"ig_instagrapi_session_{username}.json"

DMS_PER_DAY       = 50
N_SESSIONS        = 4

DELAY_DM_MIN      = 60
DELAY_DM_MAX      = 180

DELAY_SESSION_MIN = 45 * 60   # 45 min
DELAY_SESSION_MAX = 90 * 60   # 90 min

SESSION_WINDOWS = [
    ("Matin",       8, 10),
    ("Midi",       12, 14),
    ("Après-midi", 15, 17),
    ("Soir",       19, 21),
]

DEFAULT_TEMPLATES = [
    "Bonjour {username} ! J'ai découvert ton profil et je pense que notre agence OFM pourrait vraiment t'apporter quelque chose. On gère tout le côté business pour toi. Tu seras intéressée pour qu'on en discute ?",
    "Salut {username} ! Notre équipe OFM recherche des créatrices talentueuses, et ton profil nous a vraiment tapé dans l'œil. On s'occupe de tout : gestion, stratégie, revenu. Ça t'intéresse ?",
    "Hello {username} ! Je travaille pour une agence OFM et ton profil correspond exactement à ce qu'on recherche. Est-ce qu'on peut te présenter comment ça fonctionne ? Sans engagement bien sûr.",
    "Coucou {username} ! On est une agence OFM sérieuse et on cherche à collaborer avec des créatrices comme toi. On maximise tes revenus pendant que tu te concentres sur le contenu. Envie d'en savoir plus ?",
]


# ---------------------------------------------------------------------------
# Logger
# ---------------------------------------------------------------------------

def _setup_logger() -> logging.Logger:
    logger = logging.getLogger("sender")
    if logger.handlers:
        return logger
    logger.setLevel(logging.DEBUG)

    fmt = logging.Formatter(
        "%(asctime)s  %(levelname)-8s  %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    fh = logging.FileHandler(LOG_FILE, encoding="utf-8")
    fh.setFormatter(fmt)
    fh.setLevel(logging.DEBUG)

    ch = logging.StreamHandler(sys.stdout)
    ch.setFormatter(fmt)
    ch.setLevel(logging.INFO)

    logger.addHandler(fh)
    logger.addHandler(ch)
    return logger


log = _setup_logger()


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class SuspiciousActivityError(Exception):
    """Instagram a détecté une activité suspecte — arrêt de la session."""


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

@dataclass
class SessionStats:
    session_num:    int
    label:          str  = ""
    sent:           int  = 0
    failed:         int  = 0
    skipped:        int  = 0
    stopped_reason: str  = ""
    started_at:     datetime = field(default_factory=datetime.now)
    ended_at:       Optional[datetime] = None

    @property
    def duration(self) -> str:
        if not self.ended_at:
            return "en cours"
        delta = self.ended_at - self.started_at
        return f"{int(delta.total_seconds() // 60)}m {int(delta.total_seconds() % 60)}s"


@dataclass
class CampaignResult:
    date:           str  = field(default_factory=lambda: datetime.now().strftime("%Y-%m-%d"))
    total_sent:     int  = 0
    total_failed:   int  = 0
    total_skipped:  int  = 0
    sessions:       list[SessionStats] = field(default_factory=list)
    aborted:        bool = False
    abort_reason:   str  = ""

    def summary(self) -> str:
        lines = [
            f"{'='*50}",
            f"  Campagne du {self.date}",
            f"  DMs envoyés  : {self.total_sent}",
            f"  Echecs       : {self.total_failed}",
            f"  Ignorés      : {self.total_skipped}",
        ]
        if self.aborted:
            lines.append(f"  INTERROMPUE  : {self.abort_reason}")
        for s in self.sessions:
            lines.append(
                f"  Session {s.session_num} ({s.label:12}) — "
                f"envoyés={s.sent}  échecs={s.failed}  durée={s.duration}"
            )
        lines.append("="*50)
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# Utilitaires
# ---------------------------------------------------------------------------

def _distribute(total: int, n: int) -> list[int]:
    """Distribue `total` en `n` groupes équilibrés.
    ex: 50, 4 → [13, 13, 12, 12]"""
    base, rem = divmod(total, n)
    return [base + (1 if i < rem else 0) for i in range(n)]


def _render(template: str, username: str) -> str:
    """Remplace les variables dans un template de message."""
    return template.format(
        username=username.lstrip("@"),
        date=datetime.now().strftime("%d/%m/%Y"),
        heure=datetime.now().strftime("%H:%M"),
    )


def _db_mark_contacted(
    modele_id:  int,
    username:   str,
    message:    str,
    account_id: Optional[int],
) -> None:
    """Passe le modèle en statut 'contacté' et enregistre le message en BDD."""
    conn = get_connection()
    try:
        crud.mettre_a_jour_statut(conn, modele_id, "contacté")
        crud.ajouter_message(conn, modele_id, message, direction="sortant")
        log.debug(f"  BDD : @{username} → statut='contacté', message loggé")
    except Exception as e:
        log.error(f"  BDD erreur pour @{username} : {e}")
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Client instagrapi
# ---------------------------------------------------------------------------

class InstagramSender:
    """Encapsule un client instagrapi avec gestion de session et envoi de DMs."""

    def __init__(self, username: str, password: str):
        self.username = username
        self.password = password
        self.cl       = Client()
        self.dm_count = 0

        # Délais aléatoires pour simuler un comportement humain
        self.cl.delay_range = [1, 3]

    # ── Connexion ─────────────────────────────────────────────────────────────

    def login(self) -> bool:
        """
        Connexion instagrapi pour self.username.

        Stratégie (dans l'ordre) :
        1. Session instagrapi par compte  ig_instagrapi_session_{username}.json
        2. Cookies Playwright             ig_session.json  (sessionid uniquement)
        3. Session legacy partagée        ig_instagrapi_session.json
        4. Login username + password      (via cl.login — fallback final)

        Chaque étape vérifie que le compte connecté correspond bien à self.username.
        Si la session appartient à un autre compte, elle est ignorée.
        """
        per_account_file = _session_file(self.username)

        # ── 1. Session instagrapi par compte ──────────────────────────────────
        if per_account_file.exists():
            log.info(f"[login] Tentative via session par compte : {per_account_file.name}")
            try:
                self.cl.load_settings(per_account_file)
                saved_sid = (self.cl.cookie_dict or {}).get("sessionid") or self.cl.sessionid
                if saved_sid:
                    self.cl.login_by_sessionid(saved_sid)
                    if self.cl.username.lower() == self.username.lower():
                        log.info(f"[login] Session par compte OK — @{self.cl.username}")
                        return True
                    else:
                        log.warning(
                            f"[login] Session appartient à @{self.cl.username}, "
                            f"pas à @{self.username} — ignorée"
                        )
            except Exception as e:
                log.warning(f"[login] Session par compte invalide : {e}")
            self.cl = Client()
            self.cl.delay_range = [1, 3]

        # ── 2. Cookies Playwright ──────────────────────────────────────────────
        session_id = self._sessionid_from_playwright_cookies()
        if session_id:
            log.info("[login] Tentative via ig_session.json (Playwright)…")
            try:
                self.cl.login_by_sessionid(session_id)
                if self.cl.username.lower() == self.username.lower():
                    self.cl.dump_settings(per_account_file)
                    log.info(f"[login] Connecté via Playwright — @{self.cl.username} (session sauvegardée)")
                    return True
                else:
                    log.warning(
                        f"[login] Session Playwright appartient à @{self.cl.username}, "
                        f"pas à @{self.username} — ignorée"
                    )
            except Exception as e:
                log.warning(f"[login] login_by_sessionid (Playwright) échoué : {e}")
            self.cl = Client()
            self.cl.delay_range = [1, 3]

        # ── 3. Session legacy partagée ─────────────────────────────────────────
        if SESSION_FILE_LEGACY.exists():
            log.info(f"[login] Tentative via session legacy : {SESSION_FILE_LEGACY.name}")
            try:
                self.cl.load_settings(SESSION_FILE_LEGACY)
                saved_sid = (self.cl.cookie_dict or {}).get("sessionid") or self.cl.sessionid
                if saved_sid:
                    self.cl.login_by_sessionid(saved_sid)
                    if self.cl.username.lower() == self.username.lower():
                        self.cl.dump_settings(per_account_file)
                        log.info(f"[login] Session legacy OK — @{self.cl.username} (migrée vers fichier par compte)")
                        return True
                    else:
                        log.warning(
                            f"[login] Session legacy appartient à @{self.cl.username}, "
                            f"pas à @{self.username} — ignorée"
                        )
            except Exception as e:
                log.warning(f"[login] Session legacy invalide : {e}")
            self.cl = Client()
            self.cl.delay_range = [1, 3]

        # ── 4. Login username + password ───────────────────────────────────────
        if self.password:
            log.info(f"[login] Tentative cl.login(@{self.username}) avec mot de passe…")
            try:
                self.cl.login(self.username, self.password)
                self.cl.dump_settings(per_account_file)
                log.info(f"[login] Login réussi — @{self.cl.username} (session sauvegardée dans {per_account_file.name})")
                return True
            except ChallengeRequired as e:
                log.error(f"[login] Challenge de sécurité Instagram requis (2FA/captcha) — impossible à résoudre automatiquement : {e}")
                log.error("[login] Ouvre le navigateur manuellement : python3 save_session.py --username " + self.username)
            except BadPassword as e:
                log.error(f"[login] Mot de passe incorrect pour @{self.username} : {e}")
            except Exception as e:
                log.error(f"[login] cl.login() échoué ({type(e).__name__}) : {e}")
        else:
            log.warning(f"[login] Aucun mot de passe disponible pour @{self.username}")

        # ── Échec total ────────────────────────────────────────────────────────
        log.error(
            "[login] Toutes les méthodes de connexion ont échoué pour @%s. "
            "Lance : python3 save_session.py --username %s",
            self.username, self.username,
        )
        return False

    def _sessionid_from_playwright_cookies(self) -> Optional[str]:
        """Lit le cookie 'sessionid' depuis ig_session.json (format Playwright)."""
        if not IG_COOKIES_FILE.exists():
            return None
        try:
            cookies = json.loads(IG_COOKIES_FILE.read_text())
            return next(
                (c["value"] for c in cookies if c.get("name") == "sessionid"),
                None,
            )
        except Exception as e:
            log.warning(f"Lecture ig_session.json échouée : {e}")
            return None

    # ── Envoi d'un DM ─────────────────────────────────────────────────────────

    def check_session(self) -> bool:
        """Vérifie que la session est toujours active en appelant account_info()."""
        try:
            info = self.cl.account_info()
            log.info(
                f"[session] Active — @{info.username}  "
                f"(pk={info.pk}, full_name='{info.full_name}')"
            )
            return True
        except LoginRequired as e:
            log.error(f"[session] EXPIRÉE — LoginRequired : {e}")
            return False
        except Exception as e:
            log.warning(f"[session] Vérification échouée ({type(e).__name__}) : {e}")
            return False

    def send_dm(self, username: str, message: str) -> bool:
        """
        Envoie un DM à `username`.

        Raises:
            SuspiciousActivityError  si Instagram bloque l'envoi
        """
        clean = username.lstrip("@")
        log.debug(f"  [send_dm] Début → @{clean} | message ({len(message)} chars) : '{message[:80]}…'")

        # ── Résolution user_id ─────────────────────────────────────────────────
        try:
            user_id = self.cl.user_id_from_username(clean)
            log.debug(f"  [send_dm] user_id résolu : @{clean} → {user_id}")
        except UserNotFound:
            log.warning(f"  @{clean} — compte introuvable ou privé")
            return False
        except (RateLimitError, FeedbackRequired) as e:
            raise SuspiciousActivityError(f"Rate-limit / blocage lors de la résolution de @{clean} : {e}")
        except Exception as e:
            log.warning(f"  @{clean} — impossible de résoudre l'ID ({type(e).__name__}) : {e}")
            return False

        # ── Envoi ──────────────────────────────────────────────────────────────
        try:
            log.debug(f"  [send_dm] Appel direct_send(user_ids=[{user_id}])…")
            thread = self.cl.direct_send(message, user_ids=[user_id])

            # ── Inspection du thread retourné ──────────────────────────────────
            thread_id  = getattr(thread, "id", None)
            thread_v2  = getattr(thread, "thread_v2_id", None)
            pending    = getattr(thread, "pending", None)
            msgs       = getattr(thread, "messages", []) or []
            last_msg   = msgs[0] if msgs else None
            msg_id     = getattr(last_msg, "id", None) if last_msg else None
            msg_type   = getattr(last_msg, "item_type", None) if last_msg else None
            msg_ts     = getattr(last_msg, "timestamp", None) if last_msg else None

            log.info(
                f"  [send_dm] direct_send() retourné — "
                f"thread_id={thread_id}  thread_v2={thread_v2}  "
                f"pending={pending}  messages_count={len(msgs)}"
            )
            if msg_id:
                log.info(
                    f"  [send_dm] Dernier message — "
                    f"msg_id={msg_id}  type={msg_type}  timestamp={msg_ts}"
                )
            else:
                log.warning(
                    f"  [send_dm] ⚠ Aucun message dans le thread retourné "
                    f"(thread={thread_id}) — le message a peut-être été silencieusement bloqué."
                )

            if pending:
                log.warning(
                    f"  [send_dm] ⚠ thread.pending=True — "
                    f"le message est dans les DEMANDES de @{clean}, pas dans ses DMs principaux."
                )

            if not thread_id:
                log.warning(
                    f"  [send_dm] ⚠ Pas de thread_id dans la réponse — "
                    f"l'envoi est peut-être tombé dans le vide."
                )

            self.dm_count += 1
            log.info(f"  @{clean} — DM envoyé ✓  (#{self.dm_count} dans cette session)")
            return True

        except (RateLimitError, FeedbackRequired) as e:
            raise SuspiciousActivityError(f"Blocage Instagram lors de l'envoi à @{clean} : {e}")

        except (DirectError, ClientError) as e:
            log.warning(f"  @{clean} — erreur DM ({type(e).__name__}) : {e}")
            return False

        except Exception as e:
            log.warning(f"  @{clean} — erreur inattendue ({type(e).__name__}) : {e}")
            return False


# ---------------------------------------------------------------------------
# Logique de session
# ---------------------------------------------------------------------------

async def _run_session(
    sender:      InstagramSender,
    session_num: int,
    label:       str,
    prospects:   list,
    n_dms:       int,
    templates:   list[str],
    account_id:  Optional[int],
    delay_range: tuple[int, int],
    dry_run:     bool = False,
    on_progress: Optional[Callable[[str], None]] = None,
) -> SessionStats:
    """
    Exécute une session d'envoi :
    - envoie jusqu'à `n_dms` DMs parmi `prospects`
    - délai aléatoire `delay_range` secondes entre chaque DM
    - arrêt immédiat sur SuspiciousActivityError
    - met à jour la BDD après chaque envoi réussi
    """
    stats = SessionStats(session_num=session_num, label=label)
    sender.dm_count = 0

    header = f"{'─'*55}"
    log.info(header)
    log.info(f"  SESSION {session_num}/4  [{label}]  —  {n_dms} DMs prévus")
    log.info(header)

    targets = prospects[:n_dms]
    if len(targets) < n_dms:
        log.warning(f"  Seulement {len(targets)} prospects disponibles (sur {n_dms} prévus)")

    for i, modele in enumerate(targets, 1):
        username = modele["username"]
        template = random.choice(templates)
        message  = _render(template, username)

        progress_msg = f"Session {session_num} · DM {i}/{len(targets)} → @{username}"
        if on_progress:
            on_progress(progress_msg)
        log.debug(progress_msg)

        # ── Dry-run ──
        if dry_run:
            log.info(f"  [DRY-RUN] {i}/{len(targets)} @{username} | '{message[:60]}…'")
            stats.sent += 1
            await asyncio.sleep(random.uniform(0.5, 1))
            continue

        # ── Envoi réel (appel bloquant → thread séparé) ──
        try:
            success = await asyncio.to_thread(sender.send_dm, username, message)

        except SuspiciousActivityError as e:
            log.error(f"  ⚠  ACTIVITÉ SUSPECTE : {e}")
            log.error(f"  Arrêt de la session {session_num}.")
            if on_progress:
                on_progress(f"⚠ Blocage Instagram — session {session_num} interrompue")
            stats.stopped_reason = str(e)
            stats.ended_at = datetime.now()
            return stats

        except Exception as e:
            log.error(f"  @{username} — erreur inattendue : {e}")
            stats.failed += 1
            continue

        if success:
            stats.sent += 1
            _db_mark_contacted(modele["id"], username, message, account_id)
        else:
            stats.failed += 1

        # ── Délai avant le prochain DM ──
        if i < len(targets):
            wait = random.randint(*delay_range)
            eta  = (datetime.now() + timedelta(seconds=wait)).strftime("%H:%M:%S")
            log.info(f"  Pause {wait}s — prochain DM à {eta}")
            if on_progress:
                on_progress(f"Pause {wait}s (prochain à {eta})")
            await asyncio.sleep(wait)

    stats.ended_at = datetime.now()
    log.info(
        f"  Session {session_num} terminée — "
        f"envoyés: {stats.sent}  échecs: {stats.failed}  durée: {stats.duration}"
    )
    return stats


# ---------------------------------------------------------------------------
# Fonction publique principale
# ---------------------------------------------------------------------------

async def send_campaign(
    credentials:   dict,
    account_id:    Optional[int]       = None,
    modele_ids:    Optional[list[int]] = None,
    templates:     Optional[list[str]] = None,
    dms_per_day:   int                 = DMS_PER_DAY,
    n_sessions:    int                 = N_SESSIONS,
    delay_dm:      tuple[int, int]     = (DELAY_DM_MIN, DELAY_DM_MAX),
    delay_session: tuple[int, int]     = (DELAY_SESSION_MIN, DELAY_SESSION_MAX),
    headless:      bool                = True,   # ignoré (instagrapi n'utilise pas de navigateur)
    dry_run:       bool                = False,
    on_progress:   Optional[Callable[[str], None]] = None,
) -> CampaignResult:
    """
    Lance une campagne d'envoi complète (1 jour, 4 sessions).

    Args:
        credentials   : {"username": "...", "password": "..."}
        account_id    : id dans comptes_instagram (filtre les prospects assignés)
        modele_ids    : liste d'IDs ciblés (si fournie : 1 seule session)
        templates     : liste de messages. Variables : {username}, {date}, {heure}
        dms_per_day   : nombre total de DMs à envoyer (défaut 50)
        n_sessions    : nombre de sessions dans la journée (défaut 4)
        delay_dm      : (min_s, max_s) entre chaque DM
        delay_session : (min_s, max_s) entre chaque session
        headless      : paramètre de compatibilité, sans effet (pas de navigateur)
        dry_run       : True = simule sans envoyer réellement ni modifier la BDD
        on_progress   : callback(str) pour le suivi en temps réel

    Returns:
        CampaignResult avec statistiques détaillées
    """
    if not templates:
        templates = DEFAULT_TEMPLATES

    result = CampaignResult()

    # ── Charger les prospects depuis la BDD ──────────────────────────────────
    conn = get_connection()
    if modele_ids:
        rows = [crud.get_modele(conn, mid) for mid in modele_ids]
        all_prospects = [r for r in rows if r is not None]
    else:
        all_prospects = crud.lister_modeles(conn, statut="prospect")
    conn.close()

    if not all_prospects:
        msg = "Aucun profil à contacter."
        log.warning(msg)
        if on_progress:
            on_progress(msg)
        return result

    # Quand des IDs spécifiques sont fournis : 1 seule session, délais réduits
    if modele_ids:
        prospects   = list(all_prospects)
        n_sessions  = 1
        dms_per_day = len(prospects)
        delay_dm    = (3, 8)   # envoi rapide — pas de pause 60-180s entre DMs
    elif account_id:
        linked   = [m for m in all_prospects if m["compte_utilisé"] == account_id]
        unlinked = [m for m in all_prospects if m["compte_utilisé"] is None]
        prospects = linked + unlinked
        random.shuffle(prospects)
    else:
        prospects = list(all_prospects)
        random.shuffle(prospects)

    distribution = _distribute(min(dms_per_day, len(prospects)), n_sessions)
    log.info(f"Campagne démarrée — {sum(distribution)} DMs / {n_sessions} sessions")
    log.info(f"Distribution : {distribution}")
    log.info(f"Prospects disponibles : {len(prospects)}")
    log.info(f"Mode : {'DRY-RUN' if dry_run else 'RÉEL'}")

    if on_progress:
        on_progress(f"Campagne démarrée — {sum(distribution)} DMs prévus")

    # ── Connexion ─────────────────────────────────────────────────────────────
    sender = InstagramSender(
        username=credentials["username"],
        password=credentials["password"],
    )

    if not dry_run:
        logged_in = await asyncio.to_thread(sender.login)
        if not logged_in:
            result.aborted = True
            result.abort_reason = "Connexion Instagram impossible"
            log.error(result.abort_reason)
            if on_progress:
                on_progress(f"✗ {result.abort_reason}")
            return result

        # Vérification explicite que la session permet bien les appels API
        session_ok = await asyncio.to_thread(sender.check_session)
        if not session_ok:
            result.aborted = True
            result.abort_reason = "Session Instagram expirée ou invalide — relance save_session.py"
            log.error(result.abort_reason)
            if on_progress:
                on_progress(f"✗ {result.abort_reason}")
            return result

        if on_progress:
            on_progress(f"Connecté en tant que @{credentials['username']}")

    # ── Sessions ──────────────────────────────────────────────────────────────
    cursor = 0

    for s_idx, n_dms in enumerate(distribution):
        session_num = s_idx + 1
        label = SESSION_WINDOWS[s_idx][0] if s_idx < len(SESSION_WINDOWS) else f"Session {session_num}"

        session_prospects = prospects[cursor : cursor + n_dms]
        cursor += n_dms

        if not session_prospects:
            log.info(f"Session {session_num} : plus de prospects disponibles, fin.")
            break

        stats = await _run_session(
            sender      = sender,
            session_num = session_num,
            label       = label,
            prospects   = session_prospects,
            n_dms       = n_dms,
            templates   = templates,
            account_id  = account_id,
            delay_range = delay_dm,
            dry_run     = dry_run,
            on_progress = on_progress,
        )

        result.sessions.append(stats)
        result.total_sent    += stats.sent
        result.total_failed  += stats.failed
        result.total_skipped += stats.skipped

        # Arrêt si la session a été interrompue pour blocage
        if stats.stopped_reason:
            result.aborted      = True
            result.abort_reason = stats.stopped_reason
            log.error(f"Campagne interrompue après session {session_num}.")
            break

        # ── Pause inter-session ──
        if s_idx < len(distribution) - 1 and cursor < len(prospects):
            wait = random.randint(*delay_session)
            eta  = (datetime.now() + timedelta(seconds=wait)).strftime("%H:%M:%S")
            log.info(f"Pause inter-session : {wait // 60}m — reprise à {eta}")
            if on_progress:
                on_progress(f"Pause inter-session {wait // 60}min (reprise à {eta})")
            await asyncio.sleep(wait)

    log.info(result.summary())
    if on_progress:
        on_progress(
            f"Campagne terminée — envoyés: {result.total_sent}  "
            f"échecs: {result.total_failed}"
        )
    return result


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Envoi de DMs Instagram (instagrapi)")
    parser.add_argument("--account-id",   type=int,  default=None)
    parser.add_argument("--dms-per-day",  type=int,  default=DMS_PER_DAY)
    parser.add_argument("--delay-min",    type=int,  default=DELAY_DM_MIN)
    parser.add_argument("--delay-max",    type=int,  default=DELAY_DM_MAX)
    parser.add_argument("--template",     action="append", dest="templates")
    parser.add_argument("--dry-run",      action="store_true")
    args = parser.parse_args()

    from database import init_db
    init_db()

    conn = get_connection()
    comptes = crud.lister_comptes(conn)
    conn.close()

    if not comptes:
        print("Aucun compte Instagram en base. Ajoute-en un via le frontend.")
        sys.exit(1)

    if args.account_id:
        compte = next((c for c in comptes if c["id"] == args.account_id), None)
        if not compte:
            print(f"Compte id={args.account_id} introuvable.")
            sys.exit(1)
    else:
        compte = comptes[0]

    print(f"{'='*55}")
    print(f"  Compte      : @{compte['username']} (id={compte['id']})")
    print(f"  DMs/jour    : {args.dms_per_day}  ({N_SESSIONS} sessions)")
    print(f"  Délai DM    : {args.delay_min}-{args.delay_max}s")
    print(f"  Mode        : {'DRY-RUN (aucun envoi réel)' if args.dry_run else 'RÉEL'}")
    print(f"{'='*55}\n")

    asyncio.run(
        send_campaign(
            credentials  = {"username": compte["username"], "password": compte["password"]},
            account_id   = compte["id"],
            templates    = args.templates,
            dms_per_day  = args.dms_per_day,
            delay_dm     = (args.delay_min, args.delay_max),
            dry_run      = args.dry_run,
        )
    )
