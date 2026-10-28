import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateMonthlyPayment,
  currentSituation,
  monthlyAverages,
  monthsToPayoff,
  pastReviewDates,
  referenceMonth,
  referenceMonthsOfYear,
  reviewSummary,
  remainingBalance,
  remainingMonthsFor,
  simulateLoan,
} from './mortgage.js';

test('calcula la cuota francesa con tipo cero', () => {
  assert.equal(calculateMonthlyPayment(12000, 0, 12), 1000);
});

test('calcula una cuota mensual para una hipoteca con interés positivo', () => {
  const payment = calculateMonthlyPayment(100000, 3, 240);
  assert.ok(Math.abs(payment - 554.5977) < 0.01);
});

test('rechaza principal o plazo no válidos', () => {
  assert.throws(() => calculateMonthlyPayment(0, 2, 120), /capital pendiente/);
  assert.throws(() => calculateMonthlyPayment(1000, 2, 0), /plazo pendiente/);
});

const daily = [
  { date: '2026-06-01', value: 2 },
  { date: '2026-06-15', value: 4 },
  { date: '2026-07-03', value: 3 },
  { date: '2026-09-02', value: 3.5 },
  { date: '2026-09-20', value: 2.5 },
  { date: '2026-10-10', value: 9 },
];
// Revisión semestral: 31 mar y 30 sep, con el Euríbor medio de tres meses antes.
const mortgage = {
  principal: 100000,
  endDate: '2046-10-28',
  spread: 1,
  reviewFrequency: 6,
  nextReviewDate: '2027-03-31',
  referenceOffset: 3,
};
const asOf = '2026-10-28';

test('calcula el Euríbor medio mensual y marca el mes en curso como abierto', () => {
  assert.deepEqual(monthlyAverages(daily).map((item) => [item.month, item.value, item.closed]), [
    ['2026-06', 3, true],
    ['2026-07', 3, true],
    ['2026-09', 3, true],
    ['2026-10', 9, false],
  ]);
});

test('el mes de referencia se desplaza respecto a la revisión', () => {
  assert.equal(referenceMonth('2026-09-30', 3), '2026-06');
  assert.equal(referenceMonth('2027-03-31', 3), '2026-12');
  assert.equal(referenceMonth('2027-01-15', 0), '2027-01');
});

test('las revisiones siguen la frecuencia y respetan el fin de mes', () => {
  const dates = pastReviewDates(mortgage.nextReviewDate, 6, asOf);
  assert.deepEqual(dates.slice(-2), ['2026-03-31', '2026-09-30']);
});

test('el plazo pendiente se deduce de la fecha final', () => {
  assert.equal(remainingMonthsFor(mortgage, asOf), 240);
  assert.equal(remainingMonthsFor({ remainingMonths: 90 }, asOf), 90);
});

test('la cuota actual usa la media de junio para la revisión del 30 de septiembre', () => {
  const situation = currentSituation(mortgage, monthlyAverages(daily), asOf);
  assert.equal(situation.month, '2026-06');
  assert.equal(situation.euribor, 3);
  assert.ok(Math.abs(situation.payment - calculateMonthlyPayment(100000, 4, 240)) < 1e-9);
});

test('la simulación supone el Euríbor en las revisiones sin dato real', () => {
  const result = simulateLoan(mortgage, monthlyAverages(daily), {
    asOf,
    assumedEuribor: 2,
    stepPerReview: 0.5,
  });
  assert.equal(result.reviews[0].date, '2027-03-31');
  assert.equal(result.reviews[0].isReal, false);
  assert.equal(result.reviews[0].euribor, 2);
  assert.equal(result.reviews[1].euribor, 2.5);
  assert.ok(result.isLiquidated);
  assert.ok(Math.abs(result.months - 240) <= 1);
});

test('con tipo constante la simulación suma los intereses esperados', () => {
  const averages = monthlyAverages([{ date: '2026-09-01', value: 3 }, { date: '2026-10-01', value: 3 }]);
  const result = simulateLoan({ ...mortgage, spread: 0 }, averages, { asOf, assumedEuribor: 3 });
  const payment = calculateMonthlyPayment(100000, 3, 240);
  assert.ok(Math.abs(result.totalInterest - (payment * 240 - 100000)) < 1);
});

test('amortizar reduciendo plazo acaba antes y mantiene la cuota', () => {
  const averages = monthlyAverages(daily);
  const base = simulateLoan(mortgage, averages, { asOf, assumedEuribor: 3 });
  const early = simulateLoan(mortgage, averages, {
    asOf,
    assumedEuribor: 3,
    extras: [{ date: '2026-12-01', amount: 20000, mode: 'plazo' }],
  });
  assert.ok(early.months < base.months - 20);
  assert.ok(early.totalInterest < base.totalInterest);
  assert.ok(Math.abs(early.rows[0].payment - base.rows[0].payment) < 1e-9);
});

