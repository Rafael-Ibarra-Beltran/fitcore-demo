from . import config, db, llm

CHUNK = 600


def chunks(text: str, size: int = CHUNK) -> list[str]:
    """Junta párrafos hasta `size` caracteres; un párrafo más largo se parte a la fuerza."""
    out, cur = [], ""
    for p in (p.strip() for p in text.split("\n\n")):
        if not p:
            continue
        while len(p) > size:
            if cur:
                out.append(cur)
                cur = ""
            out.append(p[:size])
            p = p[size:]
        if cur and len(cur) + len(p) + 2 > size:
            out.append(cur)
            cur = ""
        cur = f"{cur}\n\n{p}" if cur else p
    if cur:
        out.append(cur)
    return out


def vec(v: list[float]) -> str:
    return "[" + ",".join(map(str, v)) + "]"


def ingest() -> int:
    """Regenera los fragmentos de todos los documentos. Idempotente: borra y reinserta por documento."""
    org = db.org_id()
    n = 0
    for doc_id, title, content in db.query("select id, title, content from kb_document where organization_id = %s", (org,)):
        parts = chunks(content)
        # gemini-embedding-2 no admite task_type: la tarea va en el texto.
        embs = llm.embed([f"title: {title} | text: {p}" for p in parts]) if parts else []
        db.query("delete from kb_chunk where document_id = %s", (doc_id,))
        for p, e in zip(parts, embs):
            db.query(
                "insert into kb_chunk (id, organization_id, document_id, content, embedding) values (gen_random_uuid()::text, %s, %s, %s, %s::vector)",
                (org, doc_id, p, vec(e)),
            )
            n += 1
    return n


def search(q: str, k: int = 4) -> list[str]:
    e = vec(llm.embed([f"task: search result | query: {q}"])[0])
    rows = db.query(
        "select content, 1 - (embedding <=> %s::vector) as score from kb_chunk "
        "where organization_id = %s and embedding is not null order by embedding <=> %s::vector limit %s",
        (e, db.org_id(), e, k),
    )
    return [c for c, s in rows if s >= config.RAG_MIN_SCORE]


if __name__ == "__main__":
    print(f"{ingest()} fragmentos")
