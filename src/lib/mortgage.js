export function calculateMonthlyPayment(principal, annualRate, remainingMonths) {
  if (!Number.isFinite(principal) || principal <= 0) {
    throw new Error('El capital pendiente debe ser mayor que cero.');
  }
  if (!Number.isFinite(annualRate) || annualRate <= -100) {
    throw new Error('El tipo anual debe ser superior a -100%.');
  }
  if (!Number.isInteger(remainingMonths) || remainingMonths <= 0) {
    throw new Error('El plazo pendiente debe ser de al menos un mes.');
  }

  const monthlyRate = annualRate / 100 / 12;
  if (monthlyRate === 0) return principal / remainingMonths;

  const denominator = 1 - (1 + monthlyRate) ** -remainingMonths;
  if (denominator === 0) {
    throw new Error('No se puede calcular la cuota con ese tipo y plazo.');
  }
  return (principal * monthlyRate) / denominator;
}

// Capital pendiente tras pagar `months` cuotas de `payment` a `annualRate`.
export function remainingBalance(principal, annualRate, payment, months) {
  const monthlyRate = annualRate / 100 / 12;
  if (monthlyRate === 0) return Math.max(principal - payment * months, 0);
  const growth = (1 + monthlyRate) ** months;
  return Math.max(principal * growth - (payment * (growth - 1)) / monthlyRate, 0);
}

// Media mensual del Euríbor a partir de las observaciones diarias.
// Un mes está cerrado si es anterior al mes de la última observación.
export function monthlyAverages(rates) {
  const buckets = new Map();
  for (const rate of rates) {
    const value = Number(rate.value);
    if (!rate.date || !Number.isFinite(value)) continue;
    const month = rate.date.slice(0, 7);
    const bucket = buckets.get(month) || { sum: 0, count: 0 };
    bucket.sum += value;
    bucket.count += 1;
    buckets.set(month, bucket);
  }

  const months = [...buckets.keys()].sort();
  const lastMonth = months[months.length - 1];
  return months.map((month) => ({
    month,
    value: buckets.get(month).sum / buckets.get(month).count,
    count: buckets.get(month).count,
    closed: month < lastMonth,
  }));
}

export function addMonths(date, months) {
  const [year, month, day] = date.split('-').map(Number);
  const total = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(total / 12);
  const targetMonth = total - targetYear * 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const pad = (value) => String(value).padStart(2, '0');
  return `${targetYear}-${pad(targetMonth + 1)}-${pad(Math.min(day, lastDay))}`;
}

export function monthsBetween(from, to) {
  const [fromYear, fromMonth, fromDay] = from.split('-').map(Number);
  const [toYear, toMonth, toDay] = to.split('-').map(Number);
  const months = (toYear - fromYear) * 12 + (toMonth - fromMonth);
  return toDay < fromDay ? months - 1 : months;
}

// Mes cuyo Euríbor medio se aplica en una revisión (offset 1 = mes anterior).
export function referenceMonth(reviewDate, offset = 1) {
  return addMonths(`${reviewDate.slice(0, 7)}-01`, -offset).slice(0, 7);
}

// Fecha de la revisión k-ésima respecto a la guardada (k negativo = pasadas).
function reviewAt(anchor, frequency, k) {
  return addMonths(anchor, k * frequency);
}

function lastReviewIndex(anchor, frequency, asOf) {
  let k = Math.floor(monthsBetween(anchor, asOf) / frequency);
  while (reviewAt(anchor, frequency, k) > asOf) k -= 1;
  while (reviewAt(anchor, frequency, k + 1) <= asOf) k += 1;
  return k;
}

// Primera revisión posterior a `asOf`.
export function nextReviewAfter(anchor, frequency, asOf) {
  return reviewAt(anchor, frequency, lastReviewIndex(anchor, frequency, asOf) + 1);
}

// Revisiones pasadas (la más antigua primero) hasta `asOf` incluido.
export function pastReviewDates(anchor, frequency, asOf, limit = 400) {
  const last = lastReviewIndex(anchor, frequency, asOf);
  const dates = [];
  for (let k = last; dates.length < limit; k -= 1) {
    const date = reviewAt(anchor, frequency, k);
    if (date < '1999-01-01') break;
    dates.unshift(date);
  }
  return dates;
}

function findAverage(averages, month) {
  return averages.find((item) => item.month === month) || null;
}

export const DEFAULT_REFERENCE_OFFSET = 3;

// Plazo pendiente en meses: se deduce de la fecha final; las hipotecas antiguas guardan los meses.
export function remainingMonthsFor(mortgage, asOf) {
  if (mortgage.endDate) return Math.max(monthsBetween(asOf, mortgage.endDate), 1);
  return mortgage.remainingMonths;
}

export function referenceOffsetFor(mortgage) {
  return Number.isInteger(mortgage.referenceOffset) ? mortgage.referenceOffset : DEFAULT_REFERENCE_OFFSET;
}

// Último Euríbor medio mensual disponible (preferentemente de un mes cerrado).
export function latestAverage(averages) {
  return [...averages].reverse().find((item) => item.closed) || averages[averages.length - 1] || null;
}