test('amortizar reduciendo cuota mantiene el plazo y baja la cuota', () => {
  const averages = monthlyAverages(daily);
  const base = simulateLoan(mortgage, averages, { asOf, assumedEuribor: 3 });
  const lower = simulateLoan(mortgage, averages, {
    asOf,
    assumedEuribor: 3,
    extras: [{ date: '2026-12-01', amount: 20000, mode: 'cuota' }],
  });
  assert.ok(Math.abs(lower.months - base.months) <= 1);
  assert.ok(lower.rows[3].payment < base.rows[3].payment);
});

test('la cuota real informada sustituye a la estimada hasta la siguiente revisión', () => {
  const result = simulateLoan({ ...mortgage, currentPayment: 700 }, monthlyAverages(daily), {
    asOf,
    assumedEuribor: 3,
  });
  assert.equal(result.rows[0].payment, 700);
  assert.equal(result.current.payment, 700);
});

test('calcula meses hasta liquidar y el saldo tras amortizar', () => {
  const payment = calculateMonthlyPayment(50000, 3, 120);
  assert.equal(monthsToPayoff(50000, 3, payment), 120);
  assert.ok(remainingBalance(50000, 3, payment, 120) < 1e-6);
});

const flat = monthlyAverages([
  { date: '2026-01-05', value: 3 },
  { date: '2026-06-05', value: 3 },
  { date: '2026-10-05', value: 3 },
]);
const snapshotLoan = {
  principal: 100000,
  endDate: '2046-04-28',
  spread: 0,
  reviewFrequency: 6,
  nextReviewDate: '2030-03-31',
  referenceOffset: 3,
  snapshotDate: '2026-04-28',
};

test('desde la foto, el capital de hoy sale de amortizar los meses transcurridos', () => {
  const result = simulateLoan(snapshotLoan, flat, { asOf, assumedEuribor: 3 });
  const payment = calculateMonthlyPayment(100000, 3, 240);
  assert.ok(Math.abs(result.current.balance - remainingBalance(100000, 3, payment, 6)) < 0.01);
  assert.equal(result.current.remainingMonths, 234);
  assert.ok(Math.abs(result.months - 234) <= 1);
});

test('una amortización posterior a la foto cambia el capital y la cuota de hoy', () => {
  const base = simulateLoan(snapshotLoan, flat, { asOf, assumedEuribor: 3 });
  const withExtra = simulateLoan(
    { ...snapshotLoan, amortizations: [{ date: '2026-07-01', amount: 10000, mode: 'cuota' }] },
    flat,
    { asOf, assumedEuribor: 3, extras: [{ date: '2026-07-01', amount: 10000, mode: 'cuota' }] }
  );
  assert.ok(withExtra.current.balance < base.current.balance - 9000);
  assert.ok(withExtra.current.payment < base.current.payment);
  assert.ok(Math.abs(withExtra.months - base.months) <= 1);
});

test('tras pasar una revisión, la cuota de hoy se recalcula con el Euríbor real', () => {
  const result = simulateLoan(
    { ...mortgage, snapshotDate: '2026-09-01', currentPayment: 700 },
    monthlyAverages(daily),
    { asOf, assumedEuribor: 3 }
  );
  // Revisión del 30/09/2026 con la media de junio (3 %) + 1 pp.
  assert.equal(result.pastReviews.length, 1);
  assert.ok(result.current.payment > 600 && result.current.payment < 610);
  assert.equal(result.snapshotPayment, 700);
});

test('los meses de referencia del año salen del desfase y la frecuencia', () => {
  assert.deepEqual(referenceMonthsOfYear(mortgage), ['06', '12']);
  assert.deepEqual(referenceMonthsOfYear({ ...mortgage, reviewFrequency: 12, referenceOffset: 1 }), ['02']);
});

test('el resumen compara la última revisión con la anterior', () => {
  const averages = monthlyAverages([
    { date: '2025-12-10', value: 2 },
    { date: '2026-06-10', value: 3 },
    { date: '2026-10-10', value: 3 },
  ]);
  const summary = reviewSummary(mortgage, averages, asOf, { balance: 100000, months: 240 });
  assert.equal(summary.last.date, '2026-09-30');
  assert.equal(summary.last.month, '2026-06');
  assert.equal(summary.previous.month, '2025-12');
  assert.ok(summary.last.payment > summary.previous.payment);
  assert.equal(summary.next.date, '2027-03-31');
  assert.equal(summary.next.month, '2026-12');
  assert.equal(summary.next.euribor, null);
});
