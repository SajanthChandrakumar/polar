# Day-1-Reihenfolge und Abnahme

## Aktuelle Entscheidung vom 3. Oktober 2026

Diese Entscheidung ersetzt frühere SQLite-/Mac-/Scheduler-Vorgaben in diesem Dokument: FastAPI-Anwendung später auf Render, dauerhafte Raw- und Messdaten in einer eigenen MongoDB-Atlas-Datenbank `polar_health_analytics`. Raw-Body unverändert als Binärdaten; keine JSON-Neuserialisierung als Original. Sammlung aller verfügbaren Bereiche gemäß DATA_INVENTORY.md. Sync zunächst beim authentifizierten Öffnen der Seite; parallele Seitenaufrufe dürfen keine überlappenden Syncs starten. Keine öffentliche unauthentifizierte Sync-Funktion. Zeitgesteuerte Hintergrundabrufe werden verschoben. Kein Readiness-Algorithmus in dieser Phase. Browser-OAuth-Callback muss beim späteren Deployment auf die tatsächliche Render-URL angepasst werden; derzeit ist http://localhost:5000/oauth2_callback registriert. Implementierung und Zugangsdaten bleiben ausstehend.

Frühere Abschnitte darunter dokumentieren den ursprünglichen Entwurf; abweichende SQLite-, lokale Scheduler- und Migrationsvorgaben gelten nicht mehr.

## 1. Lokales Repo und Persistenz

Git lokal initialisieren, keine Remote-Veröffentlichung. Ignore-Regeln zuerst; leere .env.example. SQLite-Migration vor erstem Datenabruf ausführen.

Tabellen: raw_api_responses (append-only Body + Provenienz); sleep (Nacht, Dauer/Score); nightly_recharge (HRV/Herzfrequenz mit Messdefinition); continuous_hr (Samplezeit, bpm, Gerät); activity (Tageswerte); training_sessions (Session-ID, Zeitraum, Belastung); devices (Originalreferenzen). Ergänzend sync_runs, sync_endpoint_results und geschützter OAuth-Token-Speicher. Jede normalisierte Zeile referenziert raw_response_id und normalizer_version. Unique Keys pro Nutzer und Anbieter-ID beziehungsweise Datum/Gerät/Sample verhindern Dubletten. Änderungen beim Anbieter erzeugen neue Raw-Versionen.

## 2. Polar-Vertrag und OAuth

Client später im Polar-Portal registrieren, Redirect-URI exakt abgleichen. Authorization Code Flow mit geprüftem state, serverseitigem Token-Austausch und geschützter Token-Persistenz. V4-spezifische Scopes, Token-Lifecycle, Zustimmung und eventuelle Nutzerregistrierung direkt anhand aktueller Auth-Dokumentation prüfen; keine v3-Regeln still übernehmen. Noch keine Zugangsdaten beschaffen oder einsetzen.

