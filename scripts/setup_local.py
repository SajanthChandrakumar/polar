"""Create missing local owner credentials without displaying existing secrets."""
from pathlib import Path
import secrets

from cryptography.fernet import Fernet
from dotenv import dotenv_values


def main():
    root = Path(__file__).resolve().parents[1]
    path = root / ".env"
    if not path.exists():
        path.write_text((root / ".env.example").read_text())
    values = dotenv_values(path)
    defaults = {
        "OWNER_PASSWORD": secrets.token_urlsafe(24),
        "SESSION_SECRET": secrets.token_urlsafe(48),
        "TOKEN_ENCRYPTION_KEY": Fernet.generate_key().decode(),
    }
    missing = {key: value for key, value in defaults.items() if not values.get(key)}
    if missing:
        with path.open("a") as stream:
            stream.write("\n# Lokal erzeugter Besitzerzugang und Verschluesselung\n")
            for key, value in missing.items():
                stream.write(f"{key}={value}\n")
    path.chmod(0o600)
    print("Lokale Konfiguration bereit. OWNER_PASSWORD steht ausschliesslich in .env.")


if __name__ == "__main__":
    main()
