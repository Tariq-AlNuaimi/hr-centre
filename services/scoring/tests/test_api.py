"""API-layer tests: request validation, response shape, and the Bearer gate."""

import importlib

import pytest
from fastapi.testclient import TestClient

import app.main as main_module


def _client(token: str | None = None, monkeypatch=None):
    # The Bearer gate reads SCORING_SERVICE_TOKEN at import; re-import under the
    # desired env so the module-level _TOKEN reflects it.
    if monkeypatch is not None:
        if token is None:
            monkeypatch.delenv("SCORING_SERVICE_TOKEN", raising=False)
        else:
            monkeypatch.setenv("SCORING_SERVICE_TOKEN", token)
    importlib.reload(main_module)
    return TestClient(main_module.app)


def _answers(value: int = 3) -> list[dict]:
    return [{"itemNumber": i, "response": value} for i in range(1, 121)]


def test_health(monkeypatch):
    c = _client(token=None, monkeypatch=monkeypatch)
    r = c.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "model": "IPIP-NEO-120", "auth_required": False}


def test_score_ok(monkeypatch):
    c = _client(token=None, monkeypatch=monkeypatch)
    r = c.post("/score", json={"answers": _answers(3), "sex": "N", "age": 30})
    assert r.status_code == 200
    body = r.json()
    assert body["model"] == "IPIP-NEO-120"
    assert len(body["domains"]) == 5
    assert all(len(d["facets"]) == 6 for d in body["domains"])


def test_score_rejects_wrong_count(monkeypatch):
    c = _client(token=None, monkeypatch=monkeypatch)
    r = c.post("/score", json={"answers": _answers(3)[:119]})
    assert r.status_code == 422


def test_score_rejects_duplicate_item(monkeypatch):
    c = _client(token=None, monkeypatch=monkeypatch)
    answers = _answers(3)
    answers[1]["itemNumber"] = 1  # duplicate item 1, drops item 2
    r = c.post("/score", json={"answers": answers})
    assert r.status_code == 422


def test_bearer_gate(monkeypatch):
    c = _client(token="s3cret-token-value", monkeypatch=monkeypatch)
    payload = {"answers": _answers(3)}
    # health advertises that auth is armed
    assert c.get("/health").json()["auth_required"] is True
    # no / wrong token -> 401
    assert c.post("/score", json=payload).status_code == 401
    assert c.post("/score", json=payload, headers={"Authorization": "Bearer nope"}).status_code == 401
    # correct token -> 200
    ok = c.post("/score", json=payload, headers={"Authorization": "Bearer s3cret-token-value"})
    assert ok.status_code == 200
