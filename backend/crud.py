"""
Opérations CRUD pour chaque table.
Toutes les fonctions reçoivent une connexion sqlite3 en paramètre
afin de pouvoir être composées dans une même transaction si besoin.
"""

# ---------------------------------------------------------------------------
# comptes_instagram
# ---------------------------------------------------------------------------

def ajouter_compte(conn, username: str, password: str) -> int:
    cur = conn.execute(
        "INSERT INTO comptes_instagram (username, password) VALUES (?, ?)",
        (username, password),
    )
    conn.commit()
    return cur.lastrowid


def lister_comptes(conn) -> list:
    return conn.execute("SELECT * FROM comptes_instagram").fetchall()


def basculer_actif(conn, compte_id: int, actif: bool) -> None:
    conn.execute(
        "UPDATE comptes_instagram SET actif = ? WHERE id = ?",
        (1 if actif else 0, compte_id),
    )
    conn.commit()


# ---------------------------------------------------------------------------
# modeles
# ---------------------------------------------------------------------------

def ajouter_modele(conn, username: str, followers: int = 0, bio: str = "",
                   lien: str = "", statut: str = "prospect",
                   compte_utilisé: int = None) -> int:
    cur = conn.execute(
        """INSERT INTO modeles (username, followers, bio, lien, statut, compte_utilisé)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (username, followers, bio, lien, statut, compte_utilisé),
    )
    conn.commit()
    return cur.lastrowid


def lister_modeles(conn, statut: str = None) -> list:
    if statut:
        return conn.execute(
            "SELECT * FROM modeles WHERE statut = ? ORDER BY date_ajout DESC", (statut,)
        ).fetchall()
    return conn.execute("SELECT * FROM modeles ORDER BY date_ajout DESC").fetchall()


def get_modele(conn, modele_id: int):
    return conn.execute("SELECT * FROM modeles WHERE id = ?", (modele_id,)).fetchone()


def mettre_a_jour_statut(conn, modele_id: int, nouveau_statut: str) -> None:
    conn.execute(
        "UPDATE modeles SET statut = ? WHERE id = ?", (nouveau_statut, modele_id)
    )
    conn.commit()


def supprimer_modele(conn, modele_id: int) -> None:
    conn.execute("DELETE FROM modeles WHERE id = ?", (modele_id,))
    conn.commit()


# ---------------------------------------------------------------------------
# messages
# ---------------------------------------------------------------------------

def ajouter_message(conn, modele_id: int, contenu: str,
                    direction: str = "sortant") -> int:
    cur = conn.execute(
        "INSERT INTO messages (modele_id, contenu, direction) VALUES (?, ?, ?)",
        (modele_id, contenu, direction),
    )
    conn.commit()
    return cur.lastrowid


def lister_messages(conn, modele_id: int) -> list:
    return conn.execute(
        "SELECT * FROM messages WHERE modele_id = ? ORDER BY date_envoi ASC",
        (modele_id,),
    ).fetchall()