// Tipo vigente: el de la última revisión ya pasada, con el capital y plazo actuales.
export function currentSituation(mortgage, averages, asOf) {
  const offset = referenceOffsetFor(mortgage);
  const remainingMonths = remainingMonthsFor(mortgage, asOf);
  const latest = latestAverage(averages);
  const [lastReviewDate] = pastReviewDates(mortgage.nextReviewDate, mortgage.reviewFrequency, asOf).slice(-1);
  const month = lastReviewDate ? referenceMonth(lastReviewDate, offset) : null;
  const found = month ? findAverage(averages, month) : null;
  const average = found && found.closed ? found : latest;
  if (!average) return null;

  const annualRate = average.value + mortgage.spread;
  return {
    reviewDate: found && found.closed ? lastReviewDate : null,
    month: average.month,
    euribor: average.value,
    annualRate,
    remainingMonths,
    payment: calculateMonthlyPayment(mortgage.principal, annualRate, remainingMonths),
  };
}

// Meses que faltan para liquidar `balance` pagando `payment` al tipo dado.
export function monthsToPayoff(balance, annualRate, payment) {
  const monthlyRate = annualRate / 100 / 12;
  if (monthlyRate === 0) return Math.ceil(balance / payment - 1e-9);
  if (payment <= balance * monthlyRate) return Infinity;
  return Math.ceil(-Math.log(1 - (balance * monthlyRate) / payment) / Math.log(1 + monthlyRate) - 1e-9);
}

const MAX_PERIODS = 720;

// Simula el préstamo mes a mes desde la foto guardada (`snapshotDate`, o `asOf` si no hay).
// - Entre la foto y `asOf` se aplican las revisiones con el Euríbor medio real y las
//   amortizaciones guardadas posteriores a la foto: así se obtiene el estado de hoy (`current`).
// - Desde `asOf` se proyecta el futuro: las revisiones sin dato real usan `assumedEuribor`
//   más `stepPerReview` acumulado por cada revisión supuesta.
// - `extras`: amortizaciones { date, amount, mode: 'cuota' | 'plazo' } posteriores a la foto.
// - `monthlyExtra`: aportación mensual { amount, from, mode } a partir de la fecha `from`.
export function simulateLoan(mortgage, averages, options) {
  const { asOf, assumedEuribor, stepPerReview = 0, extras = [], monthlyExtra = null } = options;
  const start = mortgage.snapshotDate && mortgage.snapshotDate < asOf ? mortgage.snapshotDate : asOf;
  const snapshot = currentSituation(mortgage, averages, start);
  if (!snapshot) return null;

  const offset = referenceOffsetFor(mortgage);
  const frequency = mortgage.reviewFrequency;
  const anchor = mortgage.nextReviewDate;
  const hasRealPayment = Number.isFinite(mortgage.currentPayment) && mortgage.currentPayment > 0;
  const pending = extras
    .filter((extra) => extra.amount > 0 && extra.date > start)
    .sort((first, second) => first.date.localeCompare(second.date));

  let balance = mortgage.principal;
  let monthsLeft = snapshot.remainingMonths;
  let rate = snapshot.annualRate;
  const initialPayment = hasRealPayment ? mortgage.currentPayment : snapshot.payment;
  let payment = initialPayment;
  let lastEuribor = { value: snapshot.euribor, month: snapshot.month };
  let reviewIndex = lastReviewIndex(anchor, frequency, start) + 1;
  let assumedSteps = 0;
  let totalInterest = 0;
  let totalExtra = 0;
  let today = null;
  const rows = [];
  const reviews = [];

  function applyReviewsUpTo(limit) {
    let applied = null;
    while (reviewAt(anchor, frequency, reviewIndex) <= limit) {
      const reviewDate = reviewAt(anchor, frequency, reviewIndex);
      const month = referenceMonth(reviewDate, offset);
      const found = findAverage(averages, month);
      const isReal = Boolean(found && found.closed);
      let euribor;
      if (isReal) {
        euribor = found.value;
      } else {
        euribor = assumedEuribor + stepPerReview * assumedSteps;
        assumedSteps += 1;
      }
      rate = euribor + mortgage.spread;
      payment = calculateMonthlyPayment(balance, rate, Math.max(monthsLeft, 1));
      lastEuribor = { value: euribor, month };
      applied = { date: reviewDate, month, euribor, isReal, annualRate: rate, payment, balance };
      reviews.push(applied);
      reviewIndex += 1;
    }
    return applied;
  }

  function applyExtra(amount, mode) {
    const applied = Math.min(amount, balance);
    if (applied <= 0) return 0;
    balance -= applied;
    if (balance > 0.005) {
      if (mode === 'plazo') {
        const months = monthsToPayoff(balance, rate, payment);
        if (Number.isFinite(months)) monthsLeft = Math.max(months, 1);
      } else {
        payment = calculateMonthlyPayment(balance, rate, Math.max(monthsLeft, 1));
      }
    }
    return applied;
  }

  function captureToday() {
    applyReviewsUpTo(asOf);
    today = {
      balance,
      payment: balance > 0.005 ? payment : 0,
      annualRate: rate,
      euribor: lastEuribor.value,
      month: lastEuribor.month,
      remainingMonths: Math.max(monthsLeft, 0),
    };
  }

  for (let period = 1; balance > 0.005 && period <= MAX_PERIODS; period += 1) {
    const date = addMonths(start, period);
    if (!today && date > asOf) captureToday();
    const isFuture = date > asOf;

    const review = applyReviewsUpTo(date);
    let extra = 0;
    while (pending.length > 0 && pending[0].date <= date) {
      const next = pending.shift();
      extra += applyExtra(next.amount, next.mode);
    }
    if (monthlyExtra && monthlyExtra.amount > 0 && date > asOf && date >= (monthlyExtra.from || asOf)) {
      extra += applyExtra(monthlyExtra.amount, monthlyExtra.mode);
    }
    if (isFuture) totalExtra += extra;

    if (balance <= 0.005) {
      if (isFuture) rows.push({ date, payment: 0, extra, interest: 0, principalPaid: 0, balance: 0, annualRate: rate, review });
      break;
    }

    const interest = (balance * rate) / 1200;
    const due = Math.min(payment, balance + interest);
    const principalPaid = due - interest;
    balance = Math.max(balance - principalPaid, 0);
    monthsLeft -= 1;
    if (isFuture) {
      totalInterest += interest;
      rows.push({ date, payment: due, extra, interest, principalPaid, balance, annualRate: rate, review });
    }
  }
  if (!today) captureToday();

  const payments = rows.map((row) => row.payment).filter((value) => value > 0);
  return {
    rows,
    reviews: reviews.filter((review) => review.date > asOf),
    pastReviews: reviews.filter((review) => review.date <= asOf),
    current: today,
    snapshotPayment: initialPayment,
    totalInterest,
    totalExtra,
    endDate: rows.length ? rows[rows.length - 1].date : asOf,
    months: rows.length,
    maxPayment: Math.max(...payments, 0),
    minPayment: Math.min(...payments, Infinity),
    isLiquidated: balance <= 0.005,
  };
}

