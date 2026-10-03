# Polar Health Analytics

Planungsstand: 3. Oktober 2026. Zuerst alle verfügbaren Polar-Daten sammeln und unverändert sichern, anschließend über Auswertungen entscheiden.

Noch keine Anwendung implementiert oder Zugangsdaten eingetragen.

## Aktuelle Entscheidungen

- Polar Loop Gen 2, verbunden mit Polar Flow.
- Polar OAuth2 und AccessLink v4; API-Client vorhanden.
- Anwendung später auf Render; dauerhafte Speicherung in einer eigenen MongoDB-Atlas-Datenbank `polar_health_analytics`.
- Sync zunächst beim authentifizierten Öffnen der Seite; keine automatische Hintergrundplanung im ersten Stand.
- Raw-Responses vor Parsing unverändert als Binärdaten mit Herkunft, Abrufzeit und Hash archivieren.
- Dashboard und Algorithmus erst nach verifizierter Datensammlung.

## Dokumentation

1. [Anforderungen](docs/REQUIREMENTS.md)
2. [Dateninventar](docs/DATA_INVENTORY.md)
3. [Stack](docs/STACK.md)
4. [Day 1](docs/DAY1.md)

Architektur: Collector → Raw Storage → Normalizer → MongoDB → Quality Check → Dashboard → spätere Auswertung.

Keine Secrets, Tokens, Gesundheitsdaten oder lokalen Ausgaben ins Repository aufnehmen.
