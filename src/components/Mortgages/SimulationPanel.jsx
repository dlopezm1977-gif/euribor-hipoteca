import { useMemo, useState } from 'react';
import {
  addMonths,
  latestAverage,
  monthlyAverages,
  referenceOffsetFor,
  simulateLoan,
} from '../../lib/mortgage';
import {
  formatDate,
  formatDuration,
  formatEuro,
  formatEuroRound,
  formatMonth,
  formatPercent,
  formatSigned,
  todayIso,
} from '../../lib/format';
import SimulationChart from './SimulationChart';

const euriborPresets = [
  { label: 'Último dato', delta: 0 },
  { label: '−1 pp', delta: -1 },
  { label: '+1 pp', delta: 1 },
  { label: '+2 pp', delta: 2 },
];

function Segmented({ value, options, onChange, label }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === value ? 'is-active' : ''}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Kpi({ label, value, unit, detail, tone }) {
  return (
    <div className={`sim-kpi${tone ? ` sim-kpi--${tone}` : ''}`}>
      <span>{label}</span>
      <strong>{value}{unit && <small>{unit}</small>}</strong>
      <span>{detail}</span>
    </div>
  );
}

export default function SimulationPanel({ mortgage, rates }) {
  const asOf = useMemo(todayIso, []);
  const averages = useMemo(() => monthlyAverages(rates), [rates]);
  const latest = latestAverage(averages);
  const latestValue = latest ? Math.round(latest.value * 20) / 20 : 2;
  const amountStep = mortgage.principal > 50000 ? 1000 : 500;

  const [euribor, setEuribor] = useState(latestValue);
  const [step, setStep] = useState(0);
  const [extraAmount, setExtraAmount] = useState(0);
  const [extraKind, setExtraKind] = useState('once');
  const [extraDate, setExtraDate] = useState(() => addMonths(asOf, 1));
  const [extraMode, setExtraMode] = useState('plazo');
  const [metric, setMetric] = useState('payment');

  const extraActive = extraAmount > 0;
  const savedExtras = mortgage.amortizations || [];
  const baseOptions = { asOf, assumedEuribor: euribor, stepPerReview: step, extras: savedExtras };

  const { base, scenario, error } = useMemo(() => {
    try {
      const baseline = simulateLoan(mortgage, averages, baseOptions);
      const withExtra = extraActive
        ? simulateLoan(mortgage, averages, {
          ...baseOptions,
          extras: extraKind === 'once'
            ? [...savedExtras, { date: extraDate < asOf ? asOf : extraDate, amount: extraAmount, mode: extraMode }]
            : savedExtras,
          monthlyExtra: extraKind === 'monthly'
            ? { amount: extraAmount, from: extraDate, mode: extraMode }
            : null,
        })
        : baseline;
      return { base: baseline, scenario: withExtra, error: '' };
    } catch (simulationError) {
      return { base: null, scenario: null, error: simulationError.message };
    }
  }, [mortgage, averages, asOf, euribor, step, extraAmount, extraKind, extraDate, extraMode]);

  if (error || !scenario) {
    return <p className="form-error">{error || 'No hay suficientes datos del Euríbor para simular esta hipoteca.'}</p>;
  }

  const offset = referenceOffsetFor(mortgage);
  const nextReview = scenario.reviews[0];
  const current = scenario.current;
  const snapshotDate = mortgage.snapshotDate && mortgage.snapshotDate < asOf ? mortgage.snapshotDate : null;
  const interestSaved = base.totalInterest - scenario.totalInterest;
  const monthsSaved = base.months - scenario.months;

  const paymentRows = (result) => result.rows.filter((row, index) =>
    row.payment > 0 && !(index === result.rows.length - 1 && result.rows.length > 1 && result.isLiquidated)
  );
  const toSeries = (result) => (metric === 'payment'
    ? paymentRows(result).map((row) => ({ date: row.date, value: row.payment }))
    : [{ date: asOf, value: mortgage.principal }, ...result.rows.map((row) => ({ date: row.date, value: row.balance }))]);
  const series = [{ name: 'Escenario', points: toSeries(scenario) }];
  if (extraActive) series.push({ name: 'Sin cambios', points: toSeries(base) });
  const markers = scenario.reviews.filter((review) => review.date <= scenario.endDate);

  function applyPreset(delta) {
    setEuribor(Math.round((latestValue + delta) * 20) / 20);
  }

  function reset() {
    setEuribor(latestValue);
    setStep(0);
    setExtraAmount(0);
  }

  return (
    <div className="sim-panel">
      <aside className="sim-controls">
        <div className="sim-controls-head">
          <h4>Simulador</h4>
          <button className="text-button" type="button" onClick={reset}>Restablecer</button>
        </div>

        <div className="sim-control">
          <div className="sim-control-label">
            <span>Euríbor medio supuesto</span>
            <output>{formatPercent(euribor, 2)}</output>
          </div>
          <input
            type="range"
            min="-1"
            max="6"
            step="0.05"
            value={euribor}
            aria-label="Euríbor medio supuesto"
            onChange={(event) => setEuribor(Number(event.target.value))}
          />
          <div className="chips">
            {euriborPresets.map((preset) => (
              <button key={preset.label} type="button" onClick={() => applyPreset(preset.delta)}>
                {preset.label}
              </button>
            ))}
          </div>
          <p className="sim-help">
            Se aplica en las revisiones cuyo mes de referencia aún no tiene dato. Último dato:
            {' '}{latest ? `${formatPercent(latest.value)} (${formatMonth(latest.month)}${latest.closed ? '' : ', mes en curso'})` : '—'}.
          </p>
        </div>

        <div className="sim-control">
          <div className="sim-control-label">
            <span>Variación en cada revisión</span>
            <output>{step >= 0 ? '+' : '−'}{Math.abs(step).toFixed(2).replace('.', ',')} pp</output>
          </div>
          <input
            type="range"
            min="-1"
            max="1"
            step="0.05"
            value={step}
            aria-label="Variación del Euríbor en cada revisión"
            onChange={(event) => setStep(Number(event.target.value))}
          />
          <p className="sim-help">Sube o baja el Euríbor supuesto de una revisión a la siguiente.</p>
        </div>

        <div className="sim-control sim-control--extra">
          <div className="sim-control-label">
            <span>Amortización anticipada</span>
            <output>{extraActive ? formatEuroRound(extraAmount) : 'Sin amortizar'}</output>
          </div>
          <input
            type="range"
            min="0"
            max={Math.round(mortgage.principal / amountStep) * amountStep}
            step={amountStep}
            value={extraAmount}
            aria-label="Importe de la amortización anticipada"
            onChange={(event) => setExtraAmount(Number(event.target.value))}
          />
          <div className="sim-extra-fields">
            <label>
              Importe (€)
              <input
                type="number"
                min="0"
                step="100"
                value={extraAmount}
                onChange={(event) => setExtraAmount(Math.max(Number(event.target.value) || 0, 0))}
              />
            </label>
            <label>
              {extraKind === 'once' ? 'Fecha' : 'Desde'}
              <input type="date" min={asOf} value={extraDate} onChange={(event) => setExtraDate(event.target.value || asOf)} />
            </label>
          </div>
          <Segmented
            label="Frecuencia"
            value={extraKind}
            onChange={setExtraKind}
            options={[{ value: 'once', label: 'Puntual' }, { value: 'monthly', label: 'Cada mes' }]}
          />
          <Segmented
            label="Efecto"
            value={extraMode}
            onChange={setExtraMode}
            options={[{ value: 'plazo', label: 'Reducir plazo' }, { value: 'cuota', label: 'Reducir cuota' }]}
          />
        </div>
      </aside>

      <div className="sim-results">
        <p className="sim-today">
          {snapshotDate
            ? <>Proyectado desde tus datos del {formatDate(snapshotDate)}: hoy debes <strong>{formatEuro(current.balance)}</strong>, te quedan {formatDuration(current.remainingMonths)} y el tipo es {formatPercent(current.annualRate)}.</>
            : <>Con los datos que has introducido: capital <strong>{formatEuro(current.balance)}</strong> y tipo {formatPercent(current.annualRate)}.</>}
        </p>
        <div className="sim-kpis">
          <Kpi
            label={snapshotDate || mortgage.currentPayment ? 'Cuota actual' : 'Cuota actual (estimada)'}
            value={formatEuro(current.payment)}
            unit="/mes"
            detail={`Euríbor ${formatMonth(current.month)} ${formatPercent(current.euribor)} + ${formatPercent(mortgage.spread)}`}
          />
          {nextReview ? (
            <Kpi
              label={`Próxima revisión · ${formatDate(nextReview.date)}`}
              value={formatEuro(nextReview.payment)}
              unit="/mes"
              tone={nextReview.payment > current.payment + 0.005 ? 'up' : nextReview.payment < current.payment - 0.005 ? 'down' : null}
              detail={`${formatSigned(nextReview.payment - current.payment)}/mes · media de ${formatMonth(nextReview.month)} ${nextReview.isReal ? '' : '(supuesto) '}${formatPercent(nextReview.euribor, 2)}`}
            />
          ) : (
            <Kpi label="Próxima revisión" value="—" detail="El préstamo termina antes de revisarse." />
          )}
          <Kpi
            label="Fin del préstamo"
            value={formatDate(scenario.endDate)}
            tone={monthsSaved > 0 ? 'down' : null}
            detail={monthsSaved > 0 ? `${formatDuration(monthsSaved)} menos` : `${formatDuration(scenario.months)} restantes`}
          />
          <Kpi
            label="Intereses pendientes"
            value={formatEuroRound(scenario.totalInterest)}
            tone={interestSaved > 1 ? 'down' : null}
            detail={interestSaved > 1 ? `Ahorras ${formatEuroRound(interestSaved)}` : `Cuota máx. ${formatEuro(scenario.maxPayment)}`}
          />
        </div>

        <div className="sim-chart-card">
          <div className="sim-chart-head">
            <h4>{metric === 'payment' ? 'Cuota mensual proyectada' : 'Capital pendiente'}</h4>
            <Segmented
              label="Magnitud del gráfico"
              value={metric}
              onChange={setMetric}
              options={[{ value: 'payment', label: 'Cuota' }, { value: 'balance', label: 'Capital' }]}
            />
          </div>
          <SimulationChart
            series={series}
            markers={markers}
            step={metric === 'payment'}
            zeroBased={metric === 'balance'}
            formatValue={metric === 'payment' ? formatEuro : formatEuroRound}
            label={`Proyección de ${metric === 'payment' ? 'la cuota' : 'el capital pendiente'} de ${mortgage.name}`}
          />
          <p className="sim-legend">
            <span className="legend-line" /> Escenario
            {extraActive && <><span className="legend-line legend-line--base" /> Sin amortizar</>}
            <span className="legend-marker" /> Revisión
          </p>
        </div>

        <div className="sim-table-wrap">
          <table className="sim-table">
            <caption>
              Próximas revisiones · se aplica el Euríbor medio de {offset === 0 ? 'el mismo mes' : `${offset} ${offset === 1 ? 'mes' : 'meses'} antes`}
            </caption>
            <thead>
              <tr>
                <th>Revisión</th>
                <th>Mes de referencia</th>
                <th>Euríbor medio</th>
                <th>Tipo total</th>
                <th>Nueva cuota</th>
                <th>Variación</th>
              </tr>
            </thead>
            <tbody>
              {scenario.reviews.slice(0, 6).map((review) => {
                const difference = review.payment - current.payment;
                return (
                  <tr key={review.date}>
                    <td>{formatDate(review.date)}</td>
                    <td>{formatMonth(review.month)} <span className={`badge${review.isReal ? ' badge--real' : ''}`}>{review.isReal ? 'dato' : 'supuesto'}</span></td>
                    <td>{formatPercent(review.euribor, 2)}</td>
                    <td>{formatPercent(review.annualRate, 2)}</td>
                    <td><strong>{formatEuro(review.payment)}</strong></td>
                    <td className={difference > 0.005 ? 'delta--up' : difference < -0.005 ? 'delta--down' : ''}>{formatSigned(difference)}</td>
                  </tr>
                );
              })}
              {scenario.reviews.length === 0 && (
                <tr><td colSpan="6">No quedan revisiones antes del fin del préstamo.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="simulation-disclaimer">
          Estimación mensual con sistema francés partiendo del capital pendiente y la fecha final actuales; las cuotas reales pueden variar unos céntimos. No incluye comisiones, seguros ni suelo o techo.
        </p>
      </div>
    </div>
  );
}
