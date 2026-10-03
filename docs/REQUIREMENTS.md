# Verbindliche Anforderungen aus dem Nutzerauftrag

## Aktuelle Entscheidung vom 3. Oktober 2026

Diese Entscheidung ersetzt frühere SQLite-/Mac-/Scheduler-Vorgaben in diesem Dokument: FastAPI-Anwendung später auf Render, dauerhafte Raw- und Messdaten in einer eigenen MongoDB-Atlas-Datenbank `polar_health_analytics`. Raw-Body unverändert als Binärdaten; keine JSON-Neuserialisierung als Original. Sammlung aller verfügbaren Bereiche gemäß DATA_INVENTORY.md. Sync zunächst beim authentifizierten Öffnen der Seite; parallele Seitenaufrufe dürfen keine überlappenden Syncs starten. Keine öffentliche unauthentifizierte Sync-Funktion. Zeitgesteuerte Hintergrundabrufe werden verschoben. Kein Readiness-Algorithmus in dieser Phase. Browser-OAuth-Callback muss beim späteren Deployment auf die tatsächliche Render-URL angepasst werden; derzeit ist http://localhost:5000/oauth2_callback registriert. Implementierung und Zugangsdaten bleiben ausstehend.

Frühere Abschnitte darunter dokumentieren den ursprünglichen Entwurf; abweichende SQLite-, lokale Scheduler- und Migrationsvorgaben gelten nicht mehr.

## Aktualisierung vom 3. Oktober 2026

Vorrangiges Ziel: alle laut Dokumentation für das Konto verfügbaren Daten sammeln und unverändert sichern; Auswertungen erst danach festlegen. Die sechs ursprünglichen Bereiche sind keine Obergrenze. Siehe DATA_INVENTORY.md für den erweiterten Umfang und noch offene Request-Verträge. Betrieb zunächst lokal auf dem täglich online befindlichen Mac; kein kostenpflichtiges Hosting. Gerät: Polar Loop Gen 2. Flow-Verbindung und API-Client laut Nutzer vorhanden. Lokaler Callback: http://localhost:5000/oauth2_callback. Implementierung und Secrets weiterhin nicht begonnen.

- Neues eigenständiges Repo: polar-health-analytics.
- Day 1 hat Daten-Pipeline Priorität vor Dashboard.
- Polar OAuth2 + AccessLink v4; Secrets in .env.
- Sofortige DB mit raw_api_responses, sleep, nightly_recharge, continuous_hr, activity, training_sessions, devices.
- Raw-Responses immer unverändert speichern, danach normalisieren.
- Day-1-Sync: /user-devices, /activity/list, /continuous-samples, /sleeps, /nightly-recharge-results, /training-sessions/list.
- Jeden Sync mit fetched_at, source, start_time, end_time, polar_user_id, device_id dokumentieren.
- Automatischen täglichen Sync vorbereiten.
- Data-Quality-Page: HR samples, sleep, nightly recharge, activity, training, last sync.
- Collector → Raw Storage → Normalizer → DB → Quality Check → Dashboard → Algorithmus → Jarvis Integration.
- Readiness deterministisch und transparent; persönliche Baseline von beispielsweise 14–30 Tagen.
- Features: HRV, Resting HR, Sleep Score/Duration, Schlafkonsistenz, vorherige Trainingsbelastung, Aktivitäts-/Recovery-Trend.
- Keine Secrets eintragen oder veröffentlichen.

## Präzisierungen für die spätere Implementierung

Raw meint den unveränderten Response-Body als BLOB, nicht erneut serialisiertes JSON. Metadaten daneben: HTTP-Status, Content-Type, Endpoint, bereinigte Request-Parameter, Hash, sync_run_id. Keine Authorization-Header oder OAuth-Token in Raw/Logs speichern. OAuth-Antworten gehören in den geschützten Token-Speicher.

fetched_at ist UTC-Abrufzeit; start_time/end_time beschreiben den Messzeitraum. Ein zusätzlicher Sync-Lauf hat started_at/finished_at und requested_from/to. Fehlende Geräte-ID oder Messzeiten bleiben NULL mit Grund; niemals erfinden. Originale lokale Zeit/Offset erhalten, Tagesansicht Europe/Zurich; Sommerzeit berücksichtigen.

Datensammlung beginnt nach Autorisierung und Geräte-Synchronisation zu Polar Flow. Geräteunterstützung, tatsächliche Felder und verfügbare Historie sind erst mit realen Daten bestätigt. Day 1 kann noch keinen Schlafdatensatz enthalten. Keine verlorenen Tage oder vollständige Historie versprechen.
