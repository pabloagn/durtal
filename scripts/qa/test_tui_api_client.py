"""TUI default and explicit API addresses; no env files or network access."""

import asyncio
import importlib.util
import os
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch


class FakeClient:
    def __init__(self, *, base_url, timeout):
        self.base_url = base_url
        self.timeout = timeout
        self.is_closed = False
        self.requests = []

    async def get(self, path):
        self.requests.append(path)
        return types.SimpleNamespace(
            raise_for_status=lambda: None, json=lambda: {"status": "ok"}
        )

    async def aclose(self):
        self.is_closed = True


def load_client(env):
    spec = importlib.util.spec_from_file_location(
        "tui_client_under_test", Path(__file__).parents[1] / "tui/api_client.py"
    )
    module = importlib.util.module_from_spec(spec)
    httpx = types.ModuleType("httpx")
    httpx.AsyncClient = FakeClient
    dotenv = types.ModuleType("dotenv")
    dotenv.load_dotenv = lambda *_args, **_kwargs: None
    with (
        patch.dict(sys.modules, {"httpx": httpx, "dotenv": dotenv}),
        patch.dict(os.environ, env, clear=True),
    ):
        spec.loader.exec_module(module)
    return module


class TuiAddress(unittest.TestCase):
    def test_default_health_uses_the_task_dev_address(self):
        client = load_client({}).DurtalClient()
        self.assertEqual(asyncio.run(client.health()), {"status": "ok"})
        self.assertEqual(client._client.base_url, "http://localhost:3100")
        self.assertEqual(client._client.requests, ["/api/health"])
        asyncio.run(client.close())
        self.assertTrue(client._client.is_closed)

    def test_environment_and_explicit_addresses_are_preserved(self):
        module = load_client({"DURTAL_API_URL": "http://localhost:3110/"})
        self.assertEqual(module.DurtalClient()._base_url, "http://localhost:3110")
        self.assertEqual(
            module.DurtalClient("http://localhost:3432/")._base_url,
            "http://localhost:3432",
        )


if __name__ == "__main__":
    unittest.main()
