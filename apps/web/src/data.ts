export type Status = 'pending' | 'loading' | 'populated' | 'empty' | 'failed' | 'denied' | 'skipped';
export type Source = { name: string; path: string; group: 'Messungen' | 'Konto & Planung' | 'Kataloge'; features: string; limit: string; status: Status; payload: unknown; count: number | null; message?: string; binary?: boolean };
export const DEMO_TIME = '03.10.2026, 09:00';
export const DEMO_PERIOD = '26.09.–03.10.2026';
export const statusLabels: Record<Status, string> = { pending: 'Noch nicht geprüft', loading: 'Abruf läuft', populated: 'Daten vorhanden', empty: 'Erfolgreich leer', failed: 'Fehlgeschlagen', denied: 'Zugriff verweigert', skipped: 'Übersprungen' };
const measurements = 'Messungen', planning = 'Konto & Planung', catalogs = 'Kataloge';
// These are illustrative fixtures, not verified Polar response schemas.
const records: [string, string, Source['group'], string, string, unknown][] = [
  ['Geräte', '/user-devices', measurements, 'Geräte', 'Ohne Zeitfilter', [{ device: 'Beispielgerät', type: 'Polar Loop Gen 2', synthetic: true }]],
  ['Aktivität', '/activity/list', measurements, 'samples, activity-target, physical-information', 'Discovery: 90 Tage · Details: 1 Tag', [{ date: '2026-10-02', steps: 8420, activeMinutes: 76, samples: [{ time: '12:00:00+02:00', steps: 3420 }, { time: '20:00:00+02:00', steps: 5000 }] }]],
  ['Herzfrequenz', '/continuous-samples', measurements, 'heart-rate-samples', '30 Tage je Anfrage', [{ date: '2026-10-02', samples: [{ time: '04:00:00+02:00', bpm: 62 }, { time: '04:05:00+02:00', bpm: 58 }, { time: '04:10:00+02:00', bpm: 56 }, { time: '04:15:00+02:00', bpm: 59 }, { time: '04:20:00+02:00', bpm: 55 }] }]],
  ['Schlaf', '/sleeps', measurements, 'sleep-result, original-sleep-result, sleep-evaluation, sleep-score', 'Discovery: 30 Tage · Details: 1 Tag', [{ start: '2026-10-02T23:10:00+02:00', end: '2026-10-03T06:52:00+02:00', durationMinutes: 462 }]],
  ['Schlaf-Wach-Verlauf', '/sleep-wake-vectors', measurements, 'Schlaf-Wach-Vektoren', '7 Tage · Historie: letzte 90 Tage', [{ date: '2026-10-03', vectors: [{ state: 'sleep', start: '23:10', end: '06:52' }] }]],
  ['Nightly Recharge', '/nightly-recharge-results', measurements, 'samples', 'Ohne Features: 28 Tage · Details: 1 Tag', [{ date: '2026-10-03', ansCharge: 0.8, samples: [] }]],
  ['Pulsintervalle', '/ppi-samples', measurements, 'samples', 'Discovery: 90 Tage · Details: 1 Tag', []],
  ['Hautkontakt', '/skin-contacts', measurements, 'Hautkontakte', '90 Tage je Anfrage', [{ date: '2026-10-02', contact: true }]],
  ['Hauttemperatur', '/temperature-measurements', measurements, 'Temperaturmessungen', '90 Tage je Anfrage', { error: 'Simulierter Serverfehler. Erneuter Demo-Abruf möglich.' }],
  ['Tests', '/tests/list', measurements, 'samples', 'Ohne Features: 90 Tage · Details: 1 Tag', []],
  ['Training', '/training-sessions/list', measurements, 'samples, test-results, training-load-report, laps, hill-splits, routes, statistics, zones, pause-times, strength-training-results, comments, physical-info', 'Ohne Features: 90 Tage · Details: 1 Tag', [{ date: '2026-10-02', sport: 'Walking', durationMinutes: 42, route: null }]],
  ['Kalender', '/calendar/list', planning, 'notes, feeling, feedback, perceived-recovery, weight, physical-information', '90 Tage je Anfrage', []],
  ['Trainingsfavoriten', '/training-target/favorites', planning, 'Favoriten', 'Ohne Zeitfilter', []],
  ['Trainingsziele', '/training-target/calendar-targets', planning, 'fromDate, toDate', 'Gewählter Zeitraum', []],
  ['Routen', '/routes/{routeId}', planning, 'Nur referenzierte Routen aus Zielen/Favoriten', 'Einzelne Route · keine Drittanbieter-Routen', null],
  ['Profilreihenfolge', '/sports/profile-list-catalog', planning, 'Profilreihenfolge', 'Persönliche Profilkonfiguration', [{ id: 'demo-walking', order: 1 }]],
  ['Sportprofile', '/sports/profiles', planning, 'Profile', 'Ohne Zeitfilter', [{ sport: 'Walking', name: 'Beispielprofil' }]],
  ['Sportarten', '/sports/list', catalogs, 'Sportkatalog', 'Statischer Katalog', [{ id: 'demo-walking', name: 'Walking' }]],
  ['Konto', '/user/account-data', planning, 'Kontodaten', 'Ohne Zeitfilter', { name: 'Synthetisches Beispielkonto', timezone: 'Europe/Zurich' }],
  ['Profilbild', '/user/profile-picture', planning, 'small, medium, large', 'Ohne Zeitfilter', { contentType: 'image/png', bytes: 2048, size: 'medium', synthetic: true }],
  ['Abonnements', '/subscriptions', planning, 'Abonnements', 'Ohne Zeitfilter', { error: 'Simulierter Berechtigungsfehler. Zugang nicht geprüft.' }],
];
export const sources: Source[] = records.map(([name, path, group, features, limit, payload]) => ({ name, path, group, features, limit, payload, binary: name === 'Profilbild', count: Array.isArray(payload) ? payload.length : payload === null ? null : 1, status: name === 'Hauttemperatur' ? 'failed' : name === 'Abonnements' ? 'denied' : name === 'Routen' ? 'skipped' : Array.isArray(payload) && payload.length === 0 ? 'empty' : 'populated', message: name === 'Routen' ? 'Keine Route-ID aus Zielen oder Favoriten vorhanden; Anfrage übersprungen.' : undefined }));
export function sourceStatus(source: Source, demo: boolean, loading: boolean): Status {
  if (source.path === '/routes/{routeId}') return 'skipped';
  if (!demo) return 'pending';
  return loading ? 'loading' : source.status;
}
