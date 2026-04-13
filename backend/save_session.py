"""
save_session.py — Connexion manuelle Instagram + sauvegarde de session

Lance ce script, connecte-toi dans le navigateur qui s'ouvre,
puis appuie sur Entrée dans le terminal. Les cookies sont sauvegardés
dans ig_session.json et réutilisés par le scraper et le sender.

Usage :
    python3 save_session.py
    python3 save_session.py --username mon_compte   # pré-remplit le champ
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path

from playwright.async_api import async_playwright

COOKIES_FILE = Path(__file__).parent / "ig_session.json"
IG_LOGIN_URL = "https://www.instagram.com/accounts/login/"


async def main(prefill_username: str = ""):
    print("Ouverture du navigateur Instagram…")

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=False,
            args=[
                "--no-sandbox",
                "--disable-blink-features=AutomationControlled",
            ],
        )
        context = await browser.new_context(
            viewport={"width": 1100, "height": 800},
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            locale="fr-FR",
            timezone_id="Europe/Paris",
        )
        await context.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
        )

        # Charger une session existante si disponible
        if COOKIES_FILE.exists():
            cookies = json.loads(COOKIES_FILE.read_text())
            await context.add_cookies(cookies)
            print(f"Session existante chargée depuis {COOKIES_FILE}")

        page = await context.new_page()
        await page.goto(IG_LOGIN_URL, wait_until="domcontentloaded")
        await asyncio.sleep(1.5)

        # Pré-remplir le username si fourni
        if prefill_username:
            try:
                await page.fill('input[name="username"]', prefill_username, timeout=5_000)
                print(f"Username pré-rempli : @{prefill_username}")
            except Exception:
                pass

        print()
        print("╔══════════════════════════════════════════════════╗")
        print("║  Connecte-toi dans le navigateur qui vient de    ║")
        print("║  s'ouvrir. Gère la 2FA si nécessaire.            ║")
        print("║                                                  ║")
        print("║  Une fois connecté et sur le fil d'accueil,      ║")
        print("║  reviens ici et appuie sur ENTRÉE.               ║")
        print("╚══════════════════════════════════════════════════╝")
        print()

        input("  → Appuie sur ENTRÉE une fois connecté… ")

        # Vérifier qu'on est bien connecté
        current_url = page.url
        if "login" in current_url or "challenge" in current_url:
            print()
            print("⚠️  Il semble que tu ne sois pas encore connecté.")
            print("   URL actuelle :", current_url)
            again = input("   Continuer quand même et sauvegarder ? [o/N] ").strip().lower()
            if again != 'o':
                await browser.close()
                print("Annulé.")
                return

        # Sauvegarder les cookies
        cookies = await context.cookies()
        COOKIES_FILE.write_text(json.dumps(cookies, indent=2))
        print()
        print(f"✅  Session sauvegardée → {COOKIES_FILE}")
        print(f"   {len(cookies)} cookie(s) enregistré(s)")

        # Extraire le username Instagram depuis les cookies
        ig_username = next(
            (c["value"] for c in cookies if c["name"] == "ds_user_id"), None
        )
        ig_user_str = next(
            (c["value"] for c in cookies if c["name"] == "sessionid"), None
        )
        logged_as = prefill_username or "inconnu"

        if ig_username:
            print(f"   Compte connecté : ds_user_id={ig_username}")

        print()

        # Proposer de mettre à jour / créer le compte en base
        from database import get_connection, init_db
        import crud

        init_db()
        with get_connection() as conn:
            comptes = crud.lister_comptes(conn)

        if comptes:
            print("Comptes actuellement en base :")
            for c in comptes:
                print(f"  [{c['id']}] @{c['username']}")
            print()
            choice = input("Mettre à jour un compte existant ? (id ou laisser vide pour créer) ").strip()

            if choice:
                try:
                    cid = int(choice)
                    pw_new = input(f"  Nouveau mot de passe pour le compte [{cid}] (laisser vide pour ne pas changer) : ").strip()
                    if pw_new:
                        with get_connection() as conn:
                            conn.execute(
                                "UPDATE comptes_instagram SET password = ? WHERE id = ?",
                                (pw_new, cid)
                            )
                            conn.commit()
                        print(f"  ✅  Mot de passe du compte [{cid}] mis à jour.")
                    else:
                        print("  (Mot de passe inchangé)")
                except ValueError:
                    print("  ID invalide, rien modifié.")
            else:
                uname = input("  Username du nouveau compte (@…) : ").strip().replace('@', '')
                passw = input("  Mot de passe : ").strip()
                if uname and passw:
                    with get_connection() as conn:
                        new_id = crud.ajouter_compte(conn, uname, passw)
                    print(f"  ✅  Compte @{uname} ajouté (id={new_id}).")
        else:
            print("Aucun compte en base.")
            uname = input("  Username du compte connecté (@…) : ").strip().replace('@', '')
            passw = input("  Mot de passe : ").strip()
            if uname and passw:
                with get_connection() as conn:
                    new_id = crud.ajouter_compte(conn, uname, passw)
                print(f"  ✅  Compte @{uname} ajouté (id={new_id}).")

        await browser.close()
        print()
        print("Navigateur fermé. La session est prête.")
        print("Lance maintenant : python3 scraper.py --target <compte_cible> --limit 50")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Connexion manuelle Instagram + sauvegarde session")
    parser.add_argument("--username", default="", help="Pré-remplit le champ username")
    args = parser.parse_args()

    asyncio.run(main(prefill_username=args.username))
