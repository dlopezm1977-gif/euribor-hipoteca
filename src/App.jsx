import { useMemo, useState } from 'react';
import { version } from '../package.json';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { useEuribor } from './hooks/useEuribor';
import { firebaseConfigured } from './lib/firebase';
import MortgageManager from './components/Mortgages/MortgageManager';
import {
  monthlyAverages,
  projectMortgage,
  referenceMonthsOfYear,
  reviewSummary,
} from './lib/mortgage';
import {
  formatDate as formatShortDate,
  formatEuro,
  formatMonth,
  formatSigned,
  todayIso,
} from './lib/format';

function FirebaseSetup() {
  return (
    <main className="setup-page">
      <section className="setup-card">
        <span className="eyebrow">EURÍBOR HIPOTECA</span>
        <h1>Conecta tu proyecto Firebase</h1>
        <p>
          Copia <code>.env.example</code> a <code>.env</code> y completa las
          credenciales web de Firebase. Activa Authentication con email y
          contraseña y crea la base de datos de Firestore.
        </p>
      </section>
    </main>
  );
}

function AuthForm() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, password);
    } catch (submitError) {
      setError(submitError.message || 'No se pudo completar la operación.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="auth-card">
      <span className="eyebrow">TU ESPACIO PERSONAL</span>
      <h2>{mode === 'login' ? 'Inicia sesión' : 'Crea tu cuenta'}</h2>
      <p>Guarda tus hipotecas y consulta simulaciones personalizadas.</p>
      <form onSubmit={handleSubmit}>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <label htmlFor="password">Contraseña</label>
        <input
          id="password"
          type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          minLength="6"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button--primary" type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Un momento…' : mode === 'login' ? 'Entrar' : 'Registrarme'}
        </button>
      </form>
      <button
        className="text-button"
        type="button"
        onClick={() => {
          setMode(mode === 'login' ? 'register' : 'login');
          setError('');
        }}
      >
        {mode === 'login' ? '¿Aún no tienes cuenta? Regístrate' : 'Ya tengo cuenta'}
      </button>
    </section>
  );
}

const chartWidth = 880;
const chartHeight = 320;
const chartMargins = { top: 20, right: 18, bottom: 58, left: 68 };
const dateFormatter = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

function formatDate(date) {
  return dateFormatter.format(new Date(`${date}T00:00:00Z`));
}

