import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Checkbox from '@/components/shared/Checkbox'

describe('Checkbox component', () => {
  it('renders without crashing', () => {
    const { container } = render(<Checkbox id="cb1" name="Accept terms" />)
    expect(container.firstChild).toBeTruthy()
  })

  it('renders an input of type checkbox', () => {
    const { container } = render(<Checkbox id="cb2" name="Remember me" />)
    const input = container.querySelector('input[type="checkbox"]')
    expect(input).toBeTruthy()
  })

  it('renders the label text', () => {
    render(<Checkbox id="cb3" name="I agree to terms" />)
    expect(screen.getByText('I agree to terms')).toBeTruthy()
  })

  it('associates label with input via id', () => {
    render(<Checkbox id="cb4" name="Notify me" />)
    const label = screen.getByText('Notify me')
    expect(label.htmlFor).toBe('cb4')
  })

  it('renders as checked when checked=true', () => {
    const { container } = render(<Checkbox id="cb5" name="Active" checked={true} />)
    const input = container.querySelector('input')
    expect(input.defaultChecked).toBe(true)
  })

  it('renders as unchecked when checked=false', () => {
    const { container } = render(<Checkbox id="cb6" name="Inactive" checked={false} />)
    const input = container.querySelector('input')
    expect(input.defaultChecked).toBe(false)
  })

  it('passes additional props to input', () => {
    const onChange = vi.fn()
    const { container } = render(<Checkbox id="cb7" name="Test" onChange={onChange} />)
    const input = container.querySelector('input')
    fireEvent.change(input, { target: { checked: true } })
    expect(onChange).toHaveBeenCalled()
  })

  it('applies custom className to wrapper', () => {
    const { container } = render(<Checkbox id="cb8" name="Custom" className="my-class" />)
    expect(container.querySelector('.my-class')).toBeTruthy()
  })
})
