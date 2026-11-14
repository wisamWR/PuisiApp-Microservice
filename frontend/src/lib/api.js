const API_BASE_URL = '/api'

export class ApiError extends Error {
  constructor(message, status, data = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.data = data
  }
}

async function parseResponse(response) {
  if (response.status === 204) return null

  const contentType = response.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    return response.json()
  }

  const text = await response.text()
  return text || null
}

function notifyProcessing(data) {
  const message =
    data?.message || 'Permintaan diterima dan sedang diproses.'

  window.dispatchEvent(
    new CustomEvent('app:toast', {
      detail: { message, type: 'info' },
    }),
  )
}

export async function apiRequest(path, options = {}) {
  if (typeof path !== 'string' || !path.trim()) {
    throw new TypeError('API path harus berupa string yang valid.')
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const url = `${API_BASE_URL}${normalizedPath}`

  const headers = new Headers(options.headers || {})
  let body = options.body

  if (
    body !== undefined &&
    body !== null &&
    typeof body === 'object' &&
    !(body instanceof FormData) &&
    !(body instanceof Blob) &&
    !(body instanceof ArrayBuffer)
  ) {
    body = JSON.stringify(body)

    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }
  }

  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json')
  }

  const response = await fetch(url, {
    ...options,
    headers,
    body,
    credentials: 'include',
  })

  const data = await parseResponse(response)

  if (response.status === 401) {
    const currentPath = window.location.pathname
    const publicPages = ['/login', '/register']

    if (!publicPages.includes(currentPath)) {
      window.location.assign('/login')
    }

    throw new ApiError(
      data?.message || 'Sesi berakhir. Silakan masuk kembali.',
      401,
      data,
    )
  }

  if (!response.ok) {
    throw new ApiError(
      data?.message || data?.error || `Request gagal (${response.status}).`,
      response.status,
      data,
    )
  }

  const processing = response.status === 202

  if (processing) {
    notifyProcessing(data)
  }

  return {
    data,
    status: response.status,
    processing,
  }
}

export const api = {
  get: (path, options = {}) =>
    apiRequest(path, { ...options, method: 'GET' }),

  post: (path, body, options = {}) =>
    apiRequest(path, { ...options, method: 'POST', body }),

  put: (path, body, options = {}) =>
    apiRequest(path, { ...options, method: 'PUT', body }),

  patch: (path, body, options = {}) =>
    apiRequest(path, { ...options, method: 'PATCH', body }),

  delete: (path, options = {}) =>
    apiRequest(path, { ...options, method: 'DELETE' }),
}
