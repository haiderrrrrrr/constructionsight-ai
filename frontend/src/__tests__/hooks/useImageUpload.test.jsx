import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useImageUpload from '@/hooks/useImageUpload'

// Helper to simulate a FileReader that resolves with a data URL
function mockFileReader(result) {
  const readerInstance = {
    readAsDataURL: vi.fn(function () {
      // Simulate async onload callback
      setTimeout(() => {
        if (this.onload) this.onload({ target: { result } })
      }, 0)
    }),
    onload: null,
    result,
  }
  vi.spyOn(globalThis, 'FileReader').mockImplementation(() => readerInstance)
  return readerInstance
}

describe('useImageUpload', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns uploadedImage as null initially', () => {
    const { result } = renderHook(() => useImageUpload())
    expect(result.current.uploadedImage).toBeNull()
  })

  it('returns a handleImageUpload function', () => {
    const { result } = renderHook(() => useImageUpload())
    expect(typeof result.current.handleImageUpload).toBe('function')
  })

  it('sets uploadedImage after file is read', async () => {
    const dataUrl = 'data:image/png;base64,abc123'
    const reader = mockFileReader(dataUrl)
    const { result } = renderHook(() => useImageUpload())
    const fakeFile = new File(['dummy'], 'test.png', { type: 'image/png' })
    const event = { target: { files: [fakeFile] } }
    act(() => result.current.handleImageUpload(event))
    // Advance to trigger the setTimeout in the mock reader
    await act(async () => {
      reader.onload?.({ target: { result: dataUrl } })
    })
    expect(result.current.uploadedImage).toBe(dataUrl)
  })

  it('calls FileReader.readAsDataURL with the selected file', () => {
    const reader = mockFileReader('data:image/jpg;base64,xyz')
    const { result } = renderHook(() => useImageUpload())
    const fakeFile = new File(['data'], 'photo.jpg', { type: 'image/jpeg' })
    const event = { target: { files: [fakeFile] } }
    act(() => result.current.handleImageUpload(event))
    expect(reader.readAsDataURL).toHaveBeenCalledWith(fakeFile)
  })

  it('does not call readAsDataURL when no file is selected', () => {
    const reader = mockFileReader(null)
    const { result } = renderHook(() => useImageUpload())
    const event = { target: { files: [] } }
    act(() => result.current.handleImageUpload(event))
    expect(reader.readAsDataURL).not.toHaveBeenCalled()
  })
})
