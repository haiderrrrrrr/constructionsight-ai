import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import Input from '@/components/shared/Input'

// getIcon relies on feather-icons — stub it out
vi.mock('@/utils/getIcon', () => ({ default: (name) => name || null }))

describe('Input component', () => {
  it('renders the label text', () => {
    render(<Input label="Email" labelId="email-input" />)
    expect(screen.getByText('Email:')).toBeTruthy()
  })

  it('renders the input element', () => {
    render(<Input label="Name" labelId="name-input" name="name" placeholder="Enter name" />)
    const input = screen.getByPlaceholderText('Enter name')
    expect(input).toBeTruthy()
  })

  it('passes through the type prop', () => {
    render(<Input label="Pass" labelId="pass-input" type="password" name="pass" placeholder="Enter password" />)
    const input = screen.getByPlaceholderText('Enter password')
    expect(input.type).toBe('password')
  })

  it('defaults to type=text when not specified', () => {
    render(<Input label="Field" labelId="field-input" name="field" placeholder="Enter value" />)
    const input = screen.getByPlaceholderText('Enter value')
    expect(input.type).toBe('text')
  })

  it('sets the name attribute', () => {
    render(<Input label="City" labelId="city" name="city" placeholder="City" />)
    const input = screen.getByPlaceholderText('City')
    expect(input.name).toBe('city')
  })

  it('associates label with input via labelId', () => {
    render(<Input label="Email" labelId="email-field" name="email" placeholder="email" />)
    const label = screen.getByText('Email:')
    expect(label.htmlFor).toBe('email-field')
  })

  it('does not render center link by default', () => {
    render(<Input label="Link" labelId="link-field" />)
    expect(screen.queryByText(/themeforest/)).toBeNull()
  })

  it('renders center link when centerLink is true', () => {
    render(<Input label="Link" labelId="link-field" centerLink={true} />)
    expect(screen.getByText(/themeforest/)).toBeTruthy()
  })
})
