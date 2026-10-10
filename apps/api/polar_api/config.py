"""Private configuration; credentials are never included in repr or API output."""
from dataclasses import dataclass, field
import os
from pathlib import Path
from urllib.parse import urlparse

from cryptography.fernet import Fernet
from dotenv import load_dotenv


@dataclass
class Settings:
    owner_password: str = field(repr=False, default='')
    session_secret: str = field(repr=False, default='')
    token_encryption_key: str = field(repr=False, default='')
    mongodb_uri: str = field(repr=False, default='')
    database: str = 'polar_health_analytics'
    client_id: str = field(repr=False, default='')
    client_secret: str = field(repr=False, default='')
    public_url: str = 'http://localhost:5000'
    redirect_uri: str = 'http://localhost:5000/oauth2_callback'
    frontend_dist: Path = Path(__file__).resolve().parents[2] / 'web' / 'dist'

    @property
    def secure_cookie(self):
        return self.public_url.startswith('https://')

    def validate(self):
        if len(self.owner_password) < 12 or len(self.session_secret) < 32:
            raise RuntimeError('Private server credentials are missing or invalid')
        try:
            Fernet(self.token_encryption_key.encode())
        except (ValueError, TypeError):
            raise RuntimeError('Token encryption configuration is missing or invalid') from None
        origin = urlparse(self.public_url)
        callback = urlparse(self.redirect_uri)
        if origin.scheme not in {'http', 'https'} or not origin.netloc or origin.path not in {'', '/'} or origin.query or origin.fragment:
            raise RuntimeError('APP_ORIGIN must be an exact HTTP origin')
        if origin.scheme == 'http' and origin.hostname not in {'localhost', '127.0.0.1', 'testserver'}:
            raise RuntimeError('Public deployments require HTTPS')
        if callback.scheme != origin.scheme or callback.netloc != origin.netloc or callback.path != '/oauth2_callback' or callback.query or callback.fragment:
            raise RuntimeError('Polar callback must match APP_ORIGIN/oauth2_callback')
        if os.getenv('RENDER') and (origin.scheme != 'https' or origin.hostname in {'localhost', '127.0.0.1', 'testserver'}):
            raise RuntimeError('Render requires a public HTTPS origin')
        self.public_url = self.public_url.rstrip('/')

    @classmethod
    def from_env(cls):
        load_dotenv()
        origin = (os.getenv('APP_ORIGIN') or
                  (os.getenv('RENDER_EXTERNAL_URL') if os.getenv('RENDER') else None) or
                  'http://localhost:5000').rstrip('/')
        return cls(owner_password=os.getenv('OWNER_PASSWORD', ''), session_secret=os.getenv('SESSION_SECRET', ''),
                   token_encryption_key=os.getenv('TOKEN_ENCRYPTION_KEY', ''),
                   mongodb_uri=os.getenv('MONGODB_URI', os.getenv('MONGO_URI', '')),
                   database=os.getenv('MONGODB_DATABASE', 'polar_health_analytics'),
                   client_id=os.getenv('POLAR_CLIENT_ID', ''), client_secret=os.getenv('POLAR_CLIENT_SECRET', ''),
                   public_url=origin, redirect_uri=os.getenv('POLAR_REDIRECT_URI') or origin + '/oauth2_callback')
