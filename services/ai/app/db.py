import psycopg

from . import config


def query(sql: str, params: tuple = ()) -> list[tuple]:
    # shortcut: una conexión por consulta, sin pool; basta para la demo, usar pool si hay carga.
    with psycopg.connect(config.DATABASE_URL, autocommit=True) as c:
        cur = c.execute(sql, params)
        return cur.fetchall() if cur.description else []


_org: str | None = None


def org_id() -> str:
    global _org
    if _org is None:
        rows = query("select id from organization where slug = %s", (config.ORG_SLUG,))
        if not rows:
            raise RuntimeError(f"Organización '{config.ORG_SLUG}' no existe")
        _org = rows[0][0]
    return _org
