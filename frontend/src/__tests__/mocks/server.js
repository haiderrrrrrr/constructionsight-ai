import { setupServer } from 'msw/node'
import { handlers } from './handlers'

// Create a single MSW server instance that intercepts all outgoing HTTP requests
// during the Vitest test run. The server is started/stopped in setup.js.
export const server = setupServer(...handlers)
