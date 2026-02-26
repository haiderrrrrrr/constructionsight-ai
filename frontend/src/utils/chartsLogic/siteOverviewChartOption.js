export const siteOverviewChartOption = (colors, series) => {
    const chartOptions = {
        chart: {
            type: "area",
            height: 80,
            sparkline: { enabled: true },
            animations: { enabled: true, speed: 600 },
        },
        series: [series],
        stroke: {
            width: 2.5,
            curve: "smooth",
        },
        fill: {
            type: "gradient",
            gradient: {
                inverseColors: false,
                shade: "light",
                type: "vertical",
                opacityFrom: 0.55,
                opacityTo: 0.05,
                stops: [0, 100],
            },
        },
        markers: {
            size: 0,
            hover: { size: 4 },
        },
        yaxis: { min: 0 },
        colors,
    }
    return chartOptions
}
