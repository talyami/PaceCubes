# YAMI CUBE RUSH deployment notes

Target: Hostinger VPS `31.97.182.123`; passwordless SSH user `samantha`.

## Production layout
- Static frontend: `/home/villa.linkflow.page/public_html/yamicuberush/`
- Backend bundle: `/opt/yamicuberush/server.js`
- Environment: `/opt/yamicuberush/.env` (mode 0600)
- systemd unit: `yamicuberush.service`
- Internal backend: `0.0.0.0:8091`
- OpenLiteSpeed public WebSocket proxy: `/yamicuberush/ws` -> `127.0.0.1:8091`
- Live URL: `https://villa.linkflow.page/yamicuberush/`

## Capacity
- `MAX_ROOMS=100`: room identifiers are `00` through `99`, so 100 is the hard supported capacity.
- `MAX_SOCKETS=600`: independent connection ceiling.

## Release procedure
1. Run `npm run ci` locally.
2. Create timestamped frontend/backend archives under `/home/samantha/yamicuberush-backups/`.
3. Upload bundles to `/home/samantha/yamicuberush-stage/`.
4. Install backend and copy static assets into production paths.
5. Restart `yamicuberush.service` and verify it is active.
6. Verify the live HTTP endpoint and WebSocket room creation. Visual browser acceptance is performed by the owner.

## Rollback
Restore the matching timestamped archives from `/home/samantha/yamicuberush-backups/`, restart `yamicuberush.service`, then verify HTTP and WebSocket health.
