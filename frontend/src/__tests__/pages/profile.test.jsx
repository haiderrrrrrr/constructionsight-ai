import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Mock useAuthGuard so we don't need a real token
vi.mock('@/hooks/useAuthGuard', () => ({
  default: () => ({ status: 'ok', redirectTo: null }),
}))

// Mock child components that pull in heavy dependencies
vi.mock('@/components/shared/pageHeader/PageHeader', () => ({
  default: ({ children }) => <div data-testid="page-header">{children}</div>,
}))

vi.mock('@/components/profile/ProfileHeader', () => ({
  default: ({ isEditing }) => <div data-testid="profile-header">editing:{String(isEditing)}</div>,
}))

vi.mock('@/components/profile/ProfileContent', () => ({
  default: ({ user }) => (
    <div data-testid="profile-content">
      <span data-testid="user-name">{user?.full_name}</span>
      <span data-testid="user-email">{user?.email}</span>
    </div>
  ),
}))

// Mock apiGet
vi.mock('@/utils/api', () => ({
  apiGet: vi.fn(),
}))

import ProfilePage from '@/pages/user/profile'
import { apiGet } from '@/utils/api'

const renderProfile = () =>
  render(
    <MemoryRouter>
      <ProfilePage />
    </MemoryRouter>
  )

describe('ProfilePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows a loading spinner while fetching', () => {
    apiGet.mockReturnValue(new Promise(() => {})) // never resolves
    renderProfile()
    expect(document.querySelector('.spinner-border')).toBeTruthy()
  })

  it('renders user full_name after data loads', async () => {
    apiGet.mockResolvedValue({
      id: 1,
      full_name: 'Alice Smith',
      email: 'alice@example.com',
      username: 'alice',
    })
    renderProfile()
    await waitFor(() => expect(screen.getByTestId('user-name').textContent).toBe('Alice Smith'))
  })

  it('renders user email after data loads', async () => {
    apiGet.mockResolvedValue({
      id: 1,
      full_name: 'Bob Jones',
      email: 'bob@example.com',
      username: 'bob',
    })
    renderProfile()
    await waitFor(() => expect(screen.getByTestId('user-email').textContent).toBe('bob@example.com'))
  })

  it('fetches from /users/me endpoint', async () => {
    apiGet.mockResolvedValue({ id: 1, full_name: 'Test', email: 't@t.com' })
    renderProfile()
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/users/me'))
  })

  it('renders ProfileHeader component', async () => {
    apiGet.mockResolvedValue({ id: 1, full_name: 'Test', email: 't@t.com' })
    renderProfile()
    await waitFor(() => expect(screen.getByTestId('profile-header')).toBeTruthy())
  })

  it('renders ProfileContent with user data', async () => {
    apiGet.mockResolvedValue({ id: 1, full_name: 'Test User', email: 'test@test.com' })
    renderProfile()
    await waitFor(() => expect(screen.getByTestId('profile-content')).toBeTruthy())
  })

  it('ProfileHeader shows isEditing=false initially', async () => {
    apiGet.mockResolvedValue({ id: 1, full_name: 'Alice', email: 'a@a.com' })
    renderProfile()
    await waitFor(() => {
      const header = screen.getByTestId('profile-header')
      expect(header.textContent).toContain('editing:false')
    })
  })
})
