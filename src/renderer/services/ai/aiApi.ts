/**
 * Shared AI fetch helper.
 *
 * Lazily caches the server port and per-boot shell token, then attaches the
 * `x-mim-shell-token` header to every outbound AI request. Sandboxed app
 * iframes cannot reach the preload bridge, so they cannot obtain the token
 * and are blocked by the server-side middleware.
 */

let configPromise: Promise<[number, string]> | null = null

function getConfig(): Promise<[number, string]> {
  if (!configPromise) {
    configPromise = Promise.all([
      window.kernel.getPort(),
      window.kernel.getAiToken(),
    ])
  }
  return configPromise
}

export async function aiApiBase(): Promise<string> {
  const [port] = await getConfig()
  return `http://127.0.0.1:${port}`
}

export async function aiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const [, token] = await getConfig()
  const headers = new Headers(init?.headers)
  headers.set('x-mim-shell-token', token)
  return fetch(input, { ...init, headers })
}
