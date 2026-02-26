/**
 * MiniSparkline — tiny inline SVG sparkline used in camera tab bars.
 * Shared between WorkforceDashboard and ActivityDashboard.
 */
export default function MiniSparkline({ data, color = '#6366f1' }) {
    if (!data || data.length < 2) return null
    const max = Math.max(...data, 1)
    const W = 48, H = 16
    const pts = data.map((v, i) => {
        const x = (i / (data.length - 1)) * W
        const y = H - (v / max) * (H - 2) - 1
        return `${x.toFixed(1)},${y.toFixed(1)}`
    }).join(' ')
    return (
        <svg width={W} height={H} style={{ display: 'block', opacity: 0.75 }}>
            <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5"
                      strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    )
}
