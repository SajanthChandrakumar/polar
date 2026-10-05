# Polar AccessLink v4 read contracts

Checked on 5 October 2026 against the official [Dynamic API Swagger](https://www.polar.com/polar-api-v4/swagger.yaml), saved verbatim for review as `work/backend/polar-v4.yaml`. The Swagger server is `https://www.polaraccesslink.com/v4/data`. Only the following 21 GET areas are collected; `/hello` is a connectivity example, not a personal-data area.

All ranges are inclusive at the start and exclusive at the end. The initial collection starts at midnight seven calendar days before today in Europe/Zurich and ends at the collection start time today. Each request records its actual parameters. Day boundaries retain Zurich UTC offsets, including daylight-saving changes. Originals returned by Polar are never rewritten.

| Path | OAuth read scope | Parameters and maximum window | Features | Successful response and counted records |
| --- | --- | --- | --- | --- |
| `/user-devices` | `devices:read` | None | None | JSON `devicesData[]`; additional `userDevicesData` preserved |
| `/user/account-data` | `profile:read` | None | None | JSON `accountData` object |
| `/subscriptions` | `user_subscription:read` | None | None | JSON `userSubscriptions.userSubscriptions[]` |
| `/training-sessions/list` | `training_sessions:read` | `from`, `to`; 90 days discovery, one calendar day with features | `samples`, `test-results`, `training-load-report`, `laps`, `hill-splits`, `routes`, `statistics`, `zones`, `pause-times`, `strength-training-results`, `comments`, `physical-info` | JSON `trainingSessions[]` |
| `/activity/list` | `activity:read` | `from`, `to`; 90 days discovery, one calendar day with features | `samples`, `activity-target`, `physical-information` | JSON `activities.activityDays[]` |
| `/calendar/list` | `calendar:read` | Required `from`, `to`; 90 days | `notes`, `feeling`, `feedback`, `perceived-recovery`, `weight`, `physical-information` | JSON `data.entries[]` |
| `/tests/list` | `tests:read` | Required `from`, `to`; 90 days discovery, one calendar day with features | `samples` | JSON `data.tests[]` |
| `/sleep-wake-vectors` | `sleep:read` | Required `from`, `to`; seven days, data retained for 90 days | None | JSON `sleepWakeVectors[]` |
| `/sleeps` | `sleep:read` | Required `from`, `to`; 30 days discovery, one calendar day with features | `sleep-result`, `original-sleep-result`, `sleep-evaluation`, `sleep-score` | JSON `nightSleeps[]` |
| `/ppi-samples` | `ppi_data:read` | Required `from`, `to`; 90 days discovery, one calendar day with features | `samples` | JSON `dailyPpiSamples[]` |
| `/nightly-recharge-results` | `nightly_recharge:read` | Required `from`, `to`; 28 days discovery, one calendar day with features | `samples` | JSON `nightlyRechargeResults.nightlyRechargeResults[]` |
| `/continuous-samples` | `continuous_samples:read` | Required `from`, `to`; 30 days for heart rate | `heart-rate-samples` | JSON `continuousSamples.heartRateSamplesPerDay[]` |
| `/skin-contacts` | `skin_contact:read` | Required `from`, `to`; 90 days | None | JSON `skinContactPeriods[]` |
| `/temperature-measurements` | `temperature_measurement:read` | Required `from`, `to`; 90 days | None | JSON `temperatureMeasurementPeriod[]` |
| `/training-target/calendar-targets` | `training_targets:read` | `fromDate`, `toDate`; descriptions require both; no maximum stated | None | JSON `trainingTarget[]` |
| `/training-target/favorites` | `training_targets:read` | None | None | JSON `favoriteTarget[]` |
| `/routes/{routeId}` | `routes:read` | Required path `routeId`, string `uint64`; no date range | None | JSON `userRoute` object; one per referenced route |
| `/user/profile-picture` | `profile:read` | Required `size`: `small`, `medium`, `large`; all three fetched | None | Binary `image/*`; bytes/metadata, no JSON parsing or invented record count |
| `/sports/profiles` | `sports:read` | None | None | JSON `profiles[]` |
| `/sports/profile-list-catalog` | `sports:read` | None | None | JSON `catalog.lists[]`; count is profile lists, not individual profiles |
| `/sports/list` | `sports:read` | None | None | JSON `sports[]`; static Polar catalogue |

## Discovery, detail and route references

For each feature-bearing endpoint, first archive a request without `features`, then archive requests with every documented feature. The Swagger specifies `collectionFormat: multi`: each feature is a separate repeated query parameter, not a comma-joined string. Endpoints limited to a day receive seven full calendar-day requests plus the current partial day. At exact midnight there is no zero-length request for today. Calendar and continuous samples allow a single feature request spanning the initial period. Sleep/wake vectors split at the seven-day maximum.

The only route references used are the documented `trainingTarget[].exercise[].routeId` and `favoriteTarget[].exercise[].routeId` fields. IDs must be decimal strings in the uint64 range, are deduplicated, and are escaped as one path segment. Other `routeId` keys, links, third-party URLs and invented identifiers are ignored. No reference results in `skipped` with an explicit explanation. The specification says third-party routes such as Komoot/Strava cannot be loaded; returned HTTP errors are preserved and shown.

Counts use only the exact arrays/objects above. Discovery and detail answers describe the same records: the collector sums day-level details when present and does not add the discovery count again. Partial failure makes the count unknown. Counts represent source records (for example days/device-day groups), not individual heart-rate samples. Unknown structures, JSON error objects, invalid JSON and wrong binary content types remain raw and produce `failed`; they do not masquerade as populated or empty. Empty documented lists are successful `empty` answers. Nonempty documented objects count as one; an empty object counts as zero.

## Documented contradictions and live verification still needed

- The global OAuth definition lists only `accesslink.read_all`, while individual operations explicitly list the fine-grained scopes above. The collector and authorization use the operation scopes, rather than silently substituting the broad legacy scope. OAuth consent has not yet confirmed the account's accepted scopes.
- Targets, training sessions and activity describe their date fields as **Required**, but mark them `required: false`. The collector supplies them consistently.
- Date query fields are plain strings described as “Date in ISO 8601 format”; they have no declared `format`, sample value or precision restriction. To include today's elapsed hours without requesting future time, the collector sends ISO 8601 date-times with Zurich offsets. Acceptance of offset date-times is an explicitly unverified interpretation of this specification. If Polar requires date-only values, today's partial interval needs a documented alternative; the implementation must not silently substitute tomorrow as an end timestamp.
- Target range maximum is not specified. Only the initial eight calendar-date period is used; this is not asserted as Polar's maximum.

## Failure and provenance contract

Every actual HTTP response, including 401/429/5xx retry responses and redirects, is saved with raw bytes **before** parsing. All discovery/detail/retry response IDs are attached to the endpoint result. Redirects are never followed. Requests are sequential and restricted to the fixed AccessLink origin and documented paths.

A 401 refreshes once per request; a second 401 is `denied` and asks for reconnection. HTTP 403 is `denied`. HTTP 429 uses Retry-After seconds or HTTP-date, capped at 30 seconds. Transport/timeouts and 5xx retry at most twice. The same retry budget caps 429 and transport/5xx combined; subsequent areas still run. Exceptions and response bodies are not copied into public error messages. A persistence failure or lost database lease propagates and aborts collection; it cannot produce a successful raw-preserving run.
