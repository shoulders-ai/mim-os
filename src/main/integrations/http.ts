export interface HttpResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
  text(): Promise<string>
}

export interface HttpClient {
  request(input: {
    url: string
    method?: string
    headers?: Record<string, string>
    body?: string
    signal?: AbortSignal
    redirect?: RequestRedirect
  }): Promise<HttpResponse>
}

export const fetchHttpClient: HttpClient = {
  request: ({ url, method, headers, body, signal, redirect }) =>
    fetch(url, { method, headers, body, signal, redirect }),
}

export async function readJsonResponse(label: string, res: HttpResponse): Promise<unknown> {
  const text = await res.text()
  try {
    return text ? JSON.parse(text) : null
  } catch {
    throw new Error(`${label} returned non-JSON response: ${text.slice(0, 200)}`)
  }
}

export async function readTextResponse(res: HttpResponse): Promise<string> {
  return res.text()
}
