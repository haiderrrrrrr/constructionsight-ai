/**
 * Shared React Query cache patch helpers for the PPE Safety Dashboard.
 * Used by usePPEStream.js and PPESafetyDashboard.jsx to apply surgical in-place
 * updates without triggering full list re-fetches (which would reset scroll position).
 */

/**
 * Patch a single incident in every cached incidents query for a project.
 * Only fields present (non-null) in `data` are merged — existing fields are preserved.
 * Also patches the open_incidents counter in summary caches if data.open_incidents is provided.
 *
 * @param {import('@tanstack/react-query').QueryClient} queryClient
 * @param {string|number} projectId
 * @param {{ incident_id: number, status?: string, ended_at?: string, video_clip_url?: string, open_incidents?: number }} data
 */
export function patchIncidentInCache(queryClient, projectId, data) {
    // Patch the changed incident in every cached incidents query for this project
    queryClient
        .getQueriesData({ queryKey: ['ppe', 'incidents', projectId] })
        .forEach(([key, cached]) => {
            if (!cached?.items) return
            queryClient.setQueryData(key, {
                ...cached,
                items: cached.items.map(i =>
                    i.id === data.incident_id
                        ? {
                            ...i,
                            ...(data.status         != null ? { status:         data.status }         : {}),
                            ...(data.ended_at       != null ? { ended_at:       data.ended_at }       : {}),
                            ...(data.video_clip_url != null ? { video_clip_url: data.video_clip_url } : {}),
                          }
                        : i
                ),
            })
        })

    // Patch open_incidents counter in summary caches if the backend sent it
    if (data.open_incidents != null) {
        queryClient
            .getQueriesData({ queryKey: ['ppe', 'summary', projectId] })
            .forEach(([key, cached]) => {
                if (!cached) return
                queryClient.setQueryData(key, { ...cached, open_incidents: data.open_incidents })
            })
    }
}
