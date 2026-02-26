const pad2 = (n) => String(n).padStart(2, '0')

const getLast7DayLabels = () => {
    const now = new Date()
    const labels = []
    for (let i = 6; i >= 0; i--) {
        const d = new Date(now)
        d.setDate(now.getDate() - i)
        labels.push(`${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`)
    }
    return labels
}

export const visitorsOverviewChartOption = (stats) => {
    const usingLive = !!stats

    const live = (() => {
        const byDay = stats?.last_7_days || null
        const weekly = stats?.weekly_activity || null
        const projects = Array.isArray(byDay?.projects) ? byDay.projects : (Array.isArray(weekly?.projects) ? weekly.projects : [])
        const cameras = Array.isArray(byDay?.cameras) ? byDay.cameras : (Array.isArray(weekly?.cameras) ? weekly.cameras : [])
        const events = Array.isArray(byDay?.events) ? byDay.events : []
        const logins = Array.isArray(byDay?.logins) ? byDay.logins : (Array.isArray(weekly?.logins) ? weekly.logins : [])
        const loginFails = Array.isArray(byDay?.login_fails) ? byDay.login_fails : []
        const labels = Array.isArray(byDay?.labels) ? byDay.labels : getLast7DayLabels()

        const len = Math.max(7, projects.length, cameras.length, events.length, logins.length, loginFails.length, labels.length)
        const normalize = (arr) => Array.from({ length: len }, (_, i) => Number(arr?.[i] ?? 0))
        const normalizedLabels = Array.from({ length: len }, (_, i) => String(labels?.[i] ?? ''))
        return {
            labels: normalizedLabels.slice(-7),
            projects: normalize(projects).slice(-7),
            cameras: normalize(cameras).slice(-7),
            events: normalize(events).slice(-7),
            logins: normalize(logins).slice(-7),
            loginFails: normalize(loginFails).slice(-7),
        }
    })()

    const series = usingLive
        ? [
            { name: "Events",      data: live.events,     type: "line" },
            { name: "Projects", data: live.projects, type: "line" },
            { name: "Cameras",  data: live.cameras,  type: "line" },
            { name: "Logins",   data: live.logins,   type: "line" },
            { name: "Login Fails", data: live.loginFails, type: "line" },
        ]
        : [
            { name: "Events",      data: [10, 12, 8, 14, 9, 16, 11], type: "line" },
            { name: "Projects", data: [2, 1, 0, 3, 1, 2, 1], type: "line" },
            { name: "Cameras",  data: [1, 0, 0, 2, 1, 0, 1], type: "line" },
            { name: "Logins",   data: [6, 5, 7, 8, 6, 9, 7], type: "line" },
            { name: "Login Fails", data: [1, 0, 2, 1, 1, 0, 1], type: "line" },
        ]

    const categories = usingLive
        ? live.labels
        : getLast7DayLabels()

    return {
        chart: {
            height: 370,
            type: "line",
            stacked: false,
            toolbar: { show: false },
            animations: { enabled: true, speed: 600 },
            dropShadow: {
                enabled: true,
                top: 12,
                left: 0,
                blur: 18,
                opacity: 0.16,
            },
        },
        xaxis: {
            categories,
            axisBorder: { show: false },
            axisTicks: { show: false },
            labels: { style: { fontSize: "11px", colors: "#64748b" } },
        },
        yaxis: {
            min: 0,
            tickAmount: 5,
            labels: {
                formatter: (e) => Math.round(e),
                offsetX: -15,
                offsetY: 0,
                style: { fontSize: "11px", colors: "#64748b" },
            },
        },
        stroke: {
            curve: "smooth",
            width: [3.5, 3.5, 3.5, 3.5, 2.5],
            lineCap: "round",
            dashArray: [0, 0, 0, 0, 6],
        },
        grid: {
            padding: { left: 10, right: 0 },
            strokeDashArray: 3,
            borderColor: "#ebebf3",
            row: { colors: ["#ebebf3", "transparent"], opacity: 0.02 },
        },
        legend: {
            show: true,
            position: "top",
            horizontalAlign: "right",
            fontSize: "12px",
            labels: { colors: "#94a3b8" },
        },
        colors: ["#a855f7", "#3454d1", "#25b865", "#f97316", "#ef4444"],
        dataLabels: { enabled: false },
        fill: { opacity: 1 },
        markers: {
            size: 5,
            colors: ["#a855f7", "#3454d1", "#25b865", "#f97316", "#ef4444"],
            strokeColors: "#fff",
            strokeWidth: 2,
            hover: { size: 6 },
        },
        series,
        tooltip: {
            y: { formatter: (e) => Math.round(e) },
            style: { fontSize: "12px", fontFamily: "Inter" },
        },
    }
}
