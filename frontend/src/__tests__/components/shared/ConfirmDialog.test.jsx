import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ConfirmDialog from '@/components/shared/ConfirmDialog'

describe('ConfirmDialog', () => {
  it('renders nothing when open=false', () => {
    const { container } = render(
      <ConfirmDialog open={false} title="Delete?" message="Are you sure?" onConfirm={vi.fn()} onClose={vi.fn()} />
    )
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('renders dialog when open=true', () => {
    render(
      <ConfirmDialog open={true} title="Delete item" message="This cannot be undone." onConfirm={vi.fn()} onClose={vi.fn()} />
    )
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('displays the title text', () => {
    render(
      <ConfirmDialog open={true} title="Confirm Archive" message="msg" onConfirm={vi.fn()} onClose={vi.fn()} />
    )
    expect(screen.getByText('Confirm Archive')).toBeTruthy()
  })

  it('displays the message text', () => {
    render(
      <ConfirmDialog open={true} title="T" message="You will lose all data." onConfirm={vi.fn()} onClose={vi.fn()} />
    )
    expect(screen.getByText('You will lose all data.')).toBeTruthy()
  })

  it('calls onConfirm when confirm button clicked', () => {
    const onConfirm = vi.fn()
    render(
      <ConfirmDialog open={true} variant="delete" title="T" message="M" onConfirm={onConfirm} onClose={vi.fn()} />
    )
    fireEvent.click(screen.getByText('Delete'))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('calls onClose when Cancel button clicked', () => {
    const onClose = vi.fn()
    render(
      <ConfirmDialog open={true} title="T" message="M" onConfirm={vi.fn()} onClose={onClose} />
    )
    fireEvent.click(screen.getByText('Cancel'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onClose when backdrop clicked', () => {
    const onClose = vi.fn()
    render(
      <ConfirmDialog open={true} title="T" message="M" onConfirm={vi.fn()} onClose={onClose} />
    )
    fireEvent.mouseDown(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalled()
  })

  it('uses custom confirmLabel', () => {
    render(
      <ConfirmDialog open={true} title="T" message="M" confirmLabel="Yes, proceed" onConfirm={vi.fn()} onClose={vi.fn()} />
    )
    expect(screen.getByText('Yes, proceed')).toBeTruthy()
  })

  it('disables buttons when loading=true', () => {
    render(
      <ConfirmDialog open={true} title="T" message="M" loading={true} onConfirm={vi.fn()} onClose={vi.fn()} />
    )
    const cancelBtn = screen.getByText('Cancel')
    expect(cancelBtn.disabled).toBe(true)
  })

  it('shows spinner inside confirm button when loading=true', () => {
    render(
      <ConfirmDialog open={true} title="T" message="M" loading={true} onConfirm={vi.fn()} onClose={vi.fn()} />
    )
    expect(document.querySelector('.spinner-border')).toBeTruthy()
  })

  it('calls onClose when Escape key is pressed', () => {
    const onClose = vi.fn()
    render(
      <ConfirmDialog open={true} title="T" message="M" onConfirm={vi.fn()} onClose={onClose} />
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('renders archive variant with Archive button', () => {
    render(
      <ConfirmDialog open={true} variant="archive" title="Archive?" message="M" onConfirm={vi.fn()} onClose={vi.fn()} />
    )
    expect(screen.getByText('Archive')).toBeTruthy()
  })

  it('renders unarchive variant with Restore button', () => {
    render(
      <ConfirmDialog open={true} variant="unarchive" title="Restore?" message="M" onConfirm={vi.fn()} onClose={vi.fn()} />
    )
    expect(screen.getByText('Restore')).toBeTruthy()
  })
})