function formatAxisDate(date) {
  return new Intl.DateTimeFormat('es-ES', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

function EuriborChart({ rates, monthly = false, markers = [] }) {
  const [hoveredRate, setHoveredRate] = useState(null);
  const plotWidth = chartWidth - chartMargins.left - chartMargins.right;
  const plotHeight = chartHeight - chartMargins.top - chartMargins.bottom;
  const values = rates.map((rate) => Number(rate.value));
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const padding = Math.max((maxValue - minValue) * 0.08, 0.05);
  const yMin = minValue - padding;
  const yMax = maxValue + padding;
  const firstTime = Date.parse(`${rates[0].date}T00:00:00Z`);
  const lastTime = Date.parse(`${rates[rates.length - 1].date}T00:00:00Z`);
  const xForRate = (rate, index) => firstTime === lastTime
    ? chartMargins.left + plotWidth / 2
    : chartMargins.left + ((Date.parse(`${rate.date}T00:00:00Z`) - firstTime) / (lastTime - firstTime)) * plotWidth;
  const yForValue = (value) => chartMargins.top + ((yMax - value) / (yMax - yMin)) * plotHeight;
  const points = rates.map((rate, index) => ({
    ...rate,
    x: xForRate(rate, index),
    y: yForValue(Number(rate.value)),
  }));
  // Cada revisión se marca sobre el dato más cercano a su fecha.
  const markerPoints = lastTime > firstTime
    ? markers
      .map((date) => ({ date, time: Date.parse(`${date}T00:00:00Z`) }))
      .filter((marker) => marker.time >= firstTime && marker.time <= lastTime)
      .map((marker) => points.reduce((nearest, point) => (
        Math.abs(Date.parse(`${point.date}T00:00:00Z`) - marker.time)
          < Math.abs(Date.parse(`${nearest.date}T00:00:00Z`) - marker.time) ? point : nearest
      )))
    : [];
  const linePath = points.map((point, index) =>
    `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${point.y.toFixed(2)}`
  ).join(' ');
  const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(2)},${(chartMargins.top + plotHeight).toFixed(2)} L${points[0].x.toFixed(2)},${(chartMargins.top + plotHeight).toFixed(2)} Z`;
  const yTicks = Array.from({ length: 5 }, (_, index) => yMin + ((yMax - yMin) * index) / 4);
  const xTicks = Array.from({ length: 5 }, (_, index) => {
    const timestamp = firstTime + ((lastTime - firstTime) * index) / 4;
    return {
      x: chartMargins.left + (plotWidth * index) / 4,
      date: new Date(timestamp).toISOString().slice(0, 10),
    };
  });

  function handlePointerMove(event) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerX = ((event.clientX - bounds.left) / bounds.width) * chartWidth;
    const ratio = Math.max(0, Math.min(1, (pointerX - chartMargins.left) / plotWidth));
    const targetTime = firstTime + ratio * (lastTime - firstTime);
    let nearest = rates[0];
    let nearestDistance = Math.abs(Date.parse(`${nearest.date}T00:00:00Z`) - targetTime);

    for (const rate of rates.slice(1)) {
      const distance = Math.abs(Date.parse(`${rate.date}T00:00:00Z`) - targetTime);
      if (distance < nearestDistance) {
        nearest = rate;
        nearestDistance = distance;
      }
    }
    setHoveredRate(nearest);
  }

  const highlightedPoint = hoveredRate
    ? points.find((point) => point.date === hoveredRate.date)
    : null;

  return (
    <div
      className="chart-wrap"
      onPointerMove={handlePointerMove}
      onPointerLeave={() => setHoveredRate(null)}
    >
      <div className="chart-readout" aria-live="polite">
        {hoveredRate ? (
          <>
            <span>{monthly ? `Media de ${formatAxisDate(hoveredRate.date)}` : formatDate(hoveredRate.date)}</span>
            <strong>{Number(hoveredRate.value).toFixed(3)}%</strong>
          </>
        ) : (
          <span>Pasa el cursor por el gráfico para consultar un dato</span>
        )}
      </div>
      <svg
        className="euribor-chart"
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        role="img"
        aria-label={`Gráfico del Euríbor a 12 meses${monthly ? ' (media mensual)' : ''}, ${rates.length} ${monthly ? 'meses' : 'observaciones'} entre ${formatDate(rates[0].date)} y ${formatDate(rates[rates.length - 1].date)}`}
      >
        <defs>
          <linearGradient id="euribor-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#5da69a" stopOpacity="0.24" />
            <stop offset="100%" stopColor="#5da69a" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {yTicks.map((value) => {
          if (yMin <= 0 && yMax >= 0 && Math.abs(value) < (yMax - yMin) * 0.02) return null;
          const y = yForValue(value);
          return (
            <g key={value}>
              <line className="chart-grid" x1={chartMargins.left} x2={chartWidth - chartMargins.right} y1={y} y2={y} />
              <text className="chart-axis-label chart-axis-label--y" x={chartMargins.left - 12} y={y + 4}>
                {value.toFixed(2)}%
              </text>
            </g>
          );
        })}
        {yMin <= 0 && yMax >= 0 && (
          <g className="chart-zero">
            <line
              x1={chartMargins.left}
              x2={chartWidth - chartMargins.right}
              y1={yForValue(0)}
              y2={yForValue(0)}
            />
            <text className="chart-axis-label chart-axis-label--y" x={chartMargins.left - 12} y={yForValue(0) + 4}>
              0.00%
            </text>
          </g>
        )}
        {xTicks.map((tick) => (
          <text
            className="chart-axis-label chart-axis-label--x"
            key={`${tick.x}-${tick.date}`}
            x={tick.x}
            y={chartHeight - 22}
          >
            {formatAxisDate(tick.date)}
          </text>
        ))}
        <path className="chart-area" d={areaPath} />
        <path className="chart-line" d={linePath} />
        {markerPoints.map((point) => (
          <circle
            key={point.date}
            className="chart-review-dot"
            cx={point.x}
            cy={point.y}
            r="4"
          />
        ))}
        {highlightedPoint && (
          <g className="chart-highlight">
            <line
              x1={highlightedPoint.x}
              x2={highlightedPoint.x}
              y1={chartMargins.top}
              y2={chartMargins.top + plotHeight}
            />
            <circle cx={highlightedPoint.x} cy={highlightedPoint.y} r="5" />
          </g>
        )}
      </svg>
    </div>
  );
}

const pageSizes = [12, 25, 50];

function RateHistory({ rates, isLoading, error, highlightMonths = [], highlightName = '' }) {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [view, setView] = useState('monthly');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(pageSizes[0]);

  if (isLoading) return <p className="muted">Cargando histórico…</p>;
  if (error) return <p className="form-error" role="alert">{error}</p>;
  if (rates.length === 0) {
    return <p className="muted">Todavía no hay datos. Ejecuta el script de sincronización.</p>;
  }

  const firstDate = rates[0].date;
  const lastDate = rates[rates.length - 1].date;
  const filteredRates = rates.filter((rate) =>
    (!startDate || rate.date >= startDate)
      && (!endDate || rate.date <= endDate)
      && Number.isFinite(Number(rate.value))
  );

  const isMonthly = view === 'monthly';
  const monthlyRates = monthlyAverages(filteredRates).map((item) => ({
    ...item,
    date: `${item.month}-01`,
  }));
  const series = isMonthly ? monthlyRates : filteredRates;
  const pageCount = Math.max(Math.ceil(series.length / pageSize), 1);
  const currentPage = Math.min(page, pageCount);
  const pageRows = series
    .slice(Math.max(series.length - currentPage * pageSize, 0), series.length - (currentPage - 1) * pageSize)
    .reverse();
  const firstShown = (currentPage - 1) * pageSize + 1;
  const lastShown = Math.min(currentPage * pageSize, series.length);
  const unit = isMonthly ? ['mes', 'meses'] : ['dato', 'datos'];
  const markers = [];
  if (highlightMonths.length > 0 && series.length > 1) {
    const [lastYear, lastMonth] = series[series.length - 1].date.split('-').map(Number);
    let [year, month] = series[0].date.split('-').map(Number);
    while (year < lastYear || (year === lastYear && month <= lastMonth)) {
      const monthKey = String(month).padStart(2, '0');
      if (highlightMonths.includes(monthKey)) markers.push(`${year}-${monthKey}-${isMonthly ? '01' : '15'}`);
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }
  }

  return (
    <>
      <div className="history-tabs" role="tablist" aria-label="Tipo de dato">
        {[['monthly', 'Media mensual'], ['daily', 'Dato diario']].map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={view === value}
            className={view === value ? 'is-active' : ''}
            onClick={() => {
              setView(value);
              setPage(1);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="history-filters">
        <label>
          Desde
          <input
            type="date"
            min={firstDate}
            max={lastDate}
            value={startDate}
            onChange={(event) => {
              setStartDate(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          Hasta
          <input
            type="date"
            min={firstDate}
            max={lastDate}
            value={endDate}
            onChange={(event) => {
              setEndDate(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <button
          className="text-button history-reset"
          type="button"
          onClick={() => {
            setStartDate('');
            setEndDate('');
            setPage(1);
          }}
          disabled={!startDate && !endDate}
        >
          Restablecer fechas
        </button>
        <span className="history-count">
          {series.length.toLocaleString('es-ES')} {series.length === 1 ? unit[0] : unit[1]}
        </span>
      </div>
      {filteredRates.length > 0 ? (
        <>
          {highlightMonths.length > 0 && (
            <p className="reference-legend">
              <span /> Meses de referencia de las revisiones de «{highlightName}»
              {isMonthly ? ' (puntos en la gráfica y filas sombreadas)' : ' (puntos en la gráfica, a mitad de cada mes)'}
            </p>
          )}
          <EuriborChart rates={series} monthly={isMonthly} markers={markers} />
          <div className="table-wrap">
            <p className="table-caption">
              {isMonthly ? 'Media mensual' : 'Dato diario'} · del más reciente al más antiguo
            </p>

            <table>
              <thead>
                <tr>
                  <th>{isMonthly ? 'Mes' : 'Fecha'}</th>
                  <th className="number-cell">{isMonthly ? 'Euríbor medio' : 'Euríbor 12 meses'}</th>
                  {isMonthly && <th className="number-cell">Datos del mes</th>}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((rate) => (
                  <tr key={rate.date} className={isMonthly && highlightMonths.includes(rate.date.slice(5, 7)) ? 'is-reference' : undefined}>
                    <td>
                      {isMonthly ? formatAxisDate(rate.date) : formatDate(rate.date)}
                      {isMonthly && !rate.closed && <span className="badge">en curso</span>}
                    </td>
                    <td className="number-cell">{Number(rate.value).toFixed(3)}%</td>
                    {isMonthly && <td className="number-cell">{rate.count}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
            <nav className="pagination" aria-label="Paginación del histórico">
              <label>
                Filas
                <select
                  value={pageSize}
                  onChange={(event) => {
                    setPageSize(Number(event.target.value));
                    setPage(1);
                  }}
                >
                  {pageSizes.map((size) => <option key={size} value={size}>{size}</option>)}
                </select>
              </label>
              <span className="pagination-range">
                {firstShown.toLocaleString('es-ES')}–{lastShown.toLocaleString('es-ES')} de {series.length.toLocaleString('es-ES')}
              </span>
              <div className="pagination-buttons">
                <button type="button" onClick={() => setPage(1)} disabled={currentPage === 1} aria-label="Más recientes">«</button>
                <button type="button" onClick={() => setPage(currentPage - 1)} disabled={currentPage === 1}>Más recientes</button>
                <span>Página {currentPage} de {pageCount}</span>
                <button type="button" onClick={() => setPage(currentPage + 1)} disabled={currentPage === pageCount}>Más antiguos</button>
                <button type="button" onClick={() => setPage(pageCount)} disabled={currentPage === pageCount} aria-label="Más antiguos">»</button>
              </div>
            </nav>
          </div>
        </>
      ) : (
        <p className="muted history-empty">No hay datos en el intervalo seleccionado. Revisa las fechas.</p>
      )}
    </>
  );
}

function ReviewCard({ mortgages, mortgage, onSelect, summary, currentPayment }) {
  const { last, provisional, next } = summary;
  // La tendencia compara la media aplicada en la última revisión con la última media disponible.
  const delta = last && provisional ? provisional.euribor - last.euribor : null;
  const trend = delta === null || Math.abs(delta) < 0.0005 ? 'flat' : delta > 0 ? 'up' : 'down';
  const trendLabel = { up: 'empeora', down: 'mejora', flat: 'sin cambios' }[trend];
  // La estimación de hoy se ancla a la cuota real: cuota actual + diferencia entre tipos.
  const provisionalDelta = provisional && last && last.payment !== null && provisional.payment !== null
    ? provisional.payment - last.payment
    : null;
  const provisionalPayment = provisionalDelta !== null && currentPayment != null
    ? currentPayment + provisionalDelta
    : null;
  const provisionalTrend = provisionalDelta === null || Math.abs(provisionalDelta) < 0.005
    ? 'flat'
    : provisionalDelta > 0 ? 'up' : 'down';

  return (
    <article className="review-card">
      <div className="review-card-head">
        <span className="card-label">ÚLTIMA REVISIÓN</span>
        {mortgages.length > 1 ? (
          <select value={mortgage.id} aria-label="Hipoteca" onChange={(event) => onSelect(event.target.value)}>
            {mortgages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        ) : (
          <span className="review-name">{mortgage.name}</span>
        )}
      </div>
      {last ? (
        <>
          <div className="review-main">
            <p className="review-value">{last.euribor.toFixed(3)}<span>%</span></p>
            {delta !== null && (
              <span className={`trend trend--${trend}`}>
                {trend === 'up' ? '▲' : trend === 'down' ? '▼' : '='} {delta >= 0 ? '+' : '−'}{Math.abs(delta).toFixed(3)} pp · {trendLabel}
              </span>
            )}
          </div>
          <p className="review-sub">
            Media de {formatMonth(last.month)} · revisada el {formatShortDate(last.date)}
            {provisional && (
              <> · ahora {provisional.euribor.toFixed(3)}% (media de {formatMonth(provisional.month)}{provisional.isClosed ? '' : ', provisional'})</>
            )}
          </p>
          <div className="review-facts">
            {currentPayment != null && (
              <div>
                <span>Cuota tras la revisión</span>
                <strong>{formatEuro(currentPayment)}</strong>
              </div>
            )}
            {provisional && last && last.payment !== null && provisional.payment !== null && (
              <div>
                <span>Si se revisara hoy ({formatMonth(provisional.month)}{provisional.isClosed ? '' : ', provisional'})</span>
                <strong>{formatEuro(provisionalPayment)}</strong>
                <small className={`delta-${provisionalTrend}`}>
                  {formatSigned(provisionalDelta)}/mes · media {provisional.euribor.toFixed(3)}%
                </small>
              </div>
            )}
            <div>
              <span>Próxima revisión</span>
              <strong>{formatShortDate(next.date)}</strong>
              <small>
                media de {formatMonth(next.month)}
                {next.euribor !== null && !next.isClosed ? ` · ${next.euribor.toFixed(3)}% hasta hoy` : ''}
              </small>
            </div>
          </div>
        </>
      ) : (
        <p className="review-sub">
          Aún no hay una revisión con datos del Euríbor para esta hipoteca. Próxima: {formatShortDate(next.date)}.
        </p>
      )}
    </article>
  );
}

function Dashboard() {
  const { user, logout } = useAuth();
  const { rates, isLoading, error } = useEuribor();
  const latestRate = rates[rates.length - 1];
  const [mortgages, setMortgages] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const selectedMortgage = user
    ? mortgages.find((item) => item.id === selectedId) || mortgages[0] || null
    : null;
  const averages = useMemo(() => monthlyAverages(rates), [rates]);
  const asOf = useMemo(todayIso, []);
  const currentMonth = averages[averages.length - 1];
  const reviewInfo = useMemo(() => {
    if (!selectedMortgage || averages.length === 0) return null;
    const projection = projectMortgage(selectedMortgage, averages, asOf);
    const balance = projection ? projection.current.balance : selectedMortgage.principal;
    const months = projection ? projection.current.remainingMonths : 0;
    return {
      summary: reviewSummary(selectedMortgage, averages, asOf, { balance, months }),
      currentPayment: projection ? projection.current.payment : null,
    };
  }, [selectedMortgage, averages, asOf]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href={import.meta.env.BASE_URL}>
          <span className="brand-mark">€</span>
          <span>euríbor<span className="brand-light">hipoteca</span></span>
          <span className="app-version">v{version}</span>
        </a>
        <div className="account">
          {user ? (
            <>
              <span className="account-email">{user.email}</span>
              <button className="text-button" type="button" onClick={logout}>Salir</button>
            </>
          ) : (
            <a className="text-button" href="#cuenta">Acceder</a>
          )}
        </div>
      </header>

      <main className="content">
        <section className="intro">
          <span className="eyebrow">DATOS OFICIALES · BUNDESBANK</span>
          <h1>Tu hipoteca, con el Euríbor bajo control.</h1>
          <p>Consulta la evolución del Euríbor a 12 meses y prepara tus próximas simulaciones.</p>
        </section>

        <section className="overview-grid" aria-label="Resumen del Euríbor">
          <article className="rate-card">
            <span className="card-label">ÚLTIMO DATO DISPONIBLE</span>
            {isLoading ? (
              <p className="rate-value">—</p>
            ) : latestRate ? (
              <>
                <p className="rate-value">{Number(latestRate.value).toFixed(3)}<span>%</span></p>
                <p className="rate-date">
                  {new Intl.DateTimeFormat('es-ES', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  }).format(new Date(`${latestRate.date}T00:00:00`))}
                </p>
                {currentMonth && (
                  <div className="rate-month">
                    <span>
                      Media de {formatMonth(currentMonth.month)}
                      {currentMonth.closed ? '' : ' · provisional'}
                    </span>
                    <strong>{currentMonth.value.toFixed(3)}<small>%</small></strong>
                    <span>{currentMonth.count} {currentMonth.count === 1 ? 'dato' : 'datos'} del mes</span>
                  </div>
                )}
              </>
            ) : (
              <p className="rate-value">—</p>
            )}
          </article>
          {reviewInfo ? (
            <ReviewCard
              mortgages={mortgages}
              mortgage={selectedMortgage}
              onSelect={setSelectedId}
              summary={reviewInfo.summary}
              currentPayment={reviewInfo.currentPayment}
            />
          ) : (
            <article className="next-card">
              <span className="card-label">SIGUIENTE PASO</span>
              <h2>Tus hipotecas, en un solo lugar</h2>
              <p>Guarda tus préstamos y compara cómo influye el Euríbor histórico en la cuota mensual.</p>
              {!user && <a className="button button--light" href="#cuenta">Crear cuenta</a>}
            </article>
          )}
        </section>

        <section className="history-card">
          <div className="section-heading">
            <div>
              <span className="eyebrow">SERIE HISTÓRICA</span>
              <h2>Euríbor a 12 meses</h2>
            </div>
            <span className="source-label">Fuente: Deutsche Bundesbank</span>
          </div>
          <RateHistory
            rates={rates}
            isLoading={isLoading}
            error={error}
            highlightMonths={selectedMortgage ? referenceMonthsOfYear(selectedMortgage) : []}
            highlightName={selectedMortgage ? selectedMortgage.name : ''}
          />
        </section>

        {user && !isLoading && !error && (
          <MortgageManager user={user} rates={rates} onMortgagesChange={setMortgages} />
        )}

        {!user && (
          <div id="cuenta" className="account-section">
            <AuthForm />
          </div>
        )}
      </main>
      <footer>Los datos tienen carácter informativo y no constituyen asesoramiento financiero.</footer>
    </div>
  );
}

function AuthenticatedApp() {
  const { isLoading } = useAuth();
  if (isLoading) return <main className="setup-page"><p className="muted">Conectando…</p></main>;
  return <Dashboard />;
}

export default function App() {
  if (!firebaseConfigured) return <FirebaseSetup />;

  return (
    <AuthProvider>
      <AuthenticatedApp />
    </AuthProvider>
  );
}
