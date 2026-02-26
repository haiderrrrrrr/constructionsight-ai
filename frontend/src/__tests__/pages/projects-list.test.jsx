import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Mock hooks
vi.mock('@/hooks/useAuthGuard', () => ({
  default: () => ({ status: 'ok', redirectTo: null }),
}))

// Mock api utilities
vi.mock('@/utils/api', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
  apiPatch: vi.fn(),
}))

// Mock broadcast utilities
vi.mock('@/utils/broadcast', () => ({
  broadcastRefresh: vi.fn(),
  onBroadcast: vi.fn(() => () => {}),
}))

// Mock toast helpers
vi.mock('@/utils/topTost', () => ({ default: vi.fn() }))
vi.mock('@/utils/topTostError', () => ({ default: vi.fn() }))

// Mock getIcon
vi.mock('@/utils/getIcon', () => ({ default: vi.fn(() => null) }))

// Mock getProjectStatusMeta — real module reads from source
vi.mock('@/utils/projectStatusMeta', () => ({
  getProjectStatusMeta: vi.fn((status) => ({
    label: status === 'active' ? 'Active' : status === 'draft' ? 'Draft' : 'Archived',
    color: 'bg-success',
    badge: 'badge-success',
    progress: status === 'active' ? 100 : 30,
    progressColor: '#22c55e',
  })),
}))

import UserProjects from '@/pages/user/user-projects'
import { apiGet } from '@/utils/api'

const MOCK_PROJECTS = [
  {
    id: 1,
    name: 'Tower Block A',
    status: 'active',
    location: 'London',
    start_date: '2025-01-01',
    end_date: '2025-12-31',
    site_id: 1,
    project_type: 'commercial',
  },
  {
    id: 2,
    name: 'Bridge Renovation',
    status: 'draft',
    location: 'Manchester',
    start_date: '2025-06-01',
    end_date: '2026-06-01',
    site_id: 2,
    project_type: 'infrastructure',
  },
]

const renderProjects = () =>
  render(
    <MemoryRouter>
      <UserProjects />
    </MemoryRouter>
  )

describe('UserProjects page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: GET /projects returns projects, GET /invitations/me returns []
    apiGet.mockImplementation((url) => {
      if (url === '/projects') return Promise.resolve(MOCK_PROJECTS)
      if (url === '/invitations/me') return Promise.resolve([])
      if (url.includes('/tasks')) return Promise.resolve([])
      return Promise.resolve([])
    })
  })

  it('renders without crashing', async () => {
    const { container } = renderProjects()
    expect(container).toBeTruthy()
    // Wait for data to load
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/projects'))
  })

  it('fetches projects from /projects on mount', async () => {
    renderProjects()
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/projects'))
  })

  it('fetches invitations from /invitations/me on mount', async () => {
    renderProjects()
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/invitations/me'))
  })

  it('renders project names after data loads', async () => {
    renderProjects()
    await waitFor(() => expect(screen.getByText('Tower Block A')).toBeTruthy())
    expect(screen.getByText('Bridge Renovation')).toBeTruthy()
  })

  it('shows status badge for each project', async () => {
    renderProjects()
    await waitFor(() => expect(screen.getByText('Active')).toBeTruthy())
    expect(screen.getByText('Draft')).toBeTruthy()
  })

  it('renders project locations', async () => {
    renderProjects()
    await waitFor(() => expect(screen.getByText('London')).toBeTruthy())
    expect(screen.getByText('Manchester')).toBeTruthy()
  })

  it('renders empty state when no projects returned', async () => {
    apiGet.mockImplementation((url) => {
      if (url === '/projects') return Promise.resolve([])
      if (url === '/invitations/me') return Promise.resolve([])
      return Promise.resolve([])
    })
    const { container } = renderProjects()
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/projects'))
    // Page should still render without errors
    expect(container.firstChild).toBeTruthy()
  })
})
