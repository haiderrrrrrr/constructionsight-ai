import React, { useMemo } from 'react'
import ReactApexChart from 'react-apexcharts'
import { tasksOverviewChartOption } from '@/utils/chartsLogic/tasksOverviewChatOption'
import getIcon from '@/utils/getIcon'

const buildDailySeries = ({ items, dateKey, days }) => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    start.setDate(start.getDate() - (days - 1))

    const buckets = Array.from({ length: days }, () => 0)
    for (const it of items) {
        const raw = it?.[dateKey]
        if (!raw) continue
        const d = new Date(raw)
        if (Number.isNaN(d.getTime())) continue
        const day = new Date(d)
        day.setHours(0, 0, 0, 0)
        const idx = Math.floor((day.getTime() - start.getTime()) / (24 * 60 * 60 * 1000))
        if (idx >= 0 && idx < days) buckets[idx] += 1
    }
    return buckets
}

const sum = (arr) => arr.reduce((a, b) => a + b, 0)

const pctChange = (current, previous) => {
    const c = Number(current) || 0
    const p = Number(previous) || 0
    if (p <= 0) return c > 0 ? 100 : 0
    return Math.round(((c - p) / p) * 100)
}

const clamp = (n, min, max) => Math.max(min, Math.min(max, n))

const ProjectTasksOverviewCharts = ({ tasks }) => {
    const list = Array.isArray(tasks) ? tasks : []
    const chartOptions = tasksOverviewChartOption()

    const {
        total,
        completed,
        pending,
        createdSeries,
        doneSeries,
        pendingSeries,
        completionRateSeries,
        newThisWeek,
        newPrevWeek,
        doneThisWeek,
        donePrevWeek,
        pendingThisWeek,
        pendingPrevWeek,
    } = useMemo(() => {
        const totalCount = list.length
        const completedCount = list.filter(t => t?.is_done).length
        const pendingCount = totalCount - completedCount

        const created7 = buildDailySeries({ items: list, dateKey: 'created_at', days: 7 })
        const done7 = buildDailySeries({ items: list, dateKey: 'done_at', days: 7 })

        const created14 = buildDailySeries({ items: list, dateKey: 'created_at', days: 14 })
        const done14 = buildDailySeries({ items: list, dateKey: 'done_at', days: 14 })

        const createdPrev7 = created14.slice(0, 7)
        const createdThis7 = created14.slice(7)
        const donePrev7 = done14.slice(0, 7)
        const doneThis7 = done14.slice(7)

        const pendingRunning = []
        let c = 0
        let d = 0
        for (let i = 0; i < 7; i += 1) {
            c += created7[i] || 0
            d += done7[i] || 0
            pendingRunning.push(Math.max(0, c - d))
        }

        const completionRunning = []
        let cc = 0
        let dd = 0
        for (let i = 0; i < 7; i += 1) {
            cc += created7[i] || 0
            dd += done7[i] || 0
            completionRunning.push(cc > 0 ? Math.round((dd / cc) * 100) : 0)
        }

        return {
            total: totalCount,
            completed: completedCount,
            pending: pendingCount,
            createdSeries: created7,
            doneSeries: done7,
            pendingSeries: pendingRunning,
            completionRateSeries: completionRunning,
            newThisWeek: sum(createdThis7),
            newPrevWeek: sum(createdPrev7),
            doneThisWeek: sum(doneThis7),
            donePrevWeek: sum(donePrev7),
            pendingThisWeek: Math.max(0, sum(createdThis7) - sum(doneThis7)),
            pendingPrevWeek: Math.max(0, sum(createdPrev7) - sum(donePrev7)),
        }
    }, [list])

    const overviewInfo = useMemo(() => {
        const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0
        const cards = [
            {
                title: "Tasks Completed",
                icon: "feather-star",
                total_number: String(total),
                completed_number: String(completed),
                progress: String(clamp(pctChange(doneThisWeek, donePrevWeek), 0, 999)),
                chartColor: "#3454d1",
                color: "primary",
                series: doneSeries,
            },
            {
                title: "Pending Tasks",
                icon: "feather-clock",
                total_number: String(pendingThisWeek),
                completed_number: String(pendingThisWeek),
                progress: String(clamp(pctChange(pendingThisWeek, pendingPrevWeek), 0, 999)),
                chartColor: "#f59e0b",
                color: "warning",
                series: pendingSeries,
            },
            {
                title: "Completion Rate",
                icon: "feather-airplay",
                total_number: "100",
                completed_number: String(completionRate),
                progress: String(clamp(pctChange(completionRate, completionRateSeries[0] ?? 0), 0, 999)),
                chartColor: "#0ea5e9",
                color: "info",
                series: completionRateSeries,
            },
        ]
        return cards
    }, [completed, completionRateSeries, createdSeries, donePrevWeek, doneSeries, doneThisWeek, newPrevWeek, newThisWeek, pending, pendingPrevWeek, pendingSeries, pendingThisWeek, total])

    return (
        <>
            <style>{`
                .task-overview-card .avatar-text i { color: var(--bs-body-color); }
                html.app-skin-dark .task-overview-card .avatar-text i { color: #fff; }
                html:not(.app-skin-dark) .task-overview-card .card {
                    border: 1px solid rgba(15, 23, 42, 0.1);
                    border-top: 2px solid rgba(15, 23, 42, 0.14);
                    box-shadow: 0 10px 28px rgba(15, 23, 42, 0.06);
                }
            `}</style>
            {overviewInfo.map(({ completed_number, icon, progress, title, total_number, chartColor, color, series }, index) => {
                const data = Array.isArray(series) && series.length === 7 ? series : [44, 55, 41, 60, 52, 66, 51]
                return (
                    <div key={index} className="col-xxl-4 col-xl-4 col-lg-4 col-md-6 task-overview-card">
                        <div className="card mb-4 stretch stretch-full">
                            <div className="card-header d-flex align-items-center justify-content-between">
                                <div className="d-flex gap-3 align-items-center">
                                    <div className="avatar-text">
                                        <i className='fs-16'>{getIcon(icon)}</i>
                                    </div>
                                    <div>
                                        <div className="fw-semibold text-dark">{title}</div>
                                        <div className="fs-12 text-muted">{completed_number}/{total_number} completed</div>
                                    </div>
                                </div>
                                <div className="fs-4 fw-bold text-dark">{completed_number}/{total_number}</div>
                            </div>
                            <div className="card-body d-flex align-items-center justify-content-between gap-4">
                                <ReactApexChart
                                    key={`${title}-${data.join(',')}`}
                                    options={{ ...chartOptions, colors: [chartColor] }}
                                    series={[{ name: title, data }]}
                                    type='area'
                                    height={100}
                                />
                                <div className="fs-12 text-muted text-nowrap">
                                    <span className={`fw-semibold text-${color}`}>{progress}% more</span><br />
                                    <span>from last week</span>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            })}
        </>
    )
}

export default ProjectTasksOverviewCharts
