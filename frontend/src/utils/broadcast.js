const channel = new BroadcastChannel('cs-app')

/**
 * Dispatch a named refresh event to all tabs/windows on this origin,
 * AND fire a local window event for components in the same tab.
 */
export function broadcastRefresh(eventName, payload = null) {
    window.dispatchEvent(new CustomEvent(eventName, { detail: payload }))
    channel.postMessage({ type: eventName, payload })
}

/**
 * Subscribe to broadcast messages for a specific event name.
 * Handler receives payload if provided.
 * Returns an unsubscribe function suitable for useEffect cleanup.
 */
export function onBroadcast(eventName, handler) {
    const localListener = (e) => handler(e.detail ?? null)
    const channelListener = (e) => {
        if (e.data?.type === eventName) handler(e.data?.payload ?? null)
    }
    window.addEventListener(eventName, localListener)
    channel.addEventListener('message', channelListener)
    return () => {
        window.removeEventListener(eventName, localListener)
        channel.removeEventListener('message', channelListener)
    }
}