// Meses del año (MM) cuyo Euríbor medio se aplica en las revisiones de la hipoteca.
export function referenceMonthsOfYear(mortgage) {
  const offset = referenceOffsetFor(mortgage);
  const anchorMonth = Number(mortgage.nextReviewDate.slice(5, 7)) - 1;
  const months = new Set();
  for (let step = 0; step < 12 / mortgage.reviewFrequency; step += 1) {
    const reviewMonth = anchorMonth + step * mortgage.reviewFrequency;
    months.add((((reviewMonth - offset) % 12) + 12) % 12 + 1);
  }
  return [...months].sort((first, second) => first - second).map((month) => String(month).padStart(2, '0'));
}

// Proyección base de una hipoteca: Euríbor constante en el último dato y amortizaciones guardadas.
export function projectMortgage(mortgage, averages, asOf) {
  const latest = latestAverage(averages);
  try {
    return simulateLoan(mortgage, averages, {
      asOf,
      assumedEuribor: latest ? latest.value : 2,
      extras: mortgage.amortizations || [],
    });
  } catch {
    return null;
  }
}

// Última revisión frente a la anterior, y datos de la próxima. Las cuotas se calculan con el
// mismo capital y plazo (`balance`, `months`) para que la comparación sea limpia.
export function reviewSummary(mortgage, averages, asOf, { balance, months }) {
  const offset = referenceOffsetFor(mortgage);
  const frequency = mortgage.reviewFrequency;
  const anchor = mortgage.nextReviewDate;
  const past = pastReviewDates(anchor, frequency, asOf).slice(-2);

  const point = (date) => {
    const month = referenceMonth(date, offset);
    const found = findAverage(averages, month);
    if (!found || !found.closed) return null;
    const annualRate = found.value + mortgage.spread;
    return {
      date,
      month,
      euribor: found.value,
      annualRate,
      payment: balance > 0 && months > 0 ? calculateMonthlyPayment(balance, annualRate, months) : null,
    };
  };

  const last = past.length > 0 ? point(past[past.length - 1]) : null;
  const previous = past.length > 1 ? point(past[0]) : null;
  const nextDate = nextReviewAfter(anchor, frequency, asOf);
  const nextMonth = referenceMonth(nextDate, offset);
  const nextFound = findAverage(averages, nextMonth);
  const latest = averages[averages.length - 1];
  const provisional = latest
    ? {
      month: latest.month,
      euribor: latest.value,
      count: latest.count,
      isClosed: latest.closed,
      annualRate: latest.value + mortgage.spread,
      payment: balance > 0 && months > 0
        ? calculateMonthlyPayment(balance, latest.value + mortgage.spread, months)
        : null,
    }
    : null;
  return {
    last,
    previous,
    provisional,
    next: {
      date: nextDate,
      month: nextMonth,
      euribor: nextFound ? nextFound.value : null,
      isClosed: Boolean(nextFound && nextFound.closed),
    },
  };
}
