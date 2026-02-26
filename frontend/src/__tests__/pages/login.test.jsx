import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { server } from '../mocks/server'
import { http, HttpResponse } from 'msw'

// Mock react-oauth/google — not needed for these unit tests
vi.mock('@react-oauth/google', () => ({
  useGoogleLogin: () => vi.fn(),
  GoogleOAuthProvider: ({ children }) => children,
}))

// Mock navigation
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
  }
})

// Mock topTost utilities
vi.mock('@/utils/topTostError', () => ({ default: vi.fn() }))
vi.mock('@/utils/topTost', () => ({ default: vi.fn() }))

import LoginForm from '@/components/authentication/LoginForm'
import topTostError from '@/utils/topTostError'

const renderLogin = () =>
  render(
    <MemoryRouter>
      <LoginForm registerPath="/register" resetPath="/reset" />
    </MemoryRouter>
  )

describe('LoginForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
  })

  it('renders the sign in heading', () => {
    renderLogin()
    expect(screen.getByText('Sign In')).toBeTruthy()
  })

  it('renders email/username and password inputs', () => {
    renderLogin()
    expect(screen.getByPlaceholderText(/email or username/i)).toBeTruthy()
    expect(screen.getByPlaceholderText(/enter your password/i)).toBeTruthy()
  })

  it('renders a Sign In submit button', () => {
    renderLogin()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeTruthy()
  })

  it('renders link to register page', () => {
    renderLogin()
    expect(screen.getByText('Create an account').closest('a').href).toContain('/register')
  })

  it('renders link to password reset page', () => {
    renderLogin()
    expect(screen.getByText('Forgot password?').closest('a').href).toContain('/reset')
  })

  it('shows error toast when submitting with empty identifier', async () => {
    renderLogin()
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
    await waitFor(() =>
      expect(topTostError).toHaveBeenCalledWith('Please enter your email or username')
    )
  })

  it('shows error toast when identifier is provided but password is empty', async () => {
    renderLogin()
    fireEvent.change(screen.getByPlaceholderText(/email or username/i), {
      target: { value: 'alice@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
    await waitFor(() =>
      expect(topTostError).toHaveBeenCalledWith('Please enter your password')
    )
  })

  it('shows invalid email error for malformed email', async () => {
    renderLogin()
    fireEvent.change(screen.getByPlaceholderText(/email or username/i), {
      target: { value: 'notanemail@' },
    })
    fireEvent.change(screen.getByPlaceholderText(/enter your password/i), {
      target: { value: 'somepass' },
    })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
    await waitFor(() =>
      expect(topTostError).toHaveBeenCalledWith('Please enter a valid email address')
    )
  })

  it('navigates to admin dashboard after successful admin login', async () => {
    server.use(
      http.post('*/auth/login', () =>
        HttpResponse.json({ access_token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIiwicGxhdGZvcm1fcm9sZSI6ImFkbWluIiwiZXhwIjo5OTk5OTk5OTk5fQ.placeholder' })
      )
    )
    renderLogin()
    fireEvent.change(screen.getByPlaceholderText(/email or username/i), {
      target: { value: 'admin@example.com' },
    })
    fireEvent.change(screen.getByPlaceholderText(/enter your password/i), {
      target: { value: 'AdminPass123!' },
    })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
    await waitFor(() => expect(mockNavigate).toHaveBeenCalled())
  })

  it('shows locked account error message', async () => {
    server.use(
      http.post('*/auth/login', () =>
        HttpResponse.json({ detail: 'Account locked after too many failed attempts' }, { status: 423 })
      )
    )
    renderLogin()
    fireEvent.change(screen.getByPlaceholderText(/email or username/i), {
      target: { value: 'locked@example.com' },
    })
    fireEvent.change(screen.getByPlaceholderText(/enter your password/i), {
      target: { value: 'WrongPass1!' },
    })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
    await waitFor(() =>
      expect(topTostError).toHaveBeenCalledWith(
        expect.stringMatching(/locked/i)
      )
    )
  })

  it('toggles password visibility when eye icon is clicked', () => {
    renderLogin()
    const passInput = screen.getByPlaceholderText(/enter your password/i)
    expect(passInput.type).toBe('password')
    // Click the show/hide toggle — it's in the input-group-text
    const toggle = document.querySelector('.input-group-text.c-pointer')
    fireEvent.click(toggle)
    expect(passInput.type).toBe('text')
  })
})
