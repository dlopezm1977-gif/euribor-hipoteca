const euroFormatter = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
const euroRoundFormatter = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});
const dateFormatter = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const monthFormatter = new Intl.DateTimeFormat('es-ES', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

export const formatEuro = (value) => euroFormatter.format(value);
export const formatEuroRound = (value) => euroRoundFormatter.format(value);
export const formatDate = (date) => dateFormatter.format(new Date(`${date}T00:00:00Z`));
export const formatMonth = (month) => monthFormatter.format(new Date(`${month}-01T00:00:00Z`));
export const formatPercent = (value, digits = 3) => `${value.toFixed(digits).replace('.', ',')}%`;

export function formatSigned(value, formatter = formatEuro) {
  if (Math.abs(value) < 0.005) return formatter(0);
  return `${value > 0 ? '+' : '−'}${formatter(Math.abs(value))}`;
}

export function formatDuration(months) {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) return `${rest} ${rest === 1 ? 'mes' : 'meses'}`;
  if (rest === 0) return `${years} ${years === 1 ? 'año' : 'años'}`;
  return `${years} a ${rest} m`;
}

export const todayIso = () => new Date().toISOString().slice(0, 10);
