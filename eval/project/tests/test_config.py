from inventory.config import load_settings


def test_load_settings_reads_api_key(monkeypatch):
    monkeypatch.setenv("API_KEY", "k")
    assert load_settings().api_key == "k"
