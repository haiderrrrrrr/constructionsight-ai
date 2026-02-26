import PropTypes from 'prop-types'
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts'

const COLORS = ['#4361ee', '#3bc9db', '#f59f00', '#f03e3e', '#37b24d', '#7950f2', '#fd7e14']

const ChartRenderer = ({ chart }) => {
  if (!chart || !chart.data || !chart.data.length) return null

  const { type, data, x_key, y_keys = [], y_labels = {}, title } = chart
  const isDark = document.documentElement.classList.contains('app-skin-dark')
  const axisColor = isDark ? '#8898aa' : '#6b7885'
  const gridColor = isDark ? '#2d3748' : '#e9ecef'
  const tickStyle = { fontSize: 11, fill: axisColor }
  const tooltipStyle = isDark
    ? { backgroundColor: '#0b1220', border: '1px solid #1b2436', color: '#e5e7eb', borderRadius: 10 }
    : { backgroundColor: '#ffffff', border: '1px solid #e9ecef', color: '#111827', borderRadius: 10 }

  if (type === 'pie') {
    return (
      <ChartWrapper title={title}>
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie data={data} dataKey={y_keys[0] || 'value'} nameKey={x_key || 'name'}
              cx="50%" cy="50%" outerRadius={90}
              label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
              labelLine={false}>
              {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} formatter={(value, name) => [value, y_labels[name] || formatLabel(name)]} />
          </PieChart>
        </ResponsiveContainer>
      </ChartWrapper>
    )
  }

  if (type === 'line') {
    return (
      <ChartWrapper title={title}>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
            <XAxis dataKey={x_key} tick={tickStyle} tickLine={false} axisLine={false}
              tickFormatter={v => typeof v === 'string' ? v.slice(0, 10) : v} />
            <YAxis tick={tickStyle} tickLine={false} axisLine={false} width={40} />
            <Tooltip contentStyle={{ ...tooltipStyle, fontSize: 12 }} formatter={(value, name) => [value, y_labels[name] || formatLabel(name)]} />
            <Legend wrapperStyle={{ fontSize: 11, color: axisColor }} />
            {y_keys.map((key, i) => (
              <Line key={key} type="monotone" dataKey={key} stroke={COLORS[i % COLORS.length]}
                name={y_labels[key] || formatLabel(key)}
                strokeWidth={2} dot={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </ChartWrapper>
    )
  }

  return (
    <ChartWrapper title={title}>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
          <XAxis dataKey={x_key} tick={tickStyle} tickLine={false} axisLine={false}
            tickFormatter={v => typeof v === 'string' && v.length > 14 ? v.slice(0, 14) + '…' : v} />
          <YAxis tick={tickStyle} tickLine={false} axisLine={false} width={40} />
          <Tooltip contentStyle={{ ...tooltipStyle, fontSize: 12 }} formatter={(value, name) => [value, y_labels[name] || formatLabel(name)]} />
          <Legend wrapperStyle={{ fontSize: 11, color: axisColor }} />
          {y_keys.map((key, i) => (
            <Bar key={key} dataKey={key} name={y_labels[key] || formatLabel(key)}
              fill={COLORS[i % COLORS.length]} radius={[3, 3, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartWrapper>
  )
}

const ChartWrapper = ({ title, children }) => (
  <div className="mt-3 p-3 sq-panel">
    {title && <div className="mb-2" style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--bs-secondary-color)' }}>{title}</div>}
    {children}
  </div>
)

const formatLabel = (value) => String(value || 'Value')
  .replace(/_/g, ' ')
  .replace(/\b\w/g, c => c.toUpperCase())

export default ChartRenderer

ChartWrapper.propTypes = {
  title: PropTypes.string,
  children: PropTypes.node,
}

ChartRenderer.propTypes = {
  chart: PropTypes.shape({
    type: PropTypes.oneOf(['bar', 'line', 'pie']),
    data: PropTypes.arrayOf(PropTypes.object),
    x_key: PropTypes.string,
    y_keys: PropTypes.arrayOf(PropTypes.string),
    y_labels: PropTypes.object,
    title: PropTypes.string,
  }),
}
