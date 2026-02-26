"""
Hybrid FAISS + BM25 schema memory for the Smart Query Assistant.

Two responsibilities:
1. Schema retrieval — given a user question, find the most relevant table names
   using a fusion of semantic (FAISS cosine similarity) and keyword (BM25 Okapi)
   scores. Only those tables are injected into the LLM prompt.

2. Per-user query memory — store past successful queries per user so the LLM
   can use them as context for follow-up suggestions.

Hybrid score fusion: 0.6 × FAISS + 0.4 × BM25 (BM25 disabled gracefully if
rank_bm25 is not installed).

Embeddings: sentence-transformers all-MiniLM-L6-v2 (~22 MB, CPU-only, no API key).
Vector index: FAISS IndexFlatIP (inner-product, with L2 normalisation = cosine sim).
"""
from __future__ import annotations

import logging
import re

logger = logging.getLogger(__name__)

# ── Lazy-init globals ─────────────────────────────────────────────────────────

_faiss = None
_np = None
_SentenceTransformer = None
_model = None

_schema_index = None          # FAISS index over table descriptions
_schema_table_names: list[str] = []
_schema_table_texts: list[str] = []  # raw text used to build the index

_bm25_index = None            # BM25Okapi index (None if rank_bm25 not installed)
_bm25_table_names: list[str] = []

# ── Per-user query memory globals ─────────────────────────────────────────────

_user_memories: dict[int, list[dict]] = {}   # user_id → [{question, summary}]
_user_indices: dict[int, object] = {}         # user_id → FAISS index


# ── Helpers ───────────────────────────────────────────────────────────────────

def _tokenize(text: str) -> list[str]:
    """Lowercase + remove punctuation + split for BM25 tokenisation."""
    return re.sub(r"[^\w\s]", " ", text.lower()).split()


def _lexical_score(question: str, table_name: str, table_text: str) -> float:
    q_tokens = set(_tokenize(question))
    if not q_tokens:
        return 0.0
    table_tokens = set(_tokenize(f"{table_name} {table_text}"))
    overlap = len(q_tokens & table_tokens) / max(len(q_tokens), 1)
    name_bonus = 0.25 if any(tok in table_name.lower() for tok in q_tokens) else 0.0
    return overlap + name_bonus


def _rerank_tables(question: str, table_names: list[str], top_k: int) -> list[str]:
    """
    Final lightweight reranker after FAISS/BM25.
    It boosts exact domain/table/annotation matches so obvious business terms
    like "PPE", "camera health", or "workforce" do not get lost in embeddings.
    """
    if not table_names:
        return []

    text_by_table = dict(zip(_schema_table_names, _schema_table_texts))
    scored = [
        (_lexical_score(question, name, text_by_table.get(name, "")), idx, name)
        for idx, name in enumerate(table_names)
    ]
    scored.sort(key=lambda item: (item[0], -item[1]), reverse=True)
    return [name for _score, _idx, name in scored[:top_k]]


def _lazy_init() -> bool:
    global _faiss, _np, _SentenceTransformer, _model
    if _model is not None:
        return True
    try:
        import faiss  # type: ignore
        import numpy as np
        from sentence_transformers import SentenceTransformer  # type: ignore
        _faiss = faiss
        _np = np
        _SentenceTransformer = SentenceTransformer
        _model = SentenceTransformer("all-MiniLM-L6-v2")
        return True
    except ImportError as e:
        logger.warning(
            f"[schema_memory] FAISS/sentence-transformers unavailable: {e}. "
            "Falling back to full schema context."
        )
        return False


# ── Schema index build ────────────────────────────────────────────────────────

def build_schema_index() -> None:
    """
    Build FAISS + BM25 indexes over all table descriptions.
    Sources table names + descriptions from the live SchemaRegistry so the
    index always reflects the current DB schema (no stale hardcoded text).
    Call once on startup, after registry.build().
    """
    global _schema_index, _schema_table_names, _schema_table_texts
    global _bm25_index, _bm25_table_names

    if not _lazy_init():
        return

    # Pull table names + schema text from the live registry
    try:
        from .schema_registry import registry
        from .business_annotations import TABLE_ANNOTATIONS

        table_names = registry.get_all_table_names()
        if not table_names:
            # Registry not built yet — fall back to annotation keys
            table_names = list(TABLE_ANNOTATIONS.keys())

        texts: list[str] = []
        for name in table_names:
            schema_text = registry.get_table_schema_text(name)
            if schema_text:
                texts.append(schema_text)
            else:
                # Table in registry but no schema text — use annotation __table__ if available
                ann = TABLE_ANNOTATIONS.get(name, {})
                fallback = ann.get("__table__", name)
                texts.append(f"Table {name}: {fallback}")

    except Exception as e:
        logger.warning(f"[schema_memory] Could not read from registry: {e}. Skipping index build.")
        return

    if not texts:
        logger.warning("[schema_memory] No table texts available; skipping index build.")
        return

    # ── FAISS semantic index ──────────────────────────────────────────────────
    embeddings = _model.encode(texts, convert_to_numpy=True, show_progress_bar=False)
    embeddings = _np.array(embeddings, dtype="float32")
    _faiss.normalize_L2(embeddings)
    index = _faiss.IndexFlatIP(embeddings.shape[1])
    index.add(embeddings)
    _schema_index = index
    _schema_table_names = table_names
    _schema_table_texts = texts
    logger.info(f"[schema_memory] FAISS index built: {len(table_names)} tables")

    # ── BM25 keyword index ────────────────────────────────────────────────────
    try:
        from rank_bm25 import BM25Okapi  # type: ignore
        tokenized = [_tokenize(t) for t in texts]
        _bm25_index = BM25Okapi(tokenized)
        _bm25_table_names = table_names
        logger.info("[schema_memory] BM25 index built alongside FAISS")
    except ImportError:
        logger.warning(
            "[schema_memory] rank-bm25 not installed; hybrid retrieval disabled. "
            "Install with: pip install rank-bm25"
        )
        _bm25_index = None
        _bm25_table_names = []


