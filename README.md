# Polar Health Analytics

Stand: 4. Oktober 2026. Zuerst alle verfügbaren Polar-Daten sammeln und unverändert sichern, anschließend über Auswertungen entscheiden.

Phase 1 ist als lokales React-/TypeScript-Dashboard implementiert. Backend, privater Zugang, Polar-OAuth und dauerhafte Speicherung folgen später. Keine Zugangsdaten eingetragen.

## Aktuelle Entscheidungen

- Polar Loop Gen 2, verbunden mit Polar Flow.
- Polar OAuth2 und AccessLink v4; API-Client vorhanden.
- Anwendung später auf Render; dauerhafte Speicherung in einer eigenen MongoDB-Atlas-Datenbank `polar_health_analytics`.
- Sync zunächst beim authentifizierten Öffnen der Seite; keine automatische Hintergrundplanung im ersten Stand.
- Raw-Responses vor Parsing unverändert als Binärdaten mit Herkunft, Abrufzeit und Hash archivieren.
- Dashboard zuerst als private Datenübersicht; danach alle Endpunkte mit echten Daten testen. Algorithmus erst nach verifizierter Datensammlung.

## Dokumentation

1. [Dashboard-Plan](docs/DASHBOARD_PLAN.md)
2. [Anforderungen](docs/REQUIREMENTS.md)
3. [Dateninventar](docs/DATA_INVENTORY.md)
4. [Stack](docs/STACK.md)
5. [Day 1](docs/DAY1.md)

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

Die Oberfläche beginnt ohne Verbindung und ohne Kennzahlen. „Beispieldaten ansehen“ aktiviert ausdrücklich synthetische, nur im Browser gehaltene Fixtures. „Demo-Abruf“ simuliert einen Ladezustand und einen Teilerfolg; es gibt keine Anfrage an Polar und keine Speicherung. „Beispieldaten verlassen“ entfernt die Beispiele und bricht einen laufenden Demo-Abruf ab. Ein Neuladen startet wieder mit der leeren Ansicht.

Alle 21 dokumentierten Endpunkte lassen sich durchsuchen, filtern und im Detail prüfen. Eine erfolgreiche leere Antwort bleibt von Fehlern und übersprungenen Routen getrennt. Die synthetischen Antwortstrukturen sind illustrative Beispiele, keine verifizierten Polar-API-Verträge. Der Verbindungsbutton erklärt den ausstehenden nächsten Schritt.
