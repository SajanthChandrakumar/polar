# Archivierte Verläufe und Tagesfeedback

Die private Schnittstelle `GET /api/analytics?days=7|30|90` liest vorhandene erfolgreiche Polar-Antworten aus MongoDB/GridFS. Sie startet keinen Polar-Abruf. Standard: 30 Tage, Kalenderzone Europe/Zurich. Die bestehenden sechs Kreise und der Datenabruf bleiben erhalten. Die Archivabfrage wird auf das gewählte Zeitfenster plus 28 Vergleichstage begrenzt; unveränderte Antwortkörper werden nur in ihrer neuesten Version gelesen.

Fünf getrennte Reihen zeigen Schlafdauer (Minuten), durchschnittlichen Puls (bpm), ANS-Status, Schritte und aufsummierte Trainingsdauer (Minuten). Fehlende Messungen bleiben null; belegte Nullwerte bleiben nullwertige Messungen. Discovery und Details sowie wiederholte Abrufe werden zusammengeführt; korrigierte detailreiche Datensätze ersetzen ältere Versionen in der Auswertung. Die Rohantworten bleiben unverändert.

Jeder Tageswert wird mit dem Median seiner vorherigen 28 Kalendertage verglichen. Mindestens sieben verschiedene gültige Vergleichstage sind erforderlich. Der Zieltag wird ausgeschlossen. ANS-Differenzen sind Punkte, keine Prozente. Tagesstände für Puls, Schritte und Training gelten vorläufig, bis eine nach Tagesende archivierte Antwort vorliegt. Vorläufige Werte bleiben im Diagramm, zählen aber nicht als Vergleichstage.

Diagramme zeigen Datenabdeckung, Lücken, Datum, Einheit und verknüpfte Originalantworten. 90 Tage bedeuten die vorhandene Archivhistorie; es gibt keine automatische Nachladung. Weitere Messfelder sowie Geräte-, Konto- und Kataloginformationen bleiben in durchsuchbaren, paginierten Tabellen je Originalantwort erreichbar. Unbekannte Einheiten werden nicht geraten.

Die Auswertung erklärt statistische Unterschiede. Sie vergibt keinen Gesundheitsscore und keine Trainings- oder medizinischen Empfehlungen. Bei zu wenig Daten zeigt sie vorhandene und benötigte Vergleichstage.

## Bewegung und Ergebnis der folgenden Nacht

Das Recovery Lab vergleicht archivierte Bewegung mit Schlafdauer oder ANS-Status in der unmittelbar folgenden Kalendernacht in `Europe/Zurich`. Der private Endpunkt `GET /api/patterns?days=30|90&outcome=sleep|ans` ist authentifiziert und nur lesend. Er verwendet die bestehende Tageskorrektur und Normalisierung erfolgreicher Rohantworten; er startet weder eine Polar-Abfrage noch einen Schreibvorgang. Die gemeinsame `PatternExplorer`-Ansicht erhält die privaten Daten über `PatternLive`.

