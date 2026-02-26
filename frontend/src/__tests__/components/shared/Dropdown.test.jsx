import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SelectDropdown } from '@/components/shared/Dropdown'

// Bootstrap Dropdown JS is not available in jsdom — that's fine,
// SelectDropdown only calls hideDropdown() on select which won't crash
vi.mock('react-router-dom', () => ({
  Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a>,
}))

const OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'pending', label: 'Pending' },
]

describe('SelectDropdown', () => {
  it('renders without crashing', () => {
    const { container } = render(
      <SelectDropdown options={OPTIONS} onChange={vi.fn()} />
    )
    expect(container.firstChild).toBeTruthy()
  })

  it('shows placeholder when no value selected', () => {
    render(<SelectDropdown options={OPTIONS} onChange={vi.fn()} placeholder="Choose status" />)
    expect(screen.getByText('Choose status')).toBeTruthy()
  })

  it('shows selected label when value is set', () => {
    render(<SelectDropdown options={OPTIONS} value="active" onChange={vi.fn()} />)
    expect(screen.getByText('Active')).toBeTruthy()
  })

  it('renders all options in dropdown list', () => {
    render(<SelectDropdown options={OPTIONS} onChange={vi.fn()} />)
    expect(screen.getByText('Active')).toBeTruthy()
    expect(screen.getByText('Inactive')).toBeTruthy()
    expect(screen.getByText('Pending')).toBeTruthy()
  })

  it('calls onChange when an option is clicked', () => {
    const onChange = vi.fn()
    render(<SelectDropdown options={OPTIONS} onChange={onChange} />)
    fireEvent.click(screen.getByText('Inactive'))
    expect(onChange).toHaveBeenCalledWith('inactive', OPTIONS[1])
  })

  it('renders disabled button when disabled=true', () => {
    const { container } = render(
      <SelectDropdown options={OPTIONS} onChange={vi.fn()} disabled={true} />
    )
    const button = container.querySelector('button.form-select')
    expect(button.disabled).toBe(true)
  })

  it('shows no results text when search yields nothing', () => {
    render(
      <SelectDropdown
        options={OPTIONS}
        onChange={vi.fn()}
        enableSearch={true}
        noResultsText="Nothing found"
      />
    )
    const searchInput = screen.getByPlaceholderText('Search…')
    fireEvent.change(searchInput, { target: { value: 'zzznomatch' } })
    expect(screen.getByText('Nothing found')).toBeTruthy()
  })

  it('filters options when searching', () => {
    render(
      <SelectDropdown options={OPTIONS} onChange={vi.fn()} enableSearch={true} />
    )
    const searchInput = screen.getByPlaceholderText('Search…')
    fireEvent.change(searchInput, { target: { value: 'act' } })
    expect(screen.getByText('Active')).toBeTruthy()
    expect(screen.queryByText('Pending')).toBeNull()
  })

  it('renders with is-invalid class when invalid=true', () => {
    const { container } = render(
      <SelectDropdown options={OPTIONS} onChange={vi.fn()} invalid={true} />
    )
    const button = container.querySelector('button.form-select')
    expect(button.classList.contains('is-invalid')).toBe(true)
  })

  it('renders empty options list gracefully', () => {
    const { container } = render(
      <SelectDropdown options={[]} onChange={vi.fn()} noResultsText="No items" />
    )
    expect(screen.getByText('No items')).toBeTruthy()
  })
})
