import ReactApexChart from 'react-apexcharts'
import { siteOverviewChartOption } from '@/utils/chartsLogic/siteOverviewChartOption'
import PropTypes from 'prop-types'

const pct = (num, total) => total > 0 ? Math.round((num / total) * 100) : 0
const ZERO_COUNTS = { total_projects: 0, active: 0, archived: 0, draft: 0, setup: 0, total_cameras: 0, online_cameras: 0, total_users: 0, approved_users: 0 }

const buildLiveData = (counts) => [
    {
        id: 1,
        title: "Active Projects",
        average_user: pct(counts.active, counts.total_projects),
        todays_user: pct(counts.active, counts.total_projects),
        prev_user: pct(counts.draft, counts.total_projects),
        colors: ["#3454d1"],
    },
    {
        id: 2,
        title: "Online Cameras",
        average_user: pct(counts.online_cameras, counts.total_cameras),
        todays_user: pct(counts.online_cameras, counts.total_cameras),
        prev_user: pct(counts.total_cameras - counts.online_cameras, counts.total_cameras),
        colors: ["#25b865"],
    },
    {
        id: 3,
        title: "Approved Users",
        average_user: pct(counts.approved_users, counts.total_users),
        todays_user: pct(counts.approved_users, counts.total_users),
        prev_user: pct(counts.total_users - counts.approved_users, counts.total_users),
        colors: ["#e49e3d"],
    },
    {
        id: 4,
        title: "Setup Complete",
        average_user: pct(counts.active + counts.archived, counts.total_projects),
        todays_user: pct(counts.active + counts.archived, counts.total_projects),
        prev_user: pct(counts.draft + counts.setup, counts.total_projects),
        colors: ["#64748a"],
    },
]

const SiteOverviewChart = ({ stats }) => {
    const data = buildLiveData(stats?.counts || ZERO_COUNTS)
    const sparkMonthly = (() => {
        const arr = Array.isArray(stats?.monthly_events) ? stats.monthly_events : []
        const base = arr.filter(n => typeof n === 'number' && Number.isFinite(n))
        if (base.length >= 8) return base.slice(-9)
        const pad = Array.from({ length: Math.max(0, 9 - base.length) }, () => 0)
        return [...pad, ...base].slice(-9)
    })()
    const sparkProjects = (() => {
        const arr = Array.isArray(stats?.monthly_projects) ? stats.monthly_projects : []
        const base = arr.filter(n => typeof n === 'number' && Number.isFinite(n))
        if (base.length >= 8) return base.slice(-9)
        const pad = Array.from({ length: Math.max(0, 9 - base.length) }, () => 0)
        return [...pad, ...base].slice(-9)
    })()
    const sparkCameras = (() => {
        const arr = Array.isArray(stats?.monthly_cameras) ? stats.monthly_cameras : []
        const base = arr.filter(n => typeof n === 'number' && Number.isFinite(n))
        if (base.length >= 8) return base.slice(-9)
        const pad = Array.from({ length: Math.max(0, 9 - base.length) }, () => 0)
        return [...pad, ...base].slice(-9)
    })()

    return (
        <>
            {
                data.map(({ average_user, id, prev_user, title, todays_user, colors }) => {
                    const spark = id === 1 ? sparkProjects : id === 2 ? sparkCameras : sparkMonthly
                    const series = {
                        name: title,
                        data: spark
                    }

                    const chartOption = siteOverviewChartOption(colors, series)

                    return (
                        <div key={id} className="col-xxl-3 col-md-6">
                            <div className="card stretch stretch-full">
                                <div className="card-body p-0">
                                    <div className="d-flex justify-content-between p-4 mb-4">
                                        <div>
                                            <div className="fw-bold mb-2 text-reset text-truncate-1-line">{title} (Avg)</div>
                                            <div className="fs-11 text-muted">VS {prev_user}% (Prev)</div>
                                        </div>
                                        <div className="text-end">
                                            <div className="fs-24 fw-bold mb-2 text-reset"><span className="counter">{average_user}</span>%</div>
                                            {todays_user < prev_user ?
                                                <div className="fs-11 text-danger">(- {todays_user}%)</div>
                                                :
                                                <div className="fs-11 text-success">(+ {todays_user}%)</div>
                                            }
                                        </div>
                                    </div>
                                    <ReactApexChart
                                        type='area'
                                        options={chartOption}
                                        series={chartOption?.series}
                                        height={80}
                                    />
                                </div>
                            </div>
                        </div>
                    )
                })
            }
        </>
    )
}

export default SiteOverviewChart

SiteOverviewChart.propTypes = {
    stats: PropTypes.object,
}
