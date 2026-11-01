from dataclasses import replace
import pytest
from smartboard import auth
from smartboard.config import Settings


def test_remote_token_mode_requires_secret(client, monkeypatch):
    client.app.dependency_overrides.pop(auth.actor)
    config = replace(auth.settings, auth_mode="token", app_access_token="a" * 48)
    monkeypatch.setattr(auth, "settings", config)
    assert client.get("/api/v1/boards").status_code == 401
    assert (
        client.get(
            "/api/v1/boards", headers={"Authorization": "Bearer wrong"}
        ).status_code
        == 401
    )
    assert (
        client.get(
            "/api/v1/boards", headers={"Authorization": "Bearer " + "a" * 48}
        ).status_code
        == 200
    )


def test_remote_token_cannot_choose_another_identity(client, monkeypatch):
    client.app.dependency_overrides.pop(auth.actor)
    config = replace(auth.settings, auth_mode="token", app_access_token="b" * 48)
    monkeypatch.setattr(auth, "settings", config)
    headers = {
        "Authorization": "Bearer " + "b" * 48,
        "X-Tenant-Id": "other",
        "X-User-Id": "other",
    }
    assert client.get("/api/v1/boards", headers=headers).status_code == 200
    monkeypatch.setattr(auth, "settings", replace(config, app_access_token=""))
    assert client.get("/api/v1/boards", headers=headers).status_code == 401


def test_token_mode_fails_closed_at_startup():
    with pytest.raises(ValueError, match="APP_ACCESS_TOKEN"):
        replace(Settings(), auth_mode="token", app_access_token="short").validate()
