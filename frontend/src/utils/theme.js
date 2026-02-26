import { apiGet } from '@/utils/api'
import { broadcastRefresh } from '@/utils/broadcast'

/**
 * Fetches the user's theme preferences from the server and applies them.
 * Called after login and on page load with a valid session.
 * Defaults to 'dark' for any unset preferences.
 */
export async function syncThemeFromServer() {
    try {
        const user = await apiGet('/users/me')
        if (!user) return

        // Default to 'dark' when no preference saved (new user)
        const skin = user.theme_skin || 'dark'

        // Write to localStorage for fast access on next page load
        localStorage.setItem('skinTheme', skin)

        // Apply CSS classes to DOM (skin controls all three: skin, nav, header)
        applyTheme(skin)
        broadcastRefresh('cs:theme-skin-change')
    } catch {
        // Silently ignore — localStorage fallback remains active
    }
}

function applyTheme(skin) {
    const html = document.documentElement
    html.classList.add('theme-switching')

    if (skin === 'dark') {
        html.classList.add('app-skin-dark')
        html.classList.add('app-navigation-dark')
        html.classList.add('app-header-dark')
    } else if (skin === 'light') {
        html.classList.remove('app-skin-dark')
        html.classList.remove('app-navigation-dark')
        html.classList.remove('app-header-dark')
    }

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            html.classList.remove('theme-switching')
        })
    })
}
