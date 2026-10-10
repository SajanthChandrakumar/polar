import pytest
from cryptography.fernet import Fernet
from polar_api.config import Settings


@pytest.fixture
def isolated_env(monkeypatch):
    monkeypatch.setattr('polar_api.config.load_dotenv', lambda: None)
    for name in ('APP_ORIGIN', 'POLAR_REDIRECT_URI', 'RENDER', 'RENDER_EXTERNAL_URL'):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv('OWNER_PASSWORD', 'test-password-only')
    monkeypatch.setenv('SESSION_SECRET', 'x' * 40)
    monkeypatch.setenv('TOKEN_ENCRYPTION_KEY', Fernet.generate_key().decode())
    return monkeypatch


def test_render_uses_external_url_and_secure_callback(isolated_env):
    isolated_env.setenv('RENDER', 'true')
    isolated_env.setenv('RENDER_EXTERNAL_URL', 'https://polar-test.onrender.com')
    settings = Settings.from_env()
    settings.validate()
    assert settings.public_url == 'https://polar-test.onrender.com'
    assert settings.redirect_uri == settings.public_url + '/oauth2_callback'
    assert settings.secure_cookie


def test_explicit_domain_overrides_render_url(isolated_env):
    isolated_env.setenv('RENDER', 'true')
    isolated_env.setenv('RENDER_EXTERNAL_URL', 'https://polar-test.onrender.com')
    isolated_env.setenv('APP_ORIGIN', 'https://polar.example.com/')
    settings = Settings.from_env()
    settings.validate()
    assert settings.redirect_uri == 'https://polar.example.com/oauth2_callback'


def test_local_default_and_render_missing_url(isolated_env):
    settings = Settings.from_env()
    settings.validate()
    assert settings.public_url == 'http://localhost:5000'
    isolated_env.setenv('RENDER', 'true')
    with pytest.raises(RuntimeError, match='HTTPS'):
        Settings.from_env().validate()
