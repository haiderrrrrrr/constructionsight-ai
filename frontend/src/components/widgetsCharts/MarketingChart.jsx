import useCardTitleActions from '@/hooks/useCardTitleActions'
import ReactApexChart from 'react-apexcharts'
import CardHeader from '@/components/shared/CardHeader'
import CardLoader from '@/components/shared/CardLoader'
import PropTypes from 'prop-types'

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

const buildWeeklyOptions = (stats) => {
    const live = stats?.last_7_days || null
    const labels = Array.isArray(live?.labels) ? live.labels : getLast7DayLabels()
    const projects = Array.isArray(live?.projects) ? live.projects : []
    const cameras = Array.isArray(live?.cameras) ? live.cameras : []
    const logins = Array.isArray(live?.logins) ? live.logins : []
    const events = Array.isArray(live?.events) ? live.events : []

    const len = Math.max(7, labels.length, projects.length, cameras.length, logins.length, events.length)
    const normalize = (arr) => Array.from({ length: len }, (_, i) => Number(arr?.[i] ?? 0))
    const cats = Array.from({ length: len }, (_, i) => String(labels?.[i] ?? '')).slice(-7)

    const series = [
        { name: 'Projects', data: normalize(projects).slice(-7) },
        { name: 'Cameras', data: normalize(cameras).slice(-7) },
        { name: 'Logins', data: normalize(logins).slice(-7) },
        { name: 'Events', data: normalize(events).slice(-7) },
    ]

    return {
        chart: { type: 'bar', stacked: true, toolbar: { show: false }, animations: { enabled: true, speed: 650 } },
        plotOptions: { bar: { columnWidth: '46%', borderRadius: 7 } },
        dataLabels: { enabled: false },
        grid: { borderColor: '#ebebf3', strokeDashArray: 3, padding: { left: 14, right: 10 } },
        xaxis: { categories: cats, labels: { style: { fontSize: '11px', colors: '#64748b' } }, axisBorder: { show: false }, axisTicks: { show: false } },
        yaxis: { min: 0, tickAmount: 5, labels: { style: { fontSize: '11px', colors: '#64748b' } } },
        legend: { show: true, position: 'top', horizontalAlign: 'right', fontSize: '12px', labels: { colors: '#94a3b8' } },
        colors: ['#3454d1', '#25b865', '#f97316', '#a855f7'],
        tooltip: { y: { formatter: (v) => Math.round(v) } },
        series,
    }
}

const MarketingChart = ({ stats }) => {
    const chartOptions = buildWeeklyOptions(stats)

    const { refreshKey, isRemoved, isExpanded, handleRefresh, handleExpand, handleDelete } = useCardTitleActions()

    if (isRemoved) {
        return null;
    }

    return (
        <div className="col-xxl-8 d-flex">
            <div className={`card stretch stretch-full flex-grow-1 ${isExpanded ? "card-expand" : ""} ${refreshKey ? "card-loading" : ""}`}>
                <CardHeader title={"Weekly Activity"} refresh={handleRefresh} remove={handleDelete} expanded={handleExpand} />
                <div className="card-body custom-card-action p-0">
                    <ReactApexChart
                        options={chartOptions}
                        series={chartOptions.series}
                        height={370}
                        type='bar'
                    />
                </div>
                <CardLoader refreshKey={refreshKey} />
            </div>
        </div>
    )
}

export default MarketingChart

MarketingChart.propTypes = {
    stats: PropTypes.object,
}
