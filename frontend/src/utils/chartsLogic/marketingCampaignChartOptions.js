export const marketingCampaignChartOptions = (stats) => {
    const usingLive = !!stats

    const series = usingLive
        ? [
            { name: "Projects Created", data: stats.monthly_projects },
            { name: "Cameras Added",    data: stats.monthly_cameras  },
        ]
        : [
            { name: "Online Campaign",  data: [44, 55, 41, 64, 22, 43, 21, 41, 64, 22, 43, 21] },
            { name: "Offline Campaign", data: [53, 32, 33, 52, 13, 44, 32, 33, 52, 13, 44, 32] },
        ]

    return {
        chart: { toolbar: { show: false }, animations: { enabled: true, speed: 600 } },
        series,
        plotOptions: {
            bar: {
                horizontal: false,
                borderRadius: 6,
                borderRadiusApplication: "end",
                columnWidth: "32%",
            },
        },
        dataLabels: { enabled: false },
        stroke: { show: false },
        colors: ["#3454d1", "#25b865"],
        fill: {
            type: ["gradient", "gradient"],
            gradient: {
                type: "vertical",
                shadeIntensity: 0.4,
                opacityFrom: 1,
                opacityTo: 0.6,
                stops: [0, 100],
            },
        },
        xaxis: {
            categories: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
            axisBorder: { show: false },
            axisTicks: { show: false },
            labels: { style: { colors: "#64748b", fontFamily: "Inter" } },
        },
        yaxis: {
            labels: {
                formatter: (e) => Math.round(e),
                offsetX: 6,
                style: { colors: "#64748b", fontFamily: "Inter" },
            },
        },
        grid: {
            strokeDashArray: 3,
            borderColor: "#e9ecef",
            padding: { left: 20, right: 0 },
        },
        tooltip: {
            y: { formatter: (e) => Math.round(e) },
            style: { colors: "#64748b", fontFamily: "Inter" },
        },
        legend: {
            show: true,
            fontFamily: "Inter",
            labels: { colors: "#64748b" },
            position: "top",
            horizontalAlign: "right",
        },
    }
}
