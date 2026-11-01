import pytest
from fastapi import Request
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker
from smartboard import main
from smartboard.auth import Actor, actor
from smartboard.database import make_engine, session
from smartboard.providers import DemoProvider


@pytest.fixture
def client(tmp_path, monkeypatch):
    engine = make_engine(f"sqlite:///{(tmp_path / 'test.db').as_posix()}")
    factory = sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(main, "engine", engine)
    monkeypatch.setattr(main, "Session", factory)

    def db_session():
        with factory() as db:
            yield db

    def test_actor(request: Request):
        return Actor(
            request.headers.get("X-Test-Tenant", "tenant-a"),
            request.headers.get("X-Test-User", "user-a"),
        )

    main.app.dependency_overrides[session] = db_session
    main.app.dependency_overrides[actor] = test_actor
    main.app.state.provider = DemoProvider()
    main.app.state.active.clear()
    main.app.state.rate.clear()
    with TestClient(main.app) as test_client:
        yield test_client
    main.app.dependency_overrides.clear()
    engine.dispose()
