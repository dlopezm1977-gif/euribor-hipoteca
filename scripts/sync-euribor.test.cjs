const test = require('node:test');
const assert = require('node:assert/strict');
const { parseObservations, resolveStartPeriod } = require('./sync-euribor.cjs');

test('parsea las observaciones SDMX y ordena las fechas', () => {
  const payload = {
    data: {
      structure: {
        dimensions: {
          observation: [{
            id: 'TIME_PERIOD',
            values: [{ id: '2024-02-01' }, { id: '2024-01-01' }],
          }],
        },
      },
      dataSets: [{
        series: {
          '0:0': {
            observations: {
              0: [3.5],
              1: [3.25],
            },
          },
        },
      }],
    },
  };

  assert.deepEqual(parseObservations(payload), [
    { date: '2024-01-01', value: 3.25 },
    { date: '2024-02-01', value: 3.5 },
  ]);
});

test('omite los periodos sin observación', () => {
  const payload = {
    data: {
      structure: {
        dimensions: {
          observation: [{
            id: 'TIME_PERIOD',
            values: [{ id: '2024-01-01' }, { id: '2024-01-02' }],
          }],
        },
      },
      dataSets: [{
        series: {
          '0': {
            observations: {
              0: [null, 1],
              1: ['3.2', 0, 1],
            },
          },
        },
      }],
    },
  };

  assert.deepEqual(parseObservations(payload), [{ date: '2024-01-02', value: 3.2 }]);
});

test('rechaza respuestas SDMX sin la estructura esperada', () => {
  assert.throws(() => parseObservations({}), /estructura SDMX esperada/);
});

test('rechaza valores de observación no numéricos', () => {
  const payload = {
    data: {
      structure: {
        dimensions: {
          observation: [{ id: 'TIME_PERIOD', values: [{ id: '2024-01-01' }] }],
        },
      },
      dataSets: [{ series: { '0': { observations: { 0: ['invalid'] } } } }],
    },
  };

  assert.throws(() => parseObservations(payload), /Observación inválida/);
});

test('acepta una respuesta sin observaciones cuando se permite', () => {
  const payload = {
    data: {
      structure: { dimensions: { observation: [{ id: 'TIME_PERIOD', values: [] }] } },
      dataSets: [{ series: { '0': { observations: {} } } }],
    },
  };

  assert.deepEqual(parseObservations(payload, { allowEmpty: true }), []);
  assert.throws(() => parseObservations(payload), /no contiene observaciones/);
});

test('el inicio del periodo usa los últimos días si se indican', () => {
  const now = new Date('2026-10-28T12:00:00Z');
  assert.equal(resolveStartPeriod({ EURIBOR_LOOKBACK_DAYS: '7' }, now), '2026-10-21');
  assert.equal(resolveStartPeriod({ EURIBOR_LOOKBACK_DAYS: '7', EURIBOR_START_PERIOD: '2020-01-01' }, now), '2026-10-21');
});

test('sin días indicados usa la fecha de inicio o el histórico completo', () => {
  assert.equal(resolveStartPeriod({ EURIBOR_START_PERIOD: '2020-05-01' }), '2020-05-01');
  assert.equal(resolveStartPeriod({ EURIBOR_LOOKBACK_DAYS: '' }), '2019-01-01');
  assert.equal(resolveStartPeriod({}), '2019-01-01');
});

test('rechaza un número de días no válido', () => {
  assert.throws(() => resolveStartPeriod({ EURIBOR_LOOKBACK_DAYS: 'abc' }), /EURIBOR_LOOKBACK_DAYS/);
  assert.throws(() => resolveStartPeriod({ EURIBOR_LOOKBACK_DAYS: '0' }), /EURIBOR_LOOKBACK_DAYS/);
});
