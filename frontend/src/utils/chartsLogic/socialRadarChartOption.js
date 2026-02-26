export const socialRadarChartOption = (stats) => {
    const usingLive = !!stats?.weekly_activity

    const series = usingLive
        ? [
            { name: "Projects", data: stats.weekly_activity.projects },
            { name: "Cameras",  data: stats.weekly_activity.cameras  },
            { name: "Logins",   data: stats.weekly_activity.logins   },
        ]
        : [
            { name: "Facebook", data: [80, 50, 30, 40, 100, 20] },
            { name: "Twitter",  data: [20, 30, 40, 80, 20, 80]  },
            { name: "Youtube",  data: [44, 76, 78, 13, 43, 10]  },
        ]

    return {
        series,
        chart: {
            height: 376,
            type: "radar",
            toolbar: { show: false },
            animations: { enabled: true, speed: 600 },
        },
        colors: ["#3454D1", "#25b865", "#f97316"],
        fill: {
            opacity: 0.22,
        },
        stroke: {
            show: true,
            width: 2,
        },
        xaxis: {
            categories: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri"],
            labels: { style: { colors: Array(6).fill("#64748b"), fontFamily: "Inter", fontSize: "12px" } },
        },
        yaxis: { show: false, stepSize: 20 },
        tooltip: {
            y: { formatter: (e) => +e },
            style: { colors: "#64748b", fontFamily: "Inter" },
        },
        markers: { size: 4, hover: { size: 6 } },
        plotOptions: {
            radar: {
                polygons: {
                    strokeColors: "#334155",
                    strokeWidth: 1,
                    connectorColors: "#334155",
                    fill: { colors: ["transparent", "transparent"] },
                },
            },
        },
        legend: {
            show: true,
            height: 65,
            offsetY: 0,
            labels: { colors: "#64748b", fontFamily: "Inter" },
        },
    }
}
