# Stack und Repo-Struktur

## Aktuelle Entscheidung vom 3. Oktober 2026

Diese Entscheidung ersetzt frühere SQLite-/Mac-/Scheduler-Vorgaben in diesem Dokument: FastAPI-Anwendung später auf Render, dauerhafte Raw- und Messdaten in einer eigenen MongoDB-Atlas-Datenbank `polar_health_analytics`. Raw-Body unverändert als Binärdaten; keine JSON-Neuserialisierung als Original. Sammlung aller verfügbaren Bereiche gemäß DATA_INVENTORY.md. Sync zunächst beim authentifizierten Öffnen der Seite; parallele Seitenaufrufe dürfen keine überlappenden Syncs starten. Keine öffentliche unauthentifizierte Sync-Funktion. Zeitgesteuerte Hintergrundabrufe werden verschoben. Kein Readiness-Algorithmus in dieser Phase. Browser-OAuth-Callback muss beim späteren Deployment auf die tatsächliche Render-URL angepasst werden; derzeit ist http://localhost:5000/oauth2_callback registriert. Implementierung und Zugangsdaten bleiben ausstehend.

Frühere Abschnitte darunter dokumentieren den ursprünglichen Entwurf; abweichende SQLite-, lokale Scheduler- und Migrationsvorgaben gelten nicht mehr.

## Entscheidung

Python 3.12 + FastAPI + Pydantic, HTTPX für Collector, SQLite über sqlite3, versionierte SQL-Migrationen und pytest. Konfiguration aus .env über python-dotenv; Abhängigkeiten später in pyproject.toml festhalten. SQLite lokal mit WAL, Fremdschlüsseln, einem Writer und Backup vor Migration. PostgreSQL erst bei mehreren Nutzern oder Writer-Prozessen.

Frontend später React + TypeScript + Vite; TanStack Query für API-Zustände, Recharts erst für Trends. FastAPI liefert beim Deployment den gebauten Frontend-Ordner aus. Keine zusätzliche Next.js-Laufzeit nötig. API und Algorithmus rechnen serverseitig; Frontend stellt Ergebnisse dar.

Täglicher Sync als separat aufrufbarer Prozess. Lokal später launchd, beispielsweise 08:30 und 20:30 Europe/Zurich; verpassten Lauf beim nächsten Start nachholen. Noch keinen Scheduler installieren. Immerlaufender Host mit persistentem Volume kann später folgen.

## Grundlage und Grenzen der Prüfung

GitHub-Profil und öffentliches Predictor-Repo wurden zuerst aufgerufen. Einige GitHub-Seiten für Jarvis/DraftChamp waren im Web-Abruf nicht lesbar; deshalb wurden die vorhandenen lokalen Checkouts und deren origin-URLs ergänzend geprüft. Lokale Befunde sind kein Nachweis des aktuellen GitHub-Branchstands.

- wm2026_predictor: öffentliches README nennt Python/FastAPI, React/TypeScript/Vite, Recharts und MongoDB. Lokales frontend-v2/package.json bestätigt Frontend-Techniken. Übernehmen: separate Provider-Wartung, Dashboard liest gespeicherte Daten, nachvollziehbare Modellanalyse. MongoDB ist für dieses relationale Einzelpersonenprojekt nicht nötig.
- DraftChamp: lokale apps/api/pyproject.toml und apps/web/package.json bestätigen FastAPI/Pydantic sowie React/Vite. README: apps/api und apps/web; Server besitzt Regeln und Ergebnisse. Diese Struktur passt hier.
- gassi-jarvis: lokales README/requirements.txt bestätigen FastAPI/Pydantic, vanilla PWA und SQLite für Geräteaufträge. Übernehmen: Herkunft und fehlende Daten explizit zeigen; später schlanker lesender Jarvis-Adapter. Kein LLM im Readiness-Kern.

Alternativen: SQLite + schlichte HTML-Quality-Ansicht wäre noch kleiner, passt aber weniger zum späteren Analytics-Dashboard. PostgreSQL + Next.js ab Day 1 erzeugt zusätzliche Betriebsarbeit ohne belegten Bedarf. Gewählt: FastAPI/SQLite, dann Vite.

Quellen: [Profil](https://github.com/SajanthChandrakumar), [Predictor](https://github.com/SajanthChandrakumar/wm2026_predictor), [Jarvis](https://github.com/SajanthChandrakumar/gassi-jarvis), [DraftChamp](https://github.com/SajanthChandrakumar/DraftChamp).

## Geplante Struktur (noch nicht implementiert)

```text
polar-health-analytics/
  README.md
  .gitignore
  .env.example
  apps/
    api/
      pyproject.toml
      app/
        main.py
        config.py
        polar/{oauth.py,client.py}
        collector.py
        storage.py
        normalizer.py
        quality.py
        readiness.py
        cli.py
      migrations/001_initial.sql
      tests/
    web/
      src/{api.ts,QualityPage.tsx}
  docs/{REQUIREMENTS.md,STACK.md,DAY1.md,ALGORITHM.md}
  data/          # ignoriert: DB, Raw-Daten, Backups
```

Nur tatsächlich benötigte Module anlegen. .env.example enthält später ausschließlich leere POLAR_CLIENT_ID, POLAR_CLIENT_SECRET, POLAR_REDIRECT_URI und nicht sensible Konfiguration. .env, Token-Dateien, DB, Raw-Daten und Backups ignorieren. Keine echten Gesundheitsdaten als Testfixtures.
