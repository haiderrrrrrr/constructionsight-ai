import '@testing-library/jest-dom'
import { server } from './mocks/server'

// Start MSW before all tests in this file's module
beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }))

// Reset any request handlers that were added during tests (prevent state leak)
afterEach(() => server.resetHandlers())

// Stop MSW after all tests
afterAll(() => server.close())
