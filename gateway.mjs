import http from 'node:http'
import https from 'node:https'

const ORDINARY_LIMIT = 16_384
const BACKUP_LIMIT = 5 * 1024 * 1024 + ORDINARY_LIMIT
const PASS_REQUEST = new Set(['accept', 'accept-language', 'authorization', 'content-type', 'origin', 'user-agent'])
const PASS_RESPONSE = new Set(['cache-control', 'content-type', 'content-length', 'x-content-type-options', 'referrer-policy'])

function port(value) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1 || number > 65535) throw new Error('GATEWAY_CONFIG_INVALID')
  return number
}

export function validateConfig(input) {
  let origin
  try {
    origin = new URL(input.origin)
  } catch {
    throw new Error('GATEWAY_CONFIG_INVALID')
  }
  if (origin.protocol !== 'https:' || !origin.hostname.includes('.') || origin.username || origin.password ||
      origin.port || origin.pathname !== '/' || origin.search || origin.hash || input.origin !== origin.origin) {
    throw new Error('GATEWAY_CONFIG_INVALID')
  }
  if (typeof input.proxySecret !== 'string' || !/^[\x21-\x7e]{32,512}$/.test(input.proxySecret)) {
    throw new Error('GATEWAY_CONFIG_INVALID')
  }
  const gatewayPort = port(input.gatewayPort)
  const backendPort = port(input.backendPort)
  if (gatewayPort === backendPort || !['127.0.0.1', '0.0.0.0'].includes(input.bindHost)) {
    throw new Error('GATEWAY_CONFIG_INVALID')
  }
  if (!['direct-tls', 'platform-tls'].includes(input.mode ?? 'direct-tls')) {
    throw new Error('GATEWAY_CONFIG_INVALID')
  }
  const mode = input.mode ?? 'direct-tls'
  if (mode === 'direct-tls' && (typeof input.tlsKey !== 'string' || !input.tlsKey.includes('PRIVATE KEY-----') ||
      typeof input.tlsCert !== 'string' || !input.tlsCert.includes('CERTIFICATE-----'))) {
    throw new Error('GATEWAY_CONFIG_INVALID')
  }
  return { origin: origin.origin, expectedHost: origin.host, proxySecret: input.proxySecret,
    gatewayPort, backendPort, bindHost: input.bindHost, tlsKey: input.tlsKey, tlsCert: input.tlsCert, mode }
}

function reply(res, status) {
  if (res.headersSent) return res.destroy()
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff' })
  res.end(JSON.stringify({ error: 'REQUEST_REJECTED' }))
}

export function createGateway(input) {
  const config = validateConfig(input)
  const handler = (incoming, outgoing) => {
    if (config.mode === 'direct-tls' && !incoming.socket.encrypted ||
        config.mode === 'platform-tls' && incoming.headers['x-forwarded-proto'] !== 'https') {
      reply(outgoing, 403)
      incoming.resume()
      return
    }
    const rawPath = incoming.url ?? ''
    let parsed
    try { parsed = new URL(rawPath, config.origin) } catch { /* handled below */ }
    if (incoming.headers.host?.toLowerCase() !== config.expectedHost.toLowerCase() ||
        !rawPath.startsWith('/') || rawPath.startsWith('//') || rawPath.includes('\\') ||
        rawPath.includes('#') || /[\r\n]/.test(rawPath) || parsed?.origin !== config.origin) {
      reply(outgoing, 403)
      incoming.resume()
      return
    }
    const limit = incoming.method === 'POST' && parsed.pathname === '/api/backups'
      ? BACKUP_LIMIT : ORDINARY_LIMIT
    const declared = incoming.headers['content-length']
    if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
      reply(outgoing, 413)
      incoming.resume()
      return
    }
    const chunks = []
    let bytes = 0
    incoming.on('data', chunk => {
      bytes += chunk.length
      if (bytes > limit) {
        reply(outgoing, 413)
        incoming.removeAllListeners('data')
        incoming.resume()
      } else chunks.push(chunk)
    })
    incoming.on('end', () => {
      if (bytes > limit || outgoing.destroyed) return
      const headers = { host: config.expectedHost, 'x-forwarded-proto': 'https',
        'x-plug-proxy-authorization': config.proxySecret }
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (PASS_REQUEST.has(key) && typeof value === 'string') headers[key] = value
      }
      const request = http.request({ hostname: '127.0.0.1', port: config.backendPort,
        method: incoming.method, path: rawPath, headers, agent: false, timeout: 10_000 }, response => {
        const safe = {}
        for (const [key, value] of Object.entries(response.headers)) {
          if (PASS_RESPONSE.has(key) && value !== undefined) safe[key] = value
        }
        outgoing.writeHead(response.statusCode ?? 502, safe)
        response.pipe(outgoing)
      })
      request.on('timeout', () => request.destroy())
      request.on('error', () => reply(outgoing, 502))
      request.end(Buffer.concat(chunks))
    })
    incoming.on('error', () => reply(outgoing, 400))
  }
  const server = config.mode === 'direct-tls'
    ? https.createServer({ key: config.tlsKey, cert: config.tlsCert }, handler)
    : http.createServer(handler)
  server.requestTimeout = 15_000
  server.headersTimeout = 10_000
  server.maxHeadersCount = 40
  return server
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    const input = { origin: process.env.PLUG_BETA_APPROVED_ORIGIN,
      proxySecret: process.env.PLUG_BETA_PROXY_SECRET, gatewayPort: process.env.PORT,
      backendPort: process.env.PLUG_BETA_INTERNAL_PORT, bindHost: '0.0.0.0',
      mode: process.env.PLUG_GATEWAY_MODE ?? 'direct-tls',
      tlsKey: process.env.PLUG_GATEWAY_TLS_KEY, tlsCert: process.env.PLUG_GATEWAY_TLS_CERT }
    const config = validateConfig(input)
    const server = createGateway(input)
    server.listen(config.gatewayPort, config.bindHost)
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close())
  } catch {
    console.error('GATEWAY_CONFIG_INVALID')
    process.exitCode = 1
  }
}
