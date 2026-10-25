# Polar Health Analytics

**Live deployment:** [polarhealth.onrender.com](https://polarhealth.onrender.com/)

**Recovery Lab demo:** [Open the public demo](https://polarhealth.onrender.com/demo)

Stand: 10. Oktober 2026. Polar-Daten werden unverändert archiviert und daraus verständliche Tagesrückmeldungen und persönliche Verläufe abgeleitet.

Dashboard und FastAPI-Backend sind implementiert: privater Besitzerzugang, serverseitiges Polar-OAuth, verschluesselte Tokens, unveraenderte Rohdaten in MongoDB/GridFS sowie Collector fuer 19 ausgewählte Datenbereiche. Polar ist verbunden; echte Originalantworten wurden am 7. Oktober 2026 erfolgreich archiviert. Profilbild und Profilreihenfolge wurden auf Nutzerwunsch entfernt. Zugangsdaten liegen ausschliesslich in der ignorierten lokalen Konfiguration.

## Aktuelle Entscheidungen

- Polar Loop Gen 2, verbunden mit Polar Flow.
- Polar OAuth2 und AccessLink v4; API-Client vorhanden.
- Render-Konfiguration für automatische Deploys von `main`; dauerhafte Speicherung in einer eigenen MongoDB-Atlas-Datenbank `polar_health_analytics`.
- Sync zunächst beim authentifizierten Öffnen der Seite; keine automatische Hintergrundplanung im ersten Stand.
- Raw-Responses vor Parsing unverändert als Binärdaten mit Herkunft, Abrufzeit und Hash archivieren.
- Dashboard zuerst als private Datenübersicht; danach alle Endpunkte mit echten Daten testen. Algorithmus erst nach verifizierter Datensammlung.

## Dokumentation

1. [Lokal starten und verbinden](docs/RUNNING.md)
2. [Verifizierte API-Vertraege und offene Vertragsfragen](docs/API_CONTRACTS.md)
3. [Dashboard-Plan](docs/DASHBOARD_PLAN.md)
4. [Anforderungen](docs/REQUIREMENTS.md)
5. [Dateninventar](docs/DATA_INVENTORY.md)
6. [Stack](docs/STACK.md)
7. [Day 1](docs/DAY1.md)
8. [Tagesrückmeldung und archivierte Verläufe](docs/ANALYTICS.md)

Architektur: Collector → Raw Storage → Normalizer → MongoDB → Quality Check → Dashboard → spätere Auswertung.

Keine Secrets, Tokens, Gesundheitsdaten oder lokalen Ausgaben ins Repository aufnehmen.

## Dashboard lokal starten

Voraussetzung: Node.js 20.19+ oder 22.12+ und npm.

```sh
cd apps/web
npm ci
npm run dev
```

Der Entwicklungsserver bindet ausschließlich an `127.0.0.1`; die lokale Adresse steht in seiner Ausgabe (üblicherweise `http://127.0.0.1:5173`).

```sh
npm test
npm run build
npm run preview
```

Der Build liegt in `apps/web/dist` und wird nicht versioniert. Es werden keine entfernten Schriftarten oder Bilder geladen.

Die Oberfläche beginnt ohne Verbindung und ohne Kennzahlen. „Beispieldaten ansehen“ aktiviert ausdrücklich synthetische, nur im Browser gehaltene Fixtures. „Demo-Abruf“ simuliert einen Ladezustand und einen Teilerfolg; es gibt keine Anfrage an Polar und keine Speicherung. „Beispieldaten verlassen“ entfernt die Beispiele und bricht einen laufenden Demo-Abruf ab. Nach Anmeldung lädt ein Neuladen die gespeicherten Live-Daten.

Alle 19 ausgewählten Endpunkte lassen sich durchsuchen, filtern und im Detail prüfen. Eine erfolgreiche leere Antwort bleibt von Fehlern und übersprungenen Routen getrennt. Die synthetischen Antwortstrukturen sind illustrative Beispiele, keine verifizierten Polar-API-Verträge. Der Verbindungsbutton fordert zuerst den privaten Login an und leitet danach zu Polar weiter. Die Live-Ansicht laedt echte archivierte Antworten ausschliesslich nach Anmeldung. Die sechs Live-Karten werden aus gespeicherten Originalantworten abgeleitet: Pulsmittelwert des jüngsten Tages, tatsächliche Schlafdauer, Polar-ANS-Status, Schritte des jüngsten Tages, Dauer des letzten Trainings und Loop Gen 2. Jede datierte Kennzahl zeigt ihr Messdatum; ältere Werte sind markiert. Fehlende Felder bleiben leer.

## Backend und Tests

Die gesamte lokale Einrichtung steht in [RUNNING.md](docs/RUNNING.md). Fuer den echten Betrieb `http://127.0.0.1:5000` verwenden, damit der registrierte IPv4-OAuth-Callback und die Sitzung denselben Host haben. Die alte localhost-Adresse kann auf dem Mac mit AirPlay kollidieren. Das Besitzerpasswort steht unter `OWNER_PASSWORD` in der lokalen `.env`.

```sh
PYTHONPATH=apps/api .venv/bin/python -m pytest tests
npm --prefix apps/web test
npm --prefix apps/web run build
```

Tests verwenden ausschliesslich simulierte Polar-/MongoDB-Daten. Die bestehende Anwendung ist unter [polarhealth.onrender.com](https://polarhealth.onrender.com/) erreichbar. `render.yaml` baut Frontend und Backend und aktiviert Deploys von `main`; Einrichtung, Secrets und Polar-Callback stehen in [der Render-Anleitung](docs/RUNNING.md#auf-render-von-main-deployen). Ein Neustart kann einen laufenden Sync unterbrechen; bereits gespeicherte Originalantworten bleiben erhalten. Nach einem abrupten Prozessende wird die verlorene Sperre spaetestens nach 90 Sekunden wieder verfuegbar.

## Öffentliches Recovery Lab

Die [öffentliche Demo](https://polarhealth.onrender.com/demo) bietet den Bewegungsvergleich ohne Anmeldung. Er verwendet vier fest datierte, synthetische Fixtures vom 3. Juli bis 30. September 2026. Die 30-/90-Tage- und Schlaf-/ANS-Auswahl arbeitet vollständig im Browser; sie fragt weder Sitzung, Dashboard, Sync noch Polar-Daten ab. Alle Beispielquellen sind vor dem Bündeln entfernt.

Die Fixtures erzeugt `PYTHONPATH=apps/api .venv/bin/python scripts/generate_pattern_demo.py`. Der Generator erstellt synthetische normalisierte Tagespunkte und verwendet dieselbe reine `calculate_patterns`-Funktion wie das Backend. Der private Datenfluss bleibt getrennt: erfolgreiche Rohantworten → vorhandene Tageskorrektur und Normalisierung → geschütztes, nur lesendes `GET /api/patterns` → gemeinsame `PatternExplorer`-Ansicht. Öffentliche Demo und private Oberfläche teilen nur die Darstellung.

Verglichen werden Bewegungstage mit der folgenden Zürcher Kalendernacht. Die Schritt-Grenze ist der Median aller verfügbaren, nicht vorläufigen Bewegungstage im gewählten verschobenen Zeitraum, unabhängig von verfügbaren Nachtwerten. Schlaf wird in Minuten, ANS als Messwert dargestellt. Null Schritte bleiben gültig; fehlende und vorläufige Tage werden getrennt ausgewiesen. Gruppenmediane und Quartile erscheinen erst ab sieben vollständigen Nächten je Gruppe. Das ist eine Beobachtung ohne Kausalaussage, Tragezeitnachweis, Prognose oder medizinische Empfehlung.

Private Paare benötigen vollständige, gültige Archivmessungen; die aktuelle Abdeckung ist hier nicht verifiziert. Die öffentliche Demo verwendet synthetische Daten und ersetzt keine fehlenden privaten Messungen. Details stehen in [ANALYTICS.md](docs/ANALYTICS.md).

## Verläufe und persönlicher Vergleich

Unter den sechs Kreisen zeigen fünf Diagramme die archivierten Messungen über 7, 30 oder 90 Tage. Tagesfeedback vergleicht mit dem Median der vorherigen 28 Tage, sobald mindestens sieben vollständige Vergleichstage vorhanden sind. Details und Originalantworten sind verknüpft. Siehe [ANALYTICS.md](docs/ANALYTICS.md).
