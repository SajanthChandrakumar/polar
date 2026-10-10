# Polar Health Analytics: Dashboard zuerst

Stand: 5. Oktober 2026. Freigegebener Umsetzungsplan. Dashboard, privater Zugang, OAuth, Raw-Speicherung, Collector und Abruf beim Seitenstart sind implementiert. Lokale Abnahme und simulierte Vertrags-/Fehlertests vorhanden; echte Polar-Zustimmung, Live-Datenabnahme und Render-Deployment bleiben ausstehend.

## Ziel und Grenzen

Zuerst ein nutzbares privates Dashboard erstellen. Anschließend alle 19 dokumentierten Daten-Endpunkte und deren Detailfeatures mit dem verbundenen Polar-Konto abrufen, unverändert archivieren und sichtbar prüfen. Keine eigenen Readiness-Scores, kein Scheduler und keine umfangreiche Normalisierung im ersten Stand.

React, TypeScript und Vite für das Dashboard; Python/FastAPI, HTTPX und PyMongo für das Backend. FastAPI liefert den Frontend-Build aus. Ein Render-Web-Service, bestehender Atlas-Cluster, separate Datenbank polar_health_analytics. Keine zusätzliche Infrastruktur für den ersten Stand.

## 1. Dashboard mit klar gekennzeichneten Beispieldaten

- Kompakte deutsche Oberfläche, nutzbar auf Handy und Desktop, helle Grundfläche und wenige Akzentfarben.
- Kopfbereich: Polar-Verbindung, letzter Abruf, laufender Abruf und Zeitraum. Schaltflächen: „Mit Polar verbinden“ und „Daten abrufen“.
- Übersicht: Herzfrequenz, Schlaf, Nightly Recharge, Aktivität, Training und Gerät. Vor realen Daten erscheinen leere Zustände, keine erfundenen Kennzahlen.
- Bereich „Datenquellen“: 19 Endpunkte mit Status, letzter Anfrage, HTTP-Status, Datensatzanzahl soweit eindeutig bestimmbar und Fehlermeldung. Statische Kataloge werden getrennt von persönlichen Messungen dargestellt.
- Detailansicht: Anfragezeitraum, angeforderte Features, Herkunft und formatierte Antwort. Für Binärantworten Dateityp und Größe; kein JSON-Parsen von Bildern.
- Entwicklungsbeispiele sind synthetisch, sichtbar markiert und werden niemals in den echten Datenspeicher übernommen.
- Erste Abnahme: Dashboard im Browser inklusive leerem, ladendem und fehlerhaftem Zustand prüfen.

## 2. Privater Zugriff, Polar-Verbindung und MongoDB

- Ein privater Besitzerzugang mit Passwort aus der Serverkonfiguration und signiertem HttpOnly-Session-Cookie. Auf Render zusätzlich Secure, SameSite=Lax. Keine offene Registrierung. Passwort und Cookies nie in Logs.
- OAuth Authorization Code Flow mit zufälligem, einmaligem state und serverseitigem Token-Austausch. Tokens bleiben serverseitig geschützt. Alle benötigten lesenden Scopes explizit aus dem Endpoint-Inventar ableiten.
- Lokal den registrierten Callback http://localhost:5000/oauth2_callback verwenden. Für Render später eine zusätzliche exakt passende HTTPS-Callback-URL registrieren.
- MongoDB-Collections: raw_api_responses, sync_runs, sync_endpoint_results und geschützte oauth_tokens. Zusätzliche Messwert-Collections erst nach Sichtung tatsächlicher Responses.
- Rohkörper vor Parsing speichern: Binärdaten, SHA-256, Endpoint, bereinigte Parameter, HTTP-Status, Content-Type, fetched_at und sync_run_id. Große Körper, die das MongoDB-Dokumentlimit überschreiten würden, über GridFS speichern. Metadaten referenzieren dann den gespeicherten Körper.
- Token-Antworten sind kein Raw-Datensatz. Keine Authorization-Header, Secrets oder Tokens an den Browser senden.
- Ohne MongoDB-Verbindung oder erfolgreiche Raw-Speicherung keinen Lauf als erfolgreich melden.

## 3. Alle Endpunkte kontrolliert testen

- Vor Code die 19 Request-Verträge anhand offizieller Dokumentation/Spezifikation festhalten: GET-Pfad, Scope, Pflichtparameter, Features, Zeitfenster und erwarteter Antworttyp. Dokumentationswidersprüche explizit prüfen.
- Zuerst Geräte und Konto, danach persönliche Messbereiche, Ziele/Favoriten und zuletzt referenzierte Routen sowie Katalogdaten abrufen. Keine erfundenen Route-IDs; ohne Referenz wird der Route-Abruf als übersprungen erklärt.
- Der erste Zeitraum umfasst die letzten sieben Kalendertage plus heute in Europe/Zurich. Originale Zeitzonen erhalten; Grenzen jedes Endpunkts beachten. Im Dashboard kann später innerhalb der dokumentierten Abfragegrenzen ein anderer Zeitraum gewählt werden.
- Discovery-Listen und Detailantworten separat archivieren. Alle dokumentierten Features abrufen; bei Endpunkten mit Tageslimit pro Tag abfragen. Große Antworten nicht still abschneiden.
- Fehlende Daten sind ein gültiges Ergebnis. Unterscheiden: noch nicht geprüft, läuft, Daten vorhanden, erfolgreich leer, Zugriff verweigert, technisch fehlgeschlagen und mit Grund übersprungen. Aus einer leeren Antwort keine fehlende Geräteunterstützung ableiten.
- Pro Endpunkt Fehler isolieren. 401: einmal Refresh versuchen, danach Verbindung als erneuerungsbedürftig markieren. 403: Berechtigungsproblem sichtbar machen. 429: Retry-After berücksichtigen. Timeouts/5xx: höchstens zwei Wiederholungen; anschließend nächster Bereich. Ungültiges JSON bleibt als Raw erhalten.
- API nimmt nur bekannte Endpoint-Schlüssel und validierte Zeiträume entgegen; keine beliebigen URLs oder beliebigen Weiterleitungen abrufen.

