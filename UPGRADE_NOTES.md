# Exploration and reliability upgrade

Applied to the existing `v1` implementation, preserving its source-slot staffing, remote hauling, construction, and defensive changes. The older reviewed client scripts were not used as the project baseline.

## Changes

- Basic scouts cost 50 energy and use one MOVE part. Dedicated reconnaissance replaces new miner-discovery spawn requests; existing remote miners continue their work.
- One scout per home room by default. Reconnaissance can run once essential workers and defenders are staffed, ahead of optional growth.
- Room-route callbacks are evaluated by `Game.map.findRoute`. The resulting corridor is enforced through supported tile cost callbacks. New threats invalidate cached routes.
- Exit-access information is cached independently for each incoming room. Existing destination-only cache fields are migrated once without clearing ownership, threat observations, or user enable/disable settings.
- Controllerless rooms reveal their exits. Expired observations can be scouted again even if they previously prevented mining.
- Safe observations clear obsolete unsafe deadlines. Repeated sightings during one retreat do not repeatedly multiply its cooldown.
- Scout failures release the assignment with a bounded retry delay. Stationary creeps and missions that keep moving without completing have separate limits.
- Scouts record danger in their current room before changing assignments. Room visits collect intel without requiring travel to the controller.
- Flag1 seeds discovery within the configured exploration radius. Pausing remotes stops scout assignment.
- Claimers retain fresh neutral-room intel when scout vision disappears and revalidate the target when visible.
- Worker counts schedule successors before the current worker expires. Remote source assignment recognizes the replacement overlap.
- Defenders precede optional builders/upgraders. Spawn names include the spawn name to avoid cross-spawn name collisions.
- Repeated movement updates its timestamp for traffic handling.
- Room managers and individual creep execution have error isolation. Construction, labs, markets, and visuals run after core actions and are skipped when CPU headroom or bucket reserves are low.
- `remoteReport()` includes scouting due status, retry time, and the last scouting failure. Recent execution errors are stored in `Memory.runtimeErrors`.

## Defaults and tuning

These settings live in each home room's `Memory.rooms[roomName].remote`:

| Setting | Default | Meaning |
|---|---:|---|
| `maxScouts` | 1 | Maximum scouts belonging to the home room; zero disables new scout spawns |
| `scoutStuckTicks` | 25 | Time without position progress before releasing a mission |
| `scoutMissionTicks` | 300 | Overall mission deadline, including loops and detours |
| `scoutRetryTicks` | 250 | Delay before retrying a failed target |
| `staleRoomTicks` | 1500 | Observation age at which an unseen room needs another visit |
| `exitAccessCacheTicks` | 100 | Lifetime of an observed connection-access result |

Existing user settings are retained. `maxRooms` still controls exploration's linear-distance radius; it has not been redefined as a cap on funded mining operations. Priority flags respect that radius and safety rules.

Replacement lead time is current body spawn time plus estimated travel plus ten ticks. The default travel estimate is 25 ticks locally or 50 ticks per linear room distance remotely. A creep's `memory.replacementTravelTicks` can override it. This is an estimate, not a guarantee under congestion, detours, a busy spawn queue, or a larger replacement body.

Optional work requires a bucket of at least 1,000 and stays below the lower of 85% of baseline CPU or tickLimit minus five. An individual planning call is not preemptible; live profiling is still necessary.

## Verification

Run from the project root with Node:

```text
node --test tests/exploration.test.cjs
```

The suite uses isolated game objects and no network access or game credentials. It checks syntax, state transitions, routing integration, bounded retry behavior, spawning, replacement timing, memory migration, and error isolation. It does not execute the real Screeps pathfinder, simulate combat, or measure live CPU usage.

## Deployment boundary

Only the project source and tests were updated. The client directory under AppData was not synchronized and no server code was uploaded. Deploy all updated modules together, including the new `utils.lifecycle.js`. Use the project's normal deployment workflow, then inspect `remoteReport()` and `Memory.runtimeErrors` during controlled live validation.

Shared empire-wide intel, economic remote scoring, measured hauling throughput, and reservation of GCL slots for concurrent expansion missions remain follow-up work.


## Hostile-room scout retry fix (2026-09-16)

Danger quarantine now lasts for its full cooldown even if an attacker temporarily disappears. Shared warnings cannot be shortened by another colony, and encounter history survives cooldown expiry so a repeated threat increases the delay (5,000 ticks initially, up to 50,000). A safe observation after expiry clears the warning.

Scouting assignments check for a safe room route before selecting a destination, including priority flags and replacement scouts. Unreachable candidates receive the existing scout retry delay while other directions are considered. A destination is no longer exempt from active danger checks. Existing scouts check routes from their current room.

Scouts finish retreating into their home-room interior before taking another mission. Cached movement is cleared when retreat begins and ends, and movement within home stays in that room.

Validation: 46 simulated regression tests, including quiet observations, shared cooldowns, blocked transit, priority flags, replacement scouts, safe detours, cooldown expiry, and border retreat. The real game pathfinder and live combat remain unverified. Deploy the updated manager.remote.js and role.scout.js together using the normal project workflow; this fix does not upload server code or synchronize the AppData client scripts.
