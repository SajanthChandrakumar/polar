# Rohdatenarchiv: Speicherbereinigung

Jeder Polar-Abruf behält eine eigene `raw_api_responses`-ID, Anfrageparameter,
HTTP-Status, Prüfsumme und Abrufzeit. Identische Antwortkörper werden einmal in
GridFS gespeichert. Ein eindeutiger, sparsamer Index auf
`fs.files.metadata.sha256` verhindert auch bei konkurrierenden Uploads doppelte
Körper. Die Bytes werden unverändert gespeichert; verschiedene Abrufe werden
nicht zu einem historischen Ereignis zusammengelegt.

Bestehende inline gespeicherte Antworten und ältere GridFS-Dateien bleiben lesbar.
Die einmalige Bereinigung nutzt das bereits vorhandene Feld `body_gridfs_id`,
das auch ältere Serverstände lesen können. Die dauerhafte Vermeidung neuer
Mehrfachspeicherung erfordert den aktualisierten Serverstand. Die Polar-Abfragen
bleiben unverändert, damit nachträgliche Korrekturen weiterhin erfasst werden.

## Ablauf

Vom Projektverzeichnis aus, mit der bestehenden privaten `.env`:

```sh
# Nur Bestand lesen; ohne Schreiboption wird nichts verändert.
PYTHONPATH=apps/api .venv/bin/python scripts/compact_archive.py

# Ein neues, privates Sicherungsverzeichnis anlegen und vollständig prüfen.
PYTHONPATH=apps/api .venv/bin/python scripts/compact_archive.py --backup-only --backup-dir data/backups/archive-2026-10-17

# Ausschliesslich Antworten aus dieser geprüften Sicherung umstellen.
PYTHONPATH=apps/api .venv/bin/python scripts/compact_archive.py --apply --backup-dir data/backups/archive-2026-10-17

# Bytes, Metadaten, Abrufhistorie und alle Antwortverweise gegenprüfen.
PYTHONPATH=apps/api .venv/bin/python scripts/compact_archive.py --verify --backup-dir data/backups/archive-2026-10-17
```

Die Sicherung enthält rohe BSON-Dokumente in `archive.bson.gz` und eine
Prüfsummen-/Zählungsdatei `manifest.json`. Gesichert werden Rohantworten,
GridFS-Dateien und -Blöcke, Abrufläufe, Endpunktergebnisse und die Abrufsperre.
Authentifizierungssammlungen werden nicht verändert und sind nicht Bestandteil
dieser Archivsicherung. Die Sicherung enthält private Gesundheitsdaten; ihr
Verzeichnis erhält Modus 0700 und die Archivdatei Modus 0600. Ein vorhandenes
Sicherungsverzeichnis wird nicht überschrieben.

Während Sicherung, Umstellung und Prüfung verhindert die bestehende Abrufsperre
weitere Sammlungen. Aktive Abrufe werden abgewiesen, abgelaufene Abrufe vorher
korrekt als unterbrochen abgeschlossen. Eine eigene Sperrkennung schützt vor
veralteten Sammlern und wird regelmässig verlängert. Die frühere Sperre wird
anschliessend nur bei unverändertem Eigentümer wiederhergestellt.

Vor der Umstellung werden alle Sicherungsdokumente gelesen und geprüft,
einschliesslich der Rekonstruktion von GridFS-Körpern und historischer Verweise.
Der gemeinsame Körper wird vor dem Entfernen des inline gespeicherten Körpers
aus MongoDB zurückgelesen und byteweise verglichen. Antwortdokumente und ihre
IDs werden nicht gelöscht. Eine unterbrochene Umstellung kann mit derselben
Sicherung erneut gestartet werden; bereits umgestellte Antworten bleiben lesbar.

Die Verifikation erlaubt zusätzliche spätere Abrufe, verlangt aber unveränderte
gesicherte Antwortmetadaten und historische Abrufdokumente. Bei einer erneuerten
Singleton-Sperre werden die historischen Ergebnisse in den erhaltenen
Abrufdokumenten geprüft. Ein ursprünglich laufender, inzwischen abgelaufener
Abruf darf dabei ausschliesslich gemäss der bestehenden Wiederherstellung als
unterbrochen abgeschlossen werden; seine unveränderlichen Metadaten und die
in der Sicherung festgehaltenen Teilergebnisse müssen übereinstimmen.

## Ausnahme: Atlas blockiert bereits alle Schreibzugriffe

Bei überschrittener Speicherquote kann selbst die Abrufsperre nicht mehr
geschrieben werden. Die reguläre Umstellung benötigt zuerst etwas Platz.
Eine vollständige, rein lesend erstellte und geprüfte Sicherung muss bereits
vorliegen. Für diese Ausnahme existiert:

```sh
PYTHONPATH=apps/api .venv/bin/python scripts/compact_archive.py --bootstrap-quota --backup-dir data/backups/archive-2026-10-17
PYTHONPATH=apps/api .venv/bin/python scripts/compact_archive.py --apply --backup-dir data/backups/archive-2026-10-17
PYTHONPATH=apps/api .venv/bin/python scripts/compact_archive.py --verify --backup-dir data/backups/archive-2026-10-17
```

Der erste Schritt prüft, dass keine aktive Abrufsperre besteht und der aktuelle
Bestand vollständig zur Sicherung passt. Er sucht mindestens 40 MB an grossen,
unreferenzierten Duplikaten mit einer weiterhin referenzierten Kopie desselben
Endpoints. Diese überlebende Kopie wird byteweise gegen die Sicherung geprüft.
Ein dauerhaft geschriebenes Journal bindet die geplanten IDs an die Prüfsumme
der Sicherung. Erst danach werden diese Dokumente mit einem Vergleich aller
Originalfelder einschliesslich Originalbytes vorübergehend entfernt. Eindeutige
Körper und referenzierte Dokumente sind ausgeschlossen.

Die unmittelbar folgende Umstellung stellt fehlende Journal-IDs mit ihren
ursprünglichen Metadaten und gemeinsamen Körpern wieder her. Der Endzustand
enthält wieder sämtliche ursprünglichen Antwort-IDs. Nach einem Abbruch vor
ausreichender Platzfreigabe wird zuerst derselbe Bootstrap-Befehl erneut
aufgerufen; er prüft und verwendet das vorhandene Journal weiter. Sobald die
normale Umstellung begonnen hat, wird diese mit `--apply` fortgesetzt.

Die logische Datenmenge sinkt. Bereits zugewiesene MongoDB-Speicherseiten können
für spätere Schreibvorgänge verfügbar bleiben; das Werkzeug führt keine
Collection-Löschung und keinen physischen Compact-Befehl aus.
