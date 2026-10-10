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

`http://127.0.0.1:5000` oeffnen. Diesen Host konsistent verwenden. Auf diesem Mac beantwortet AirPlay `localhost:5000` ueber IPv6; die eindeutige IPv4-Adresse erreicht die App. `localhost` und `127.0.0.1` haben unterschiedliche Cookies. Die zusaetzliche IPv4-Rueckleitungsadresse wurde am 5. Oktober 2026 beim bestehenden Polar-Client gespeichert und durch Neuladen bestaetigt. Die bisherige localhost-Adresse und ihre Standardauswahl bleiben erhalten.

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
5. Jeden der 19 Bereiche pruefen: HTTP-Status, Zeitraum, Originalantwort und Detailanfragen. Leere Antworten sind ein gueltiges Ergebnis; sie beweisen keine fehlende Geraeteunterstuetzung.

Die sechs Karten zeigen den neuesten verfügbaren Messwert mit Datum: Pulsmittelwert, tatsächliche Schlafdauer, Polar-ANS-Status, Schritte aus Sample-Buckets, letzte Trainingsdauer und Loop Gen 2. Ältere Messungen bleiben sichtbar markiert; fehlende Felder werden nicht als Null erfunden. Kennzahlen lesen ausschließlich das Archiv. Die Beispielansicht bleibt synthetisch und getrennt von echten Daten.

## Pruefung ohne echte Gesundheitsdaten

```sh
PYTHONPATH=apps/api .venv/bin/python -m pytest tests
npm --prefix apps/web test
npm --prefix apps/web run build
```

Tests verwenden simulierte MongoDB-/Polar-Antworten. Sie duerfen `.env` oder das reale Konto nicht fuer Testdaten verwenden.

## Auf Render von main deployen

`render.yaml` beschreibt einen Free-Web-Service in Frankfurt: Python 3.12, Node.js 22, Branch `main`, automatische Deploys bei neuen Commits und Gesundheitscheck `/api/health`. Frontend und Backend laufen als ein Dienst. Die Datei enthält keine Secrets; das Repository allein erstellt noch keinen Render-Dienst.

1. In Render einen **Blueprint** anlegen und dieses GitHub-Repository auswählen. `render.yaml` verwenden. Falls der Web-Service bereits manuell angelegt ist, dessen Einstellungen entsprechend der Datei setzen: Branch `main`, Auto-Deploy bei Commit, Build-/Startbefehl und Health Check übernehmen.
2. Folgende Werte beim Blueprint-Einrichten in den abgefragten Secret-Feldern eintragen; später sind sie unter Render **Environment** erreichbar:

| Variable | Wert |
| --- | --- |
| `POLAR_CLIENT_ID` | Bestehende Polar-Client-ID |
| `POLAR_CLIENT_SECRET` | Aktuelles Polar-Client-Secret |
| `MONGODB_URI` | Atlas-Verbindungsadresse mit Datenbankbenutzer |
| `MONGODB_DATABASE` | `polar_health_analytics` (bereits voreingestellt) |
| `OWNER_PASSWORD` | Privates Dashboard-Passwort, mindestens 12 Zeichen |
| `SESSION_SECRET` | Zufälliger Sitzungsschlüssel, mindestens 32 Zeichen |
| `TOKEN_ENCRYPTION_KEY` | Gültiger Fernet-Schlüssel; bei Nutzung der bestehenden Datenbank exakt den lokalen Schlüssel übernehmen |

3. In MongoDB Atlas die ausgehenden IP-Bereiche dieses Render-Dienstes unter **Network Access** erlauben. Render zeigt sie beim Dienst unter **Connect → Outbound**. Der Datenbankbenutzer benötigt Zugriff auf die verwendete Datenbank.
4. Render stellt `RENDER_EXTERNAL_URL` bereit. Die App verwendet daraus automatisch ihre HTTPS-Adresse und den Callback `https://<dein-service>.onrender.com/oauth2_callback`. Diese genaue Adresse im Polar-AccessLink-Portal zusätzlich als Rückleitungsadresse registrieren; die lokale Adresse kann bestehen bleiben.
5. Bei eigener Domain optional `APP_ORIGIN=https://deine-domain` setzen. `POLAR_REDIRECT_URI` wird automatisch als diese Adresse plus `/oauth2_callback` abgeleitet; ein expliziter Wert muss genau dazu passen. Keine lokalen URL-Werte aus `.env` nach Render kopieren.
6. Nach dem Deploy die Render-Adresse öffnen: `/api/health` muss HTTP 200 mit `{"status":"ok"}` liefern. Ohne Anmeldung liefert `/api/dashboard` HTTP 401. Danach anmelden und gespeicherte Daten prüfen. Bei Bedarf Polar erneut verbinden und „Aktualisieren“ verwenden.

Build und Start sind in `render.yaml` festgelegt:

```sh
pip install -r requirements.txt && npm --prefix apps/web ci && npm --prefix apps/web run build
uvicorn polar_api.app:create_app --factory --host 0.0.0.0 --port $PORT --no-access-log
```

`PYTHONPATH=apps/api` und `NODE_VERSION=22` werden vom Blueprint gesetzt. Gesundheitsdaten und Tokens liegen dauerhaft in MongoDB/GridFS; der Dienst benötigt keine lokale persistente Festplatte. Der Gesundheitscheck prüft Datenbank und Dashboard-Build, ohne Polar-Anfragen auszulösen oder private Daten auszugeben.

Ein Prozess, kein Scheduler. Free-Dienste können pausieren; der erste Aufruf kann deshalb länger dauern. Bereits gespeicherte Antworten bleiben in MongoDB. Ein unterbrochener Abruf kann erneut gestartet werden. 90 Tage Verlauf zeigen ausschließlich vorhandene Archivdaten; es gibt keine automatische historische Nachladung.

Offizielle Quellen: [Blueprint-Format und automatische Deploys](https://render.com/docs/blueprint-spec), [Render-Umgebungsvariablen](https://render.com/docs/environment-variables), [ausgehende IP-Adressen](https://render.com/docs/outbound-ip-addresses), [Python-Version](https://render.com/docs/python-version), [native Build-Werkzeuge](https://render.com/docs/native-runtimes).