## 4. Abruf beim Öffnen der Seite

- Zuerst gespeicherte Daten anzeigen. Nach authentifiziertem Laden des Dashboards einen POST-Sync anfordern; normale GET-Datenabfragen lösen keine Polar-Aufrufe aus.
- Automatisch nur starten, wenn kein Lauf aktiv ist und der letzte automatische Versuch mindestens 15 Minuten zurückliegt. Manuelles „Daten abrufen“ umgeht die Wartezeit, aber nicht den Sync-Lock.
- Ein MongoDB-Lock mit atomarer Übernahme und Ablaufzeit verhindert parallele Läufe. Laufende Aufgaben verlängern den Lock; verlorene Locks und Serverneustarts werden als unterbrochener Lauf sichtbar. Der nächste Seitenaufruf darf einen neuen Lauf starten.
- Kurzer POST liefert eine Lauf-ID; das Dashboard fragt den Laufstatus alle zwei Sekunden ab, solange er aktiv ist. Der Prozess führt die Requests sequenziell aus. Render-Neustarts können einen Lauf unterbrechen; bereits gespeicherte Raw-Daten bleiben in Atlas erhalten.
- Minimale API: POST /api/login, POST /api/logout, GET /api/polar/authorize, GET /oauth2_callback, GET /api/dashboard, GET /api/endpoints, POST /api/sync, GET /api/sync/{run_id}, GET /api/responses/{response_id}. Alle Daten-/Sync-Routen benötigen die Besitzersession; Callback benötigt gültigen OAuth-state.

## 5. Prüfung und erster Live-Durchlauf

- Browserprüfung auf Handy- und Desktopbreite: Login, leere Übersicht, Verbindung, laufender Abruf, Teilerfolg, erneute Anmeldung und Detailansicht.
- Synthetische Antworten für alle 19 Endpunkte: Rohbytes und Hash nach Speicherung identisch, JSON- und Binärantworten korrekt behandelt; große Antwort über GridFS wiederherstellbar.
- Fehlerszenarien: 401, 403, 429, Timeout, 5xx, ungültiges JSON und MongoDB-Ausfall. Erfolgreiche andere Bereiche bleiben sichtbar. Keine Credentials in Raw, API-Antworten oder Logs.
- Zwei gleichzeitig geöffnete Tabs starten nur einen Lauf. Neustart zeigt unterbrochenen Lauf und erlaubt Wiederholung. Tagesgrenzen und Sommerzeit korrekt verarbeiten.
- Erst nach lokalem Funktionstest Render-Konfiguration vorbereiten. Zugangsdaten werden separat lokal beziehungsweise bei Render eingerichtet; niemals im Repo oder Chat.
- Live-Abnahme mit dem Loop-Konto: Für jeden der 19 Bereiche einen tatsächlichen Status mit Begründung zeigen. Kein Datenbereich muss gefüllt sein, damit der Test erfolgreich ist; jeder muss nachvollziehbar geprüft oder mangels nötiger Referenz übersprungen sein.
- Abschlussbericht: tatsächlich erhaltene Felder, Zeiträume, Gerätebezüge und Samples sowie leere/gesperrte Bereiche. Erst daraus den nächsten Analytics-Schritt ableiten.

## Reihenfolge und Fertigstellung

1. Sichtbares Dashboard mit synthetischen Zuständen.
2. Privater Zugriff, OAuth und dauerhafte Raw-Speicherung.
3. Collector für alle Endpunkte und Detailfeatures.
4. Automatischer Abruf beim Seitenstart.
5. Browserprüfung und autorisierter Live-Test.

GitHub-Repo: https://github.com/SajanthChandrakumar/polar. Das Repo wurde vom Nutzer erstellt und ist öffentlich. Nur Quellcode und Dokumentation hochladen; keine Gesundheitsdaten oder Zugangsdaten. Dieser Plan autorisiert keine Bereitstellung von Secrets und keine OAuth-Zustimmung; diese erfolgen gesondert während der späteren Einrichtung.

Am 7. Oktober 2026 wurden Profilbild und Profilreihenfolge auf Nutzerwunsch entfernt. Sechs Live-Karten werden jetzt aus den archivierten Antworten abgeleitet; fehlende Felder bleiben unavailable, ältere Messungen stale.