Offizielle v4-Datenbasis: https://www.polaraccesslink.com/v4/data.
[Polar v4 Dokumentation](https://www.polar.com/polar-api-v4/).
Die sechs gewünschten Pfade sind die Collector-Ziele. Für activity/list und sleeps liefern Abfragen ohne features zunächst verfügbare Tage. Danach pro Tag benötigte Features/Details abrufen; Pagination und Zeitfenster je Endpoint berücksichtigen. Die Dokumentation begrenzt diese Discovery-Fenster auf 90 beziehungsweise 30 Tage und Feature-Abfragen auf einen Tag. Alle sechs Request-Verträge vor Code anhand der Dokumentation festhalten.

## 3. Erster vollständiger Collector

Geräte zuerst, danach Activity, Continuous HR, Sleep, Nightly Recharge und Training. Response vor JSON-Parsing dauerhaft speichern. Normalisierung separat aus Raw wiederholbar ausführen. Ein kaputter Payload darf andere Datenbereiche nicht blockieren. Discovery- und Detail-Antworten beide archivieren. Device UUID und deviceId nicht ohne belegte Zuordnung gleichsetzen.

Timeouts, begrenzte Retries, Retry-After bei 429, Abbruch/Handlungsbedarf bei Auth-Fehler. Checkpoints erst nach erfolgreichem Speichern setzen; überlappend letzte Tage erneut prüfen, verspätete Flow-Synchronisation aufnehmen. Pro Bereich Fortschritt und Fehler speichern. Exklusiver Sync-Lock verhindert Überlappung. Dashboard-Aufruf startet keinen Polar-Abruf.

## 4. Normalisierung und Quality

Einheiten und Feldherkunft explizit mappen. Nightly-Herzfrequenz nicht ungeprüft als Resting HR umbenennen. RHR-Definition und HRV-Verfahren vor Algorithmus festlegen. Fehlende Werte bleiben fehlend; keine Null-Imputation.

Zuerst Quality-API, dann kleine Quality-Page: HR-Sampleanzahl, Schlafdauer/Score, Recharge-Verfügbarkeit, Activity-Abdeckung, Trainingsanzahl, letzte erfolgreiche Synchronisation sowie letzter Versuch/Fehler je Bereich. Zustände fresh, stale, unavailable, failed. „Kein Training“ nur nach vollständigem erfolgreichen Abruf des Tages; sonst unbekannt. Abdeckung und Messdatum sichtbar machen.

## 5. Automatisierung vorbereiten

Idempotenten Sync-Einstieg und Scheduler-Vorlage dokumentieren. Noch nicht aktivieren. Nach späterer Autorisierung manuell testen, dann morgen/abends ausführen und Wiederanlauf prüfen. Laptop-Schlaf und fehlende Flow-Synchronisation in Quality anzeigen. Wiederherstellbares lokales Backup vorbereiten.

## 6. Algorithmus nach belastbarer Sammlung

Day 1–7: sammeln und Datenqualität zeigen. Ab 14 gültigen früheren Tagen erste vorläufige Baseline; 30 Tage als reguläres Fenster. Anzahl tatsächlich gültiger Beobachtungen zählt, nicht vergangene Kalendertage. Heutige Messung nie in die eigene Baseline aufnehmen.

Versioniertes deterministisches Modell: robuste persönliche Median-/Streuungsbaseline, gerichtete Abweichungen je Feature, begrenzte Teil-Scores und feste dokumentierte Gewichte. Gewichtsvorschlag zur späteren Prüfung: HRV 25 %, RHR 20 %, Schlafscore/-dauer gemeinsam 25 %, Schlafkonsistenz 10 %, vorherige Trainingsbelastung 10 %, Aktivitäts-/Recovery-Trend 10 %. Schlaf und Recharge nicht doppelt zählen. Gewichte sind Produktannahmen, keine validierte Gesundheitsmessung. Training darf nicht pauschal als schlecht gelten; Definition relativ zur eigenen Belastung festlegen.

Bei unzureichender Baseline kein Gesamtwert. Bei fehlenden Kernfeatures (HRV, definierte RHR, Schlaf) unavailable; optionale Ausfälle nur mit expliziter reduzierter Abdeckung und dokumentierter Gewichtsanpassung. Jede Ausgabe enthält Featurewerte, Baselinefenster/-anzahl, Abweichungen, Teilbeiträge, Eingabe-Referenzen, Version und Quality. Keine LLM-generierten Werte. Trends und Jarvis-Anbindung erst nach dieser Basis.

## Abnahmekriterien vor Day-1-Erfolg

- Simulierte Responses aller sechs Bereiche werden vor Normalisierung unverändert gespeichert; Hash stimmt.
- Neustart und gleicher Sync verdoppeln keine normalisierten Daten.
- Re-Normalisierung aus Raw ohne Polar funktioniert.
- Detailabrufe speichern echte Messwerte, nicht nur Discovery-Daten.
- 401, 429, Timeout und Schemafehler sind getrennt sichtbar; andere Bereiche bleiben nutzbar.
- NULL-Geräte, Tageswechsel und Sommerzeit werden korrekt behandelt.
- Keine Token in Logs/Raw; lokale Geheimnisse sind ignoriert.
- Realer OAuth-/Geräte-Sync wird erst mit später bereitgestellten Zugangsdaten verifiziert.
- Quality-Page im Browser prüfen; keine Baseline und fehlender Schlaf erzeugen keinen erfundenen Score.

Planungsstatus: Diese Kriterien sind noch nicht ausgeführt. Live-Datensammlung und API-Zugang sind noch nicht eingerichtet.
