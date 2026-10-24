import http from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createGateway } from '../gateway.mjs'

const origin = process.env.PLUG_PROBE_ORIGIN
const publicPort = Number(process.env.PORT)
const privatePort = 5017
const secret = randomBytes(48).toString('hex')

function sameSecret(value) {
  if (typeof value !== 'string') return false
  const supplied = Buffer.from(value)
  const expected = Buffer.from(secret)
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

const backend = http.createServer((req, res) => {
  const authorized = sameSecret(req.headers['x-plug-proxy-authorization']) &&
    req.headers['x-forwarded-proto'] === 'https' &&
    req.headers.host === new URL(origin).host
  res.writeHead(authorized ? 200 : 403, {
    'content-type': 'application/json', 'cache-control': 'no-store',
  })
  res.end(JSON.stringify(authorized ? { probe: 'through-gateway' } : { error: 'PRIVATE_BACKEND' }))
})

// This mode deliberately trusts a forgeable header. Use only with this fake
// backend until external HTTP and private-port bypass tests prove isolation.
const gateway = createGateway({ origin, proxySecret: secret, gatewayPort: publicPort,
  backendPort: privatePort, bindHost: '0.0.0.0', mode: 'platform-tls' })

backend.listen(privatePort, '127.0.0.1', () => {
  gateway.listen(publicPort, '0.0.0.0', () => console.log('Disposable ingress probe ready'))
})
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => gateway.close(() => backend.close()))
}
