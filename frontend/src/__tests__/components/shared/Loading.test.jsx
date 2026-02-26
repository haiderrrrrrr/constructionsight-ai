import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import Loading from '@/components/shared/Loading'

describe('Loading component', () => {
  it('renders without crashing', () => {
    const { container } = render(<Loading />)
    expect(container.firstChild).toBeTruthy()
  })

  it('renders an element with the loading CSS class', () => {
    const { container } = render(<Loading />)
    expect(container.querySelector('.loading')).toBeTruthy()
  })

  it('renders a div element', () => {
    const { container } = render(<Loading />)
    expect(container.firstChild.tagName).toBe('DIV')
  })

  it('renders no child text content', () => {
    const { container } = render(<Loading />)
    expect(container.textContent).toBe('')
  })
})
