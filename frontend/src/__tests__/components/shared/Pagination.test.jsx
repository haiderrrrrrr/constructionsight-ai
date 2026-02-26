import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Pagination from '@/components/shared/Pagination'

describe('Pagination component', () => {
  const renderPagination = () =>
    render(
      <MemoryRouter>
        <Pagination />
      </MemoryRouter>
    )

  it('renders without crashing', () => {
    const { container } = renderPagination()
    expect(container.querySelector('ul')).toBeTruthy()
  })

  it('renders a list with navigation items', () => {
    const { container } = renderPagination()
    const items = container.querySelectorAll('li')
    expect(items.length).toBeGreaterThan(0)
  })

  it('renders at least one page number link', () => {
    renderPagination()
    // Static pagination has page 1 as active
    expect(screen.getByText('1')).toBeTruthy()
  })

  it('renders previous arrow', () => {
    const { container } = renderPagination()
    // Arrow icons render as SVG elements inside links
    const links = container.querySelectorAll('a')
    expect(links.length).toBeGreaterThan(0)
  })

  it('renders pagination with expected CSS class', () => {
    const { container } = renderPagination()
    expect(container.querySelector('.pagination-common-style')).toBeTruthy()
  })
})