# ── Hybrid retrieval ──────────────────────────────────────────────────────────

def retrieve_relevant_tables_hybrid(question: str, top_k: int = 7) -> list[str]:
    """
    Hybrid BM25 + FAISS retrieval.

    Score fusion:
      combined[i] = 0.6 × faiss_norm[i] + 0.4 × bm25_norm[i]

    Falls back to FAISS-only if BM25 is unavailable.
    Falls back to returning the full table list if FAISS is also unavailable.
    """
    if _schema_index is None or not _lazy_init():
        return list(_schema_table_names) if _schema_table_names else []

    n_tables = len(_schema_table_names)

    # ── FAISS scores ──────────────────────────────────────────────────────────
    vec = _model.encode([question], convert_to_numpy=True, show_progress_bar=False)
    vec = _np.array(vec, dtype="float32")
    _faiss.normalize_L2(vec)
    # Search ALL tables so we can normalise scores across the full set
    faiss_scores_raw, faiss_indices = _schema_index.search(vec, n_tables)
    faiss_scores_raw = faiss_scores_raw[0]   # shape (n_tables,)
    faiss_indices = faiss_indices[0]

    # Map raw scores back to table index order
    faiss_by_idx = _np.zeros(n_tables, dtype="float32")
    for score, idx in zip(faiss_scores_raw, faiss_indices):
        if 0 <= idx < n_tables:
            faiss_by_idx[idx] = float(score)

    # Normalise FAISS scores to [0, 1]
    f_min, f_max = faiss_by_idx.min(), faiss_by_idx.max()
    if f_max > f_min:
        faiss_norm = (faiss_by_idx - f_min) / (f_max - f_min)
    else:
        faiss_norm = _np.ones(n_tables, dtype="float32")

    # ── BM25 scores ───────────────────────────────────────────────────────────
    if _bm25_index is not None and len(_bm25_table_names) == n_tables:
        tokens = _tokenize(question)
        bm25_raw = _np.array(_bm25_index.get_scores(tokens), dtype="float32")
        b_min, b_max = bm25_raw.min(), bm25_raw.max()
        if b_max > b_min:
            bm25_norm = (bm25_raw - b_min) / (b_max - b_min)
        else:
            bm25_norm = _np.zeros(n_tables, dtype="float32")
        combined = 0.6 * faiss_norm + 0.4 * bm25_norm
    else:
        # BM25 unavailable — pure FAISS
        combined = faiss_norm

    # Top-k by combined score
    candidate_n = min(max(top_k * 2, top_k), n_tables)
    top_indices = _np.argsort(combined)[::-1][:candidate_n]
    candidates = [_schema_table_names[i] for i in top_indices if i < n_tables]
    return _rerank_tables(question, candidates, top_k)


def retrieve_relevant_tables(question: str, top_k: int = 7) -> list[str]:
    """Public entry point — delegates to hybrid retrieval."""
    return retrieve_relevant_tables_hybrid(question, top_k=top_k)


# ── Per-user query memory ─────────────────────────────────────────────────────

def remember_query(user_id: int, question: str, summary: str) -> None:
    """Store a successful query + result summary in the user's in-memory FAISS index."""
    if not _lazy_init():
        return
    entry = {"question": question, "summary": summary}
    mem = _user_memories.setdefault(user_id, [])
    mem.append(entry)
    if len(mem) > 20:
        _user_memories[user_id] = mem[-20:]

    # Rebuild FAISS index for this user
    texts = [f"{e['question']} — {e['summary']}" for e in _user_memories[user_id]]
    embeddings = _model.encode(texts, convert_to_numpy=True, show_progress_bar=False)
    embeddings = _np.array(embeddings, dtype="float32")
    _faiss.normalize_L2(embeddings)
    idx = _faiss.IndexFlatIP(embeddings.shape[1])
    idx.add(embeddings)
    _user_indices[user_id] = idx


def retrieve_past_queries(user_id: int, question: str, top_k: int = 2) -> list[dict]:
    """Return up to top_k past queries semantically similar to the current question."""
    if user_id not in _user_indices or not _lazy_init():
        return []
    idx = _user_indices[user_id]
    vec = _model.encode([question], convert_to_numpy=True, show_progress_bar=False)
    vec = _np.array(vec, dtype="float32")
    _faiss.normalize_L2(vec)
    n = min(top_k, len(_user_memories.get(user_id, [])))
    if n == 0:
        return []
    _, indices = idx.search(vec, n)
    mem = _user_memories[user_id]
    return [mem[i] for i in indices[0] if i < len(mem)]
