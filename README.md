# Disposable Render ingress probe

This public repository contains only a synthetic HTTP backend and gateway fixture for Plug In's hosting review. It includes no Plug In beta app source, user data, database URL, or production credential. The backend generates a fresh in-memory test secret at startup.

Render service configuration:

- Runtime: Node.js
- Compute plan: Free
- Branch: main
- Build command: `echo disposable-probe-no-build`
- Start command: `node render-probe/server.mjs`
- Auto deploy: off
- Environment variable: `PLUG_PROBE_ORIGIN` set to the exact assigned HTTPS `onrender.com` origin
- Render supplies `PORT`; the fake backend listens on loopback port 5017.

See [the probe checks](render-probe/README.md) before interpreting results. The test does not establish beta sign-in, database isolation, or production readiness. Do not add real credentials or user data here.