Die [öffentliche Demo](https://polarhealth.onrender.com/demo) rendert vor der privaten App einen eigenen Einstieg und liest vier fest gebündelte synthetische Ergebnisse. Die Steuerelemente wählen zwischen 30 oder 90 Nächten und Schlaf oder ANS. Sie machen keine API-, Session-, Dashboard-, Sync-, Polar- oder Datenabrufe. Alle Beispiele sind frei erzeugte Werte für den festen Zeitraum 3. Juli bis 30. September 2026; Quellreferenzen werden vor dem Bündeln geleert. Regeneration aus dem Projektstamm:

```sh
PYTHONPATH=apps/api .venv/bin/python scripts/generate_pattern_demo.py
```

Der Generator übergibt normalisierte synthetische Punkte an dieselbe reine `calculate_patterns`-Berechnung wie der private Endpunkt. Damit bleiben Gruppierung, Tagesgrenzen und Zusammenfassungen zwischen Demo und Backend gleich.

Die Aktivität wird dem Ergebnis der nächsten Kalendernacht zugeordnet. Die Median-Grenze wird aus allen verfügbaren, nicht vorläufigen Bewegungstagen des verschobenen Zeitfensters berechnet, auch wenn für deren Folgetag kein Ergebnis vorliegt. Unterhalb der Grenze liegt die untere Gruppe; Werte an oder oberhalb davon bilden die obere Gruppe. Schlafwerte müssen nicht negativ sein, ANS-Werte dürfen negativ sein. Null Schritte bleiben gültig. Fehlende beziehungsweise ungültige Bewegungswerte, vorläufige Bewegungstage und fehlende beziehungsweise ungültige Nachtwerte werden getrennt gezählt.

Erst bei mindestens sieben vollständigen Paaren in **beiden** Gruppen werden Median und inklusive Quartile für beide Gruppen angezeigt. Weniger Daten bleiben als Punkte und Gruppengrößen sichtbar. Quartile beschreiben die beobachtete Streuung, kein Konfidenzintervall. Vollständigkeit eines archivierten Tages beweist weder Tragezeit noch vollständige Sensorabdeckung. Ergebnisse sind beschreibend und belegen keine Ursache; sie sind keine Prognose, Gesundheitsbewertung oder medizinische Empfehlung.

Private Paare benötigen vollständige, gültige Archivmessungen; die aktuelle Abdeckung ist hier nicht verifiziert. Die öffentliche Demo verwendet synthetische Daten und ersetzt keine fehlenden privaten Messungen.

## Dein Tag und Erholungsbewertung

`daily_recovery` ergänzt die bestehende Analytics-Antwort um einen Eintrag je Kalendertag des ausgewählten Zeitraums: `date`, `value` (Ganzzahl 1–6 oder null), `reason` (`available`, `missing`, `invalid`), `source_path` und `response_ids`. Die Bewertung stammt ausschließlich aus dem archivierten Polar-Feld `recoveryIndicator`, aus derselben neuesten detailreichen Tagesantwort wie die ANS-Reihe. Korrigierte Antworten ersetzen ältere Auswertungen; Discovery-Antworten verdrängen keine vorhandenen Messungen.

Die Oberfläche gruppiert Polars sechs aufsteigende Erholungsstufen: 5–6 als „🙂 Gut erholt“, 4 als „😐 Erholung okay“, 1–3 als „🙁 Schwächer erholt“. „Warum diese Rückmeldung?“ zeigt die genaue Stufe und die Originalquelle. Grundlage: [Polar AccessLink v4](https://www.polar.com/polar-api-v4/) (`recoveryIndicator` 1–6) und [Polar Nightly Recharge](https://support.polar.com/en/nightly-recharge-recovery-measurement) (sechs Stufen von very poor bis very good). Fehlende, unbekannte oder ungültige Stufen, einschließlich 0, bleiben neutral und erzeugen keine negative Bewertung. Die Erholungsbewertung ist kein selbst berechneter Gesamtscore.

Die Startseite zeigt zuerst „Dein Tag“, danach die sechs Kreise und „Dein Verlauf“. Heute ist vorausgewählt; frühere Tage tragen ihr tatsächliches Datum. Tagesstände bleiben vorläufig. Vergleichsbasis, Quellen und Original-JSON sind standardmäßig zugeklappt und weiterhin per Tastatur und Touch erreichbar. Die Diagramme bieten zusätzlich eine Datumsauswahl. Originaldaten und Messkurven lösen keine neuen Polar-Anfragen aus.

Tests: Tagesgrenzen/DST, Dubletten, Korrekturen, mehrere Trainings pro Tag, Nullwerte/Lücken, Median und Mindesthistorie, vorläufige Tagesstände, private API ohne Collection, Zeitraumwechsel, Punktdetails/Originalantworten, Abbruch bei Abmeldung und Tabellenpagination.
