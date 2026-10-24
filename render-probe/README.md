# Disposable Render ingress probe

This package contains a fake backend and a gateway with an in-memory synthetic credential. No Plug In beta source, users, Neon URL, or production credential belongs here. It is a review fixture, not a beta deployment.

Render's web-service documentation says its load balancer forwards one public HTTP port, redirects external HTTP to HTTPS, and supports additional ports for private networking. The actual behavior must still be verified for this service. Set `PLUG_PROBE_ORIGIN` to its assigned canonical HTTPS `onrender.com` origin and run `npm start` from the `gateway-review/render-probe` directory with `../gateway.mjs` available. Render supplies `PORT` to the gateway. Do not create or publish a service until the owner reviews the free-tier terms and any billing settings.

If later deployed as a bounded fake-only test, check:

1. HTTPS `/probe` returns `{ "probe": "through-gateway" }`.
2. Public attempts to reach `:5017` never produce the fake backend response, even with forged `x-forwarded-proto: https`, canonical Host, and a caller proxy header.
3. Plain HTTP requests, including those with forged forwarding headers, are redirected by the platform or rejected before reaching the gateway. Record the full URL, status, and response headers without credentials.
4. Compare the service's effective inbound port configuration; do not infer isolation from source code or a successful HTTPS request alone.

If any direct route reaches the fake backend, stop. Even if all checks pass, this does not establish beta sign-in, database, secret separation, or continuous availability. Free services may sleep or be suspended under usage limits.
