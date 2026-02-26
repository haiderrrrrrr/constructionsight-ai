/**
 * Shared React Query cache patch helpers for the Equipment Analytics dashboard.
 * Mirrors workforceCacheUtils.js — surgical in-place updates without triggering full
 * list re-fetches (which would reset scroll position).
 */

/**
 * Patch a single alert in every cached alerts query for a project.
 * Only fields present (non-null) in `data` are merged — existing fields are preserved.
 * Also patches the open_alerts counter in summary caches if data.open_alerts is provided.
 *
 * @param {import('@tanstack/react-query').QueryClient} queryClient
 * @param {string|number} projectId
 * @param {{ alert_id: number, status?: string, open_alerts?: number }} data
 */
export function patchAlertInCache(queryClient, projectId, data) {
    queryClient
        .getQueriesData({ queryKey: ['equipment', 'alerts', projectId] })
        .forEach(([key, cached]) => {
            if (!cached?.items) return
            queryClient.setQueryData(key, {
                ...cached,
                items: cached.items.map(a =>
                    a.id === data.alert_id
                        ? { ...a, ...(data.status != null ? { status: data.status } : {}) }
                        : a
                ),
            })
        })

    if (data.open_alerts != null) {
        queryClient
            .getQueriesData({ queryKey: ['equipment', 'summary', projectId] })
            .forEach(([key, cached]) => {
                if (!cached) return
                queryClient.setQueryData(key, { ...cached, open_alerts: data.open_alerts })
            })
    }
}
