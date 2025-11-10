import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function SpeedChart({ title, data, color = '#0ea5e9', height = 200, format = 'bytes' }) {
  const formatValue = (value) => {
    if (format === 'number') {
      // Format as plain number (for Peers, Seeds, etc.)
      return Math.round(value).toString();
    }
    // Format as bytes (default)
    if (value === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let unitIndex = 0;
    let val = value;
    while (val >= 1024 && unitIndex < units.length - 1) {
      val /= 1024;
      unitIndex++;
    }
    return `${val.toFixed(1)} ${units[unitIndex]}`;
  };

  const chartData = data
    .filter(point => point && (point.value !== undefined && point.value !== null))
    .map((point, index) => ({
      time: index,
      value: point.value || 0,
    }));

  // Get theme colors from CSS variables
  const getThemeColor = (varName) => {
    if (typeof window !== 'undefined') {
      return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || '#94a3b8';
    }
    return '#94a3b8';
  };

  const gridColor = getThemeColor('--border') || '#475569';
  const axisColor = getThemeColor('--text-tertiary') || '#94a3b8';
  const tooltipBg = getThemeColor('--bg-secondary') || '#1e293b';
  const tooltipBorder = getThemeColor('--border') || '#334155';
  const tooltipText = getThemeColor('--text-primary') || '#f1f5f9';

  return (
    <div className={height < 150 ? '' : 'card'}>
      {height >= 150 && <h3 className="text-lg font-semibold mb-4 theme-text-primary">{title}</h3>}
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
          <XAxis 
            dataKey="time" 
            stroke={axisColor}
            tick={{ fill: axisColor, fontSize: 12 }}
            hide
          />
          <YAxis 
            stroke={axisColor}
            tick={{ fill: axisColor, fontSize: 12 }}
            tickFormatter={formatValue}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: tooltipBg,
              border: `1px solid ${tooltipBorder}`,
              borderRadius: '8px',
              color: tooltipText,
            }}
            formatter={(value) => [formatValue(value), title]}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            dot={false}
            isAnimationActive={true}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

