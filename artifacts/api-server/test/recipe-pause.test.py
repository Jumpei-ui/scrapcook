"""No network calls: verify personal-key isolation and fail-closed provider dispatch."""
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlparse

spec = importlib.util.spec_from_file_location("scrapcook", Path(__file__).parents[1] / "flask_app.py")
scrapcook = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scrapcook)


class Response:
    status = 200

    def __init__(self, data):
        self.data = data

    def read(self):
        return json.dumps(self.data).encode()

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        pass


class ProviderPauseTests(unittest.TestCase):
    def setUp(self):
        self.keys = patch.multiple(scrapcook, SPOONACULAR_API_KEY="owner-fixture-only", GEMINI_KEY="gemini-owner-fixture-only")
        self.keys.start()
        self.addCleanup(self.keys.stop)

    def paused(self):
        return HTTPError("http://fixture/internal", 429, "paused", {}, io.BytesIO(json.dumps({
            "paused": True, "resumesAt": "2099-01-02T00:00:00.000Z",
        }).encode()))

    def test_shared_spoon_call_stops_before_network_when_paused(self):
        with patch.object(scrapcook, "urlopen", side_effect=self.paused()) as network:
            with self.assertRaises(scrapcook.RecipePaused):
                scrapcook.spoonacular_get("/recipes/findByIngredients")
            self.assertEqual(network.call_count, 1)  # Accounting only, no provider.

    def test_personal_spoon_key_is_used_without_shared_tracking(self):
        with scrapcook.app.test_request_context(headers={"x-personal-spoon-key": "personal-fixture-only"}):
            with patch.object(scrapcook, "urlopen", return_value=Response([])) as network:
                scrapcook.spoonacular_get("/recipes/findByIngredients", api_key="personal-fixture-only")
                self.assertEqual(network.call_count, 1)
                query = parse_qs(urlparse(network.call_args.args[0].full_url).query)
                self.assertEqual(query["apiKey"], ["personal-fixture-only"])

    def test_explicit_personal_request_never_uses_shared_gemini_as_fallback(self):
        client = scrapcook.app.test_client()
        with patch.object(scrapcook, "hybrid_recipes", return_value=[]) as hybrid:
            with patch.object(scrapcook, "recipe_search_cache_get", return_value=None):
                response = client.post("/api/getRecipes", json={"ingredients": ["egg", "bread", "milk"]},
                    headers={"x-personal-spoon-key": "personal-fixture-only"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(hybrid.call_args.args[2:4], ("personal-fixture-only", ""))
        self.assertTrue(hybrid.call_args.kwargs["personal"])

    def test_personal_gemini_scope_survives_worker_thread_dispatch(self):
        from concurrent.futures import ThreadPoolExecutor
        data = {"candidates": [{"content": {"parts": [{"text": '{"title":"Snack"}'}]}}]}
        with patch.object(scrapcook, "urlopen", return_value=Response(data)) as network:
            with ThreadPoolExecutor(max_workers=1) as worker:
                result = worker.submit(scrapcook.gemini_json, "gemini-owner-fixture-only", "test", True).result()
            self.assertEqual(result["title"], "Snack")
            self.assertEqual(network.call_count, 1)  # No accounting callback or shared fallback.

    def test_mid_generation_pause_returns429_not_generic_provider_failure(self):
        with patch.object(scrapcook, "hybrid_recipes", side_effect=scrapcook.RecipePaused("2099-01-02T00:00:00.000Z")):
            with patch.object(scrapcook, "recipe_search_cache_get", return_value=None):
                response = scrapcook.app.test_client().post("/api/getRecipes",
                    json={"ingredients": ["egg", "bread", "milk"]})
        self.assertEqual(response.status_code, 429)
        self.assertTrue(response.json["paused"])
        self.assertEqual(response.json["resetTime"], "midnight UTC")

    def test_expired_hybrid_session_never_falls_back_to_shared_keys(self):
        with scrapcook.app.test_request_context("/api/scrapcook/session"):
            scrapcook.session["recipeSearchKey"] = "hybrid:fixture-only"
            with patch.object(scrapcook, "recipe_search_cache_get", return_value=None):
                with patch.object(scrapcook, "spoonacular_search_data") as shared:
                    self.assertEqual(scrapcook.session_real_recipe_details(), [])
                    shared.assert_not_called()


if __name__ == "__main__":
    unittest.main()
