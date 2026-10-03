# Dateninventar und Sammelplan

## Aktuelle Entscheidung vom 3. Oktober 2026

Diese Entscheidung ersetzt frühere SQLite-/Mac-/Scheduler-Vorgaben in diesem Dokument: FastAPI-Anwendung später auf Render, dauerhafte Raw- und Messdaten in einer eigenen MongoDB-Atlas-Datenbank `polar_health_analytics`. Raw-Body unverändert als Binärdaten; keine JSON-Neuserialisierung als Original. Sammlung aller verfügbaren Bereiche gemäß DATA_INVENTORY.md. Sync zunächst beim authentifizierten Öffnen der Seite; parallele Seitenaufrufe dürfen keine überlappenden Syncs starten. Keine öffentliche unauthentifizierte Sync-Funktion. Zeitgesteuerte Hintergrundabrufe werden verschoben. Kein Readiness-Algorithmus in dieser Phase. Browser-OAuth-Callback muss beim späteren Deployment auf die tatsächliche Render-URL angepasst werden; derzeit ist http://localhost:5000/oauth2_callback registriert. Implementierung und Zugangsdaten bleiben ausstehend.

Frühere Abschnitte darunter dokumentieren den ursprünglichen Entwurf; abweichende SQLite-, lokale Scheduler- und Migrationsvorgaben gelten nicht mehr.

Stand: 3. Oktober 2026. Quelle: [Polar v4](https://www.polar.com/polar-api-v4/).
Dokumentierter Umfang; Konto-Verfügbarkeit noch ungeprüft.

## Dokumentierte Abrufbereiche

| Pfad | Detailauswahl / Grenze pro Anfrage |
|---|---|
| /user-devices | Geräte |
| /activity/list | samples, activity-target, physical-information; Discovery 90 Tage, Details 1 Tag |
| /continuous-samples | heart-rate-samples; 30 Tage |
| /sleeps | sleep-result, original-sleep-result, sleep-evaluation, sleep-score; Discovery 30 Tage, Details 1 Tag |
| /sleep-wake-vectors | 7 Tage; Historie letzte 90 Tage |
| /nightly-recharge-results | samples; ohne Features 28 Tage, Details 1 Tag |
| /ppi-samples | samples; Discovery 90 Tage, Details 1 Tag |
| /skin-contacts | 90 Tage |
| /temperature-measurements | 90 Tage |
| /tests/list | samples; ohne Features 90 Tage, Details 1 Tag |
| /training-sessions/list | samples, test-results, training-load-report, laps, hill-splits, routes, statistics, zones, pause-times, strength-training-results, comments, physical-info; ohne Features 90 Tage, Details 1 Tag |
| /calendar/list | notes, feeling, feedback, perceived-recovery, weight, physical-information; 90 Tage |
| /training-target/favorites | Favoriten |
| /training-target/calendar-targets | fromDate, toDate |
| /routes/{routeId} | IDs aus Zielen/Favoriten; keine Drittanbieter-Routen |
| /sports/profile-list-catalog | Profilreihenfolge |
| /sports/profiles | Profile |
| /sports/list | Sportkatalog |
| /user/account-data | Konto |
| /user/profile-picture | small, medium, large |
| /subscriptions | Abonnements |

/hello ist kein Datensatz. Alle 21 dokumentierten Daten-Endpunkte sind im Inventar enthalten.
Abfragefenster sind keine pauschalen Historiengrenzen.

## Festgelegtes Produktziel

Alle für das Konto abrufbaren Daten archivieren, bevor über Auswertungen entschieden wird. Die sechs bisherigen normalisierten Tabellen begrenzen den Collector nicht. Neue Bereiche bleiben zunächst vollständig als Raw erhalten; spezialisierte Tabellen nur bei tatsächlichem Bedarf.

Ein Endpunkt ist nicht automatisch eine Messfähigkeit des Loop. Leere Antworten, verweigerte Berechtigung, fehlende Geräteunterstützung und technische Fehler getrennt erfassen. Keine automatisch erfundenen Werte und kein Readiness-Algorithmus in dieser Phase.

## Lokaler Betrieb

Mac ist laut Nutzer täglich online; Polar Loop Gen 2 und Flow verbunden, API-Client vorhanden. Callback im Browser bestätigt: http://localhost:5000/oauth2_callback. Keine Zugangsdaten in dieser Dokumentation.

Vorgesehene Abrufe 08:30 und 20:30 Europe/Zurich, Nachholen beim nächsten Start. Erst nach manuell geprüftem OAuth und Collector aktivieren. Zeitbereiche ab erster Nutzung sammeln und letzte sieben Tage überlappend erneut prüfen. Rohdaten unabhängig von erfolgreicher Normalisierung dauerhaft speichern.

## Noch vor Implementierung abschließen

Endpoint-Scopes, Parameterkodierung und Antwortschemas systematisch mit offizieller Spezifikation abgleichen. Widersprüche der Dokumentation als offene Vertragsfragen festhalten. Das Inventar ist noch kein vollständig verifizierter Request-Vertrag.

## Abnahme der späteren Sammlung

Jeder Bereich hat einen nachvollziehbaren Abrufstatus. Discovery und Details sind archiviert. Alle Rohkörper bleiben bytegetreu, mit Hash und Herkunft. Wiederholungen erzeugen keine doppelten normalisierten Messungen. Neue Datenbereiche benötigen keinen Collector-Umbau. Fehlender Schlaf und leere Tests sind sichtbar. Tokens bleiben außerhalb Raw und Logs.
