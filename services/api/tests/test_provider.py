from types import SimpleNamespace as N
import pytest
from smartboard import providers
from smartboard.config import Settings
from smartboard.providers import Delta, Done, OpenAIProvider, ProviderFailure


class FakeStream:
    def __init__(self, events):
        self.events = events

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    def __aiter__(self):
        return self.iterate()

    async def iterate(self):
        for event in self.events:
            yield event


def fake_client(monkeypatch, events, captured):
    class Client:
        def __init__(self, **kwargs):
            self.responses = self

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def create(self, **kwargs):
            captured.update(kwargs)
            return FakeStream(events)

    monkeypatch.setattr(providers, "AsyncOpenAI", Client)


@pytest.mark.asyncio
async def test_openai_adapter_uses_stateless_stream_and_real_usage(monkeypatch):
    captured = {}
    fake_client(
        monkeypatch,
        [
            N(type="response.output_text.delta", delta="F is force."),
            N(
                type="response.completed",
                response=N(
                    status="completed", usage=N(input_tokens=50, output_tokens=7)
                ),
            ),
        ],
        captured,
    )
    provider = OpenAIProvider(Settings())
    result = [
        item
        async for item in provider.stream(
            {"extractedContent": [{"content": "F = ma"}], "surroundingContext": []},
            "Explain",
            "EXPLAIN",
            [],
        )
    ]
    assert isinstance(result[0], Delta) and result[0].text == "F is force."
    assert isinstance(result[1], Done) and result[1].usage == {
        "inputTokens": 50,
        "outputTokens": 7,
    }
    assert captured["store"] is False and captured["stream"] is True
    assert "F = ma" in captured["input"][0]["content"]
    assert captured["instructions"] == providers.SYSTEM_PROMPT


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "terminal", ["response.failed", "response.incomplete", "error"]
)
async def test_openai_adapter_rejects_failed_terminal_event(monkeypatch, terminal):
    fake_client(monkeypatch, [N(type=terminal)], {})
    with pytest.raises(ProviderFailure):
        _ = [
            item
            async for item in OpenAIProvider(Settings()).stream(
                {"extractedContent": [], "surroundingContext": []},
                "Explain",
                "EXPLAIN",
                [],
            )
        ]
