import { useState } from 'react';
import { formatDate } from '../../lib/format';

const width = 880;
const height = 260;
const margin = { top: 16, right: 16, bottom: 32, left: 78 };
const plotWidth = width - margin.left - margin.right;
const plotHeight = height - margin.top - margin.bottom;
const axisMonth = new Intl.DateTimeFormat('es-ES', { month: 'short', year: '2-digit', timeZone: 'UTC' });

const toTime = (date) => Date.parse(`${date}T00:00:00Z`);

// series[0] es el escenario; series[1] (opcional) es la referencia sin cambios.
export default function SimulationChart({ series, markers = [], step = false, formatValue, zeroBased = false, label }) {
  const [hover, setHover] = useState(null);
  const main = series[0].points;
  if (main.length === 0) return <p className="muted">No hay datos que mostrar.</p>;

  const all = series.flatMap((item) => item.points);
  const firstTime = toTime(all[0].date);
  const lastTime = Math.max(...all.map((point) => toTime(point.date)));
  const values = all.map((point) => point.value);
  let yMin = zeroBased ? 0 : Math.min(...values);
  let yMax = Math.max(...values);
  const pad = (yMax - yMin || 1) * 0.08;
  yMax += pad;
  if (!zeroBased) yMin -= pad;

  const x = (date) => margin.left + ((toTime(date) - firstTime) / (lastTime - firstTime || 1)) * plotWidth;
  const y = (value) => margin.top + ((yMax - value) / (yMax - yMin || 1)) * plotHeight;
  const buildPath = (points) => points.map((point, index) => {
    if (index === 0) return `M${x(point.date).toFixed(1)},${y(point.value).toFixed(1)}`;
    if (!step) return `L${x(point.date).toFixed(1)},${y(point.value).toFixed(1)}`;
    return `H${x(point.date).toFixed(1)}V${y(point.value).toFixed(1)}`;
  }).join('');

  const yTicks = [0, 1, 2, 3].map((index) => yMax - ((yMax - yMin) * index) / 3);
  const xTicks = [0, 1, 2, 3, 4].map((index) => new Date(firstTime + ((lastTime - firstTime) * index) / 4));
  const byDate = series.map((item) => new Map(item.points.map((point) => [point.date, point])));

  function handleMove(event) {
    const box = event.currentTarget.getBoundingClientRect();
    const svgX = ((event.clientX - box.left) / box.width) * width;
    const time = firstTime + ((svgX - margin.left) / plotWidth) * (lastTime - firstTime);
    let nearest = main[0];
    for (const point of main) {
      if (Math.abs(toTime(point.date) - time) < Math.abs(toTime(nearest.date) - time)) nearest = point;
    }
    setHover(nearest.date);
  }

  const hovered = hover && byDate[0].get(hover);
  const hoveredBase = hover && series[1] ? byDate[1].get(hover) : null;

  return (
    <div className="sim-chart" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} onMouseMove={handleMove}>
        {yTicks.map((value) => (
          <g key={value}>
            <line className="sim-grid" x1={margin.left} x2={width - margin.right} y1={y(value)} y2={y(value)} />
            <text className="sim-label sim-label--y" x={margin.left - 10} y={y(value) + 4}>{formatValue(value)}</text>
          </g>
        ))}
        {xTicks.map((date) => (
          <text className="sim-label sim-label--x" key={date.toISOString()} x={x(date.toISOString().slice(0, 10))} y={height - 10}>
            {axisMonth.format(date)}
          </text>
        ))}
        {markers.map((marker) => (
          <line key={marker.date} className="sim-marker" x1={x(marker.date)} x2={x(marker.date)} y1={margin.top} y2={margin.top + plotHeight} />
        ))}
        {series.slice(1).map((item) => (
          <path key={item.name} className="sim-line sim-line--base" d={buildPath(item.points)} />
        ))}
        <path className="sim-line" d={buildPath(main)} />
        {hovered && (
          <g>
            <line className="sim-hover-line" x1={x(hovered.date)} x2={x(hovered.date)} y1={margin.top} y2={margin.top + plotHeight} />
            <circle className="sim-dot" cx={x(hovered.date)} cy={y(hovered.value)} r="4.5" />
          </g>
        )}
      </svg>
      {hovered && (
        <div
          className="sim-tooltip"
          style={{ left: `${Math.min(Math.max((x(hovered.date) / width) * 100, 14), 86)}%` }}
        >
          <span>{formatDate(hovered.date)}</span>
          <strong>{formatValue(hovered.value)}</strong>
          {hoveredBase && Math.abs(hoveredBase.value - hovered.value) > 0.005 && (
            <em>Sin cambios: {formatValue(hoveredBase.value)}</em>
          )}
        </div>
      )}
    </div>
  );
}
