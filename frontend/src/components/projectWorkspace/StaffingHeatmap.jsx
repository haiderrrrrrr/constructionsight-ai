import { useState, useMemo } from 'react'
import * as d3 from 'd3'

const MARGIN = { top: 10, right: 50, bottom: 30, left: 50 }

const Renderer = ({ width, height, data, setHoveredCell, isDark }) => {
  const boundsWidth = width - MARGIN.right - MARGIN.left
  const boundsHeight = height - MARGIN.top - MARGIN.bottom

  const allYGroups = useMemo(() => [...new Set(data.map((d) => d.y))].sort(), [data])

  // Generate all hours from 0 to current hour
  const currentHour = new Date().getHours()
  const allXGroups = useMemo(() => {
    const hours = Array.from({ length: currentHour + 1 }, (_, i) => `${i}h`)
    return hours
  }, [currentHour])

  const [min = 0, max = 0] = d3.extent(data.map((d) => d.value))

  const xScale = useMemo(() => {
    return d3
      .scaleBand()
      .range([0, boundsWidth])
      .domain(allXGroups)
      .padding(0.01)
  }, [boundsWidth, allXGroups])

  const yScale = useMemo(() => {
    return d3
      .scaleBand()
      .range([boundsHeight, 0])
      .domain(allYGroups)
      .padding(0.01)
  }, [boundsHeight, allYGroups])

  const colorScale = d3
    .scaleSequential()
    .interpolator(d3.interpolateRgbBasis(['#ef4444', '#f59e0b', '#22c55e']))
    .domain([0, 1])
    .clamp(true)

  // Create a map for quick lookup of data
  const dataMap = useMemo(() => {
    const map = {}
    data.forEach(d => {
      map[`${d.x}:${d.y}`] = d
    })
    return map
  }, [data])

  // Generate all cells (both with and without data)
  const allShapes = allYGroups.map((y) =>
    allXGroups.map((x) => {
      const xPos = xScale(x)
      const yPos = yScale(y)
      const dataPoint = dataMap[`${x}:${y}`]

      if (!xPos || !yPos) return null

      const hasData = dataPoint !== undefined
      const fillColor = hasData
        ? colorScale(dataPoint.value)
        : isDark ? 'rgba(255,255,255,0.08)' : 'rgba(100,116,139,0.08)'

      return (
        <rect
          key={`${x}:${y}`}
          x={xPos}
          y={yPos}
          width={xScale.bandwidth()}
          height={yScale.bandwidth()}
          opacity={hasData ? 0.88 : 0.5}
          fill={fillColor}
          rx={4}
          stroke="none"
          onMouseEnter={() => {
            if (hasData) {
              setHoveredCell({
                xLabel: x,
                yLabel: y,
                xPos: xPos + xScale.bandwidth() + MARGIN.left,
                yPos: yPos + yScale.bandwidth() / 2 + MARGIN.top,
                value: dataPoint.displayValue !== undefined ? dataPoint.displayValue : dataPoint.value,
              })
            }
          }}
          onMouseLeave={() => setHoveredCell(null)}
          style={{ cursor: hasData ? 'pointer' : 'default' }}
        />
      )
    })
  ).flat()

  const textColor = isDark ? 'rgba(255,255,255,0.72)' : 'rgba(100,116,139,0.8)'

  const xLabels = allXGroups.map((name, i) => {
    const x = xScale(name)

    if (!x) {
      return null
    }

    return (
      <text
        key={i}
        x={x + xScale.bandwidth() / 2}
        y={boundsHeight + 10}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize="10"
        fill={textColor}
      >
        {name}
      </text>
    )
  })

  const yLabels = allYGroups.map((name, i) => {
    const y = yScale(name)

    if (!y) {
      return null
    }

    return (
      <text
        key={i}
        x={-5}
        y={y + yScale.bandwidth() / 2}
        textAnchor="end"
        dominantBaseline="middle"
        fontSize="10"
        fill={textColor}
      >
        {name}
      </text>
    )
  })

  return (
    <svg width={width} height={height}>
      <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
        {allShapes}
        {xLabels}
        {yLabels}
      </g>
    </svg>
  )
}

const Tooltip = ({ interactionData, width, height, isDark }) => {
  if (!interactionData) {
    return null
  }

  return (
    <div
      style={{
        width,
        height,
        position: 'absolute',
        top: 0,
        left: 0,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: interactionData.xPos,
          top: interactionData.yPos,
          backgroundColor: isDark ? 'rgba(10,18,32,0.96)' : 'rgba(0,0,0,0.8)',
          borderRadius: '4px',
          color: 'white',
          fontSize: '12px',
          padding: '4px 8px',
          marginLeft: '15px',
          transform: 'translateY(-50%)',
          border: isDark ? '1px solid rgba(255,255,255,0.12)' : 'none',
          whiteSpace: 'nowrap',
        }}
      >
        <div><b>{interactionData.yLabel}</b> · {interactionData.xLabel}</div>
        <div style={{ marginTop: '2px', opacity: 0.9 }}>{Math.round(interactionData.value)} workers</div>
      </div>
    </div>
  )
}

export const StaffingHeatmap = ({ width, height, data, isDark = false }) => {
  const [hoveredCell, setHoveredCell] = useState(null)

  return (
    <div style={{ position: 'relative' }}>
      <Renderer
        width={width}
        height={height}
        data={data}
        setHoveredCell={setHoveredCell}
        isDark={isDark}
      />
      <Tooltip interactionData={hoveredCell} width={width} height={height} isDark={isDark} />
    </div>
  )
}
