import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "crm.db")


def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row  # Les résultats sont accessibles par nom de colonne
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    conn = get_connection()
    cursor = conn.cursor()

    cursor.executescript("""
        CREATE TABLE IF NOT EXISTS comptes_instagram (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT    NOT NULL UNIQUE,
            password TEXT    NOT NULL,
            actif    INTEGER NOT NULL DEFAULT 1  -- 1 = actif, 0 = inactif
        );

        CREATE TABLE IF NOT EXISTS modeles (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            username       TEXT    NOT NULL UNIQUE,
            followers      INTEGER DEFAULT 0,
            bio            TEXT,
            lien           TEXT,
            statut         TEXT    NOT NULL DEFAULT 'prospect',
            -- statut possible : prospect | contacté | en_cours | signé | archivé
            compte_utilisé INTEGER REFERENCES comptes_instagram(id),
            date_ajout     TEXT    NOT NULL DEFAULT (date('now'))
        );

        CREATE TABLE IF NOT EXISTS messages (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            modele_id  INTEGER NOT NULL REFERENCES modeles(id) ON DELETE CASCADE,
            contenu    TEXT    NOT NULL,
            date_envoi TEXT    NOT NULL DEFAULT (datetime('now')),
            direction  TEXT    NOT NULL DEFAULT 'sortant'
            -- direction : sortant (envoyé par nous) | entrant (réponse du modèle)
        );
    """)

    conn.commit()
    conn.close()
    print(f"Base de données initialisée : {DB_PATH}")


if __name__ == "__main__":
    init_db()
