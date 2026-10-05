# Lokal starten und echte Daten pruefen

Python 3.12 und Node.js 22 verwenden. Alle Befehle im Repository-Stamm ausfuehren.

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python scripts/setup_local.py
npm --prefix apps/web ci
npm --prefix apps/web run build
PYTHONPATH=apps/api .venv/bin/uvicorn polar_api.app:create_app --factory --host 127.0.0.1 --port 5000 --no-access-log
```

`http://127.0.0.1:5000` oeffnen. Diesen Host konsistent verwenden. Auf diesem Mac beantwortet AirPlay `localhost:5000` ueber IPv6; die eindeutige IPv4-Adresse erreicht die App. `localhost` und `127.0.0.1` haben unterschiedliche Cookies. Die zusaetzliche Rueckleitungsadresse muss beim bestehenden Polar-Client registriert sein, bevor OAuth funktioniert; die bisherige localhost-Adresse kann erhalten bleiben.

## Konfiguration

`.env.example` enthaelt nur Namen und nicht sensible Vorgaben. `scripts/setup_local.py` ergaenzt fehlende private Schluessel in der ignorierten `.env`, ohne sie auszugeben. Bereits eingetragene Werte bleiben erhalten.

- `POLAR_CLIENT_ID`, `POLAR_CLIENT_SECRET`: aus dem vorhandenen Polar-Client.
- `POLAR_REDIRECT_URI`: lokal `http://127.0.0.1:5000/oauth2_callback`, muss beim Client registriert sein.
- `APP_ORIGIN`: lokal `http://127.0.0.1:5000`.
- `MONGODB_URI`: Atlas-Verbindungsadresse mit eigenem Datenbankbenutzer. Datenbank `polar_health_analytics` getrennt von anderen Projekten.
- `OWNER_PASSWORD`: Passwort fuer den privaten Dashboard-Zugang; lokal in `.env` ablesen und im Dashboard eingeben.
- `SESSION_SECRET`: Signierung der Dashboard-Sitzung.
- `TOKEN_ENCRYPTION_KEY`: Verschluesselung der gespeicherten Polar-Tokens. Bei Verlust sind die Tokens nicht mehr lesbar; eine erneute Polar-Verbindung ist erforderlich.

Keine dieser geheimen Werte in `VITE_*`-Variablen, Browsercode, Git, Screenshots oder Chat uebernehmen.

## Erster echter Abruf

1. Loop mit Polar Flow synchronisieren.
2. Im Dashboard mit `OWNER_PASSWORD` anmelden.
3. „Mit Polar verbinden“ waehlen und auf der Polar-Seite die angeforderten Leseberechtigungen pruefen und selbst bestaetigen.
4. Zurueck im Dashboard wird der erste Abruf gestartet; manuell kann „Daten abrufen“ verwendet werden.
5. Jeden der 21 Bereiche pruefen: HTTP-Status, Zeitraum, Originalantwort und Detailanfragen. Leere Antworten sind ein gueltiges Ergebnis; sie beweisen keine fehlende Geraeteunterstuetzung.

Die Kennzahlen bleiben leer, solange noch keine anhand echter Antworten gepruefte Ableitung existiert. Die Datensammlung und der Antwortinspektor dienen als Grundlage dafuer. Die Beispielansicht bleibt synthetisch und getrennt von echten Daten.

## Pruefung ohne echte Gesundheitsdaten

```sh
PYTHONPATH=apps/api .venv/bin/python -m pytest tests
npm --prefix apps/web test
npm --prefix apps/web run build
```

Tests verwenden simulierte MongoDB-/Polar-Antworten. Sie duerfen `.env` oder das reale Konto nicht fuer Testdaten verwenden.

## Render vorbereiten

`render.yaml` beschreibt einen Free-Web-Service; die Datei allein stellt nichts bereit. Keine Secrets sind enthalten. Vor einer Bereitstellung `APP_ORIGIN` auf die tatsaechliche HTTPS-Adresse setzen und `POLAR_REDIRECT_URI` mit `/oauth2_callback` ergaenzen. Diese Adresse zusaetzlich beim Polar-Client registrieren. Secrets ausschliesslich in Render setzen. Atlas muss den tatsaechlichen Render-Zugriff erlauben; keine unnoetigen pauschalen Netzwerkfreigaben einrichten.

Ein Prozess, kein Scheduler. Render-Unterbrechungen sind moeglich; bereits gespeicherte Originalantworten bleiben in MongoDB. Ein verlorener Abruf wird als unterbrochen angezeigt und kann erneut gestartet werden.

Quellen fuer die vorbereitete Render-Konfiguration: [Python-Version](https://render.com/docs/python-version), [native Build-Werkzeuge](https://render.com/docs/native-runtimes), [Blueprint-Format](https://render.com/docs/blueprint-spec).
