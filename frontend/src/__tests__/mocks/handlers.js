import { http, HttpResponse } from 'msw'

const BASE_URL = 'http://localhost:8000'

// ── Auth handlers ──────────────────────────────────────────────────────────
const authHandlers = [
  http.post(`${BASE_URL}/auth/login`, () => {
    return HttpResponse.json({
      access_token: 'mock-access-token-eyJhbGciOiJIUzI1NiJ9.mock',
      token_type: 'bearer',
    })
  }),

  http.post(`${BASE_URL}/auth/signup`, () => {
    return HttpResponse.json({
      id: 1,
      email: 'newuser@test.com',
      username: 'newuser',
      full_name: 'New User',
      platform_role: 'user',
      is_approved: false,
      is_active: true,
    }, { status: 201 })
  }),

  http.post(`${BASE_URL}/auth/refresh`, () => {
    return HttpResponse.json({
      access_token: 'mock-refreshed-token-eyJhbGciOiJIUzI1NiJ9.refreshed',
      token_type: 'bearer',
    })
  }),

  http.post(`${BASE_URL}/auth/logout`, () => {
    return HttpResponse.json({ ok: true })
  }),

  http.post(`${BASE_URL}/auth/logout-all`, () => {
    return HttpResponse.json({ ok: true })
  }),
]

// ── User handlers ──────────────────────────────────────────────────────────
const userHandlers = [
  http.get(`${BASE_URL}/users/me`, () => {
    return HttpResponse.json({
      id: 1,
      email: 'user@test.com',
      username: 'testuser',
      full_name: 'Test User',
      platform_role: 'user',
      is_approved: true,
      is_active: true,
      avatar_url: null,
      theme_skin: 'dark',
      created_at: '2025-01-01T00:00:00Z',
      auth_provider: 'local',
    })
  }),

  http.patch(`${BASE_URL}/users/me/profile`, async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json({
      id: 1,
      email: 'user@test.com',
      username: body.username || 'testuser',
      full_name: body.full_name || 'Test User',
      platform_role: 'user',
      is_approved: true,
      is_active: true,
    })
  }),

  http.patch(`${BASE_URL}/users/me/theme`, () => {
    return HttpResponse.json({ theme_skin: 'dark' })
  }),

  http.patch(`${BASE_URL}/users/me/password`, () => {
    return HttpResponse.json({ detail: 'Password changed successfully' })
  }),
]

// ── Notification handlers ──────────────────────────────────────────────────
const notificationHandlers = [
  http.get(`${BASE_URL}/notifications`, () => {
    return HttpResponse.json([
      {
        id: 1,
        type: 'system_alert',
        title: 'Test Notification',
        message: 'This is a test notification.',
        is_read: false,
        category: 'general',
        priority: 'medium',
        created_at: '2025-01-01T00:00:00Z',
      },
    ])
  }),

  http.get(`${BASE_URL}/notifications/unread-count`, () => {
    return HttpResponse.json({ count: 3 })
  }),

  http.patch(`${BASE_URL}/notifications/mark-all-read`, () => {
    return HttpResponse.json({ ok: true })
  }),

  http.patch(`${BASE_URL}/notifications/:id/read`, () => {
    return HttpResponse.json({ ok: true })
  }),

  http.delete(`${BASE_URL}/notifications/:id`, () => {
    return HttpResponse.json({ ok: true })
  }),
]

// ── Project handlers ───────────────────────────────────────────────────────
const projectHandlers = [
  http.get(`${BASE_URL}/projects`, () => {
    return HttpResponse.json([
      {
        id: 1,
        name: 'Test Project Alpha',
        location: 'Oslo',
        status: 'active',
        created_at: '2025-01-01T00:00:00Z',
      },
      {
        id: 2,
        name: 'Test Project Beta',
        location: 'Bergen',
        status: 'draft',
        created_at: '2025-02-01T00:00:00Z',
      },
    ])
  }),

  http.get(`${BASE_URL}/projects/:id`, ({ params }) => {
    return HttpResponse.json({
      id: parseInt(params.id),
      name: `Project ${params.id}`,
      location: 'Oslo',
      status: 'active',
      description: 'A mock project for testing.',
      created_at: '2025-01-01T00:00:00Z',
    })
  }),

  http.get(`${BASE_URL}/projects/:id/tasks`, () => {
    return HttpResponse.json([])
  }),
]

// ── Admin handlers ─────────────────────────────────────────────────────────
const adminHandlers = [
  http.get(`${BASE_URL}/admin/users`, () => {
    return HttpResponse.json([
      {
        id: 1,
        email: 'admin@test.com',
        username: 'adminuser',
        full_name: 'Admin User',
        platform_role: 'admin',
        is_approved: true,
        is_active: true,
        failed_login_count: 0,
        locked_until: null,
        active_project_count: 2,
        created_at: '2025-01-01T00:00:00Z',
      },
      {
        id: 2,
        email: 'pending@test.com',
        username: 'pendinguser',
        full_name: 'Pending User',
        platform_role: 'user',
        is_approved: false,
        is_active: true,
        failed_login_count: 0,
        locked_until: null,
        active_project_count: 0,
        created_at: '2025-01-02T00:00:00Z',
      },
    ])
  }),
]

// ── Export combined handlers ───────────────────────────────────────────────
export const handlers = [
  ...authHandlers,
  ...userHandlers,
  ...notificationHandlers,
  ...projectHandlers,
  ...adminHandlers,
]
