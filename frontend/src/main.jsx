import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { GoogleOAuthProvider } from '@react-oauth/google'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App.jsx'
// import "bootstrap/dist/css/bootstrap.min.css";
import * as bootstrap from 'bootstrap'
import './assets/scss/theme.scss'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,          // 30s — don't re-fetch if data is fresh
      gcTime: 5 * 60_000,         // 5min — keep unused cache in memory
      retry: 1,                   // retry once on network errors
      refetchOnWindowFocus: false, // SSE handles this for us
    },
  },
})

const savedFont = window.localStorage.getItem('fontFamily')
if (!savedFont) {
  document.documentElement.classList.add('app-font-family-maven-pro')
  window.localStorage.setItem('fontFamily', 'app-font-family-maven-pro')
}

const savedTheme = window.localStorage.getItem('skinTheme')
const envTheme = String(import.meta.env.VITE_DEFAULT_SKIN_THEME || 'dark').toLowerCase()

// Detect system preference if no saved theme
let activeTheme = savedTheme
if (!activeTheme) {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  activeTheme = prefersDark ? 'dark' : 'light'
}
// Fallback to env default if system preference detection failed
if (!activeTheme) {
  activeTheme = envTheme
}

if (activeTheme === 'dark') {
  document.documentElement.classList.add('app-skin-dark')
  window.localStorage.setItem('skinTheme', 'dark')
} else {
  document.documentElement.classList.remove('app-skin-dark')
  window.localStorage.setItem('skinTheme', 'light')
}

const GOOGLE_CLIENT_ID = '602312144630-vsqi3evnnugv7ir3gc9e21dmjqb3qu5b.apps.googleusercontent.com'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
        <App />
      </GoogleOAuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
