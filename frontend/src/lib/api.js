const API_BASE_URL = '/api'

export class ApiError extends Error {
  constructor(message, status, data = null, retryAfter = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.data = data
    // Detik sampai boleh mencoba lagi (dari header Retry-After, untuk 429).
    this.retryAfter = retryAfter
  }
}

// Endpoint auth tidak memicu refresh: 401 di sana berarti kredensial salah, bukan sesi kedaluwarsa.
const JALUR_AUTH = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout']

async function refreshSesi() {
  try {
    const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
    return res.ok
  } catch {
    return false
  }
}

async function parseResponse(response) {
  if (response.status === 204) return null

  const contentType = response.headers.get('content-type') || ''
  const text = await response.text()

  if (!text) return null

  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  }

  return text
}

function isRawBody(body) {
  return (
    body instanceof FormData ||
    body instanceof Blob ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    body instanceof URLSearchParams ||
    body instanceof ReadableStream
  )
}

// Fastify: { message }, gateway: { error: "unauthorized" }, atau { error: { message } }.
function errorMessage(data, fallback) {
  if (typeof data === 'string' && data) return data
  return data?.message || data?.error?.message || (typeof data?.error === 'string' ? data.error : null) || fallback
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

  const { sudahCobaRefresh = false, ...fetchOptions } = options
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const url = `${API_BASE_URL}${normalizedPath}`

  const headers = new Headers(fetchOptions.headers || {})
  let body = fetchOptions.body

  if (
    body !== undefined &&
    body !== null &&
    typeof body === 'object' &&
    !isRawBody(body)
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
    ...fetchOptions,
    headers,
    body,
    credentials: 'include',
  })

  const data = await parseResponse(response)

  // Sesi kedaluwarsa: perbarui lewat refresh token sekali, lalu ulangi request.
  if (response.status === 401 && !sudahCobaRefresh && !JALUR_AUTH.includes(normalizedPath)) {
    const diperbarui = await refreshSesi()
    if (diperbarui) {
      return apiRequest(path, { ...fetchOptions, sudahCobaRefresh: true })
    }
  }

  if (response.status === 401) {
    const currentPath = window.location.pathname
    const publicPages = ['/login', '/register']

    if (!publicPages.includes(currentPath)) {
      // Simpan tujuan awal agar halaman Masuk bisa kembali ke sini setelah login.
      const next = encodeURIComponent(currentPath + window.location.search)
      window.location.assign(`/login?next=${next}`)
    }

    throw new ApiError(
      errorMessage(data, 'Sesi berakhir. Silakan masuk kembali.'),
      401,
      data,
    )
  }

  if (!response.ok) {
    const retryAfter = Number(response.headers.get('Retry-After')) || null
    throw new ApiError(
      errorMessage(data, `Request gagal (${response.status}).`),
      response.status,
      data,
      retryAfter,
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
