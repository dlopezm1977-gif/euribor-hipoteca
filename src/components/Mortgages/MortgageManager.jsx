import { useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { formatDate, formatEuro, formatEuroRound, formatPercent, todayIso } from '../../lib/format';
import {
  DEFAULT_REFERENCE_OFFSET,
  addMonths,
  calculateMonthlyPayment,
  monthlyAverages,
  monthsBetween,
  projectMortgage,
} from '../../lib/mortgage';
import SimulationPanel from './SimulationPanel';

const emptyForm = {
  name: '',
  initialPrincipal: '',
  startDate: '',
  snapshotDate: todayIso(),
  principal: '',
  endDate: '',
  currentPayment: '',
  spread: '',
  reviewFrequency: '6',
  nextReviewDate: '',
  referenceOffset: String(DEFAULT_REFERENCE_OFFSET),
  amortizations: [],
};

const optionalNumber = (value) => (value === '' ? null : Number(value));

function formFromMortgage(mortgage) {
  const endDate = mortgage.endDate
    || addMonths(todayIso(), Number(mortgage.remainingMonths) || 1);
  return {
    name: mortgage.name,
    initialPrincipal: mortgage.initialPrincipal == null ? '' : String(mortgage.initialPrincipal),
    startDate: mortgage.startDate || '',
    snapshotDate: mortgage.snapshotDate || todayIso(),
    principal: String(mortgage.principal),
    endDate,
    currentPayment: mortgage.currentPayment == null ? '' : String(mortgage.currentPayment),
    spread: String(mortgage.spread),
    reviewFrequency: String(mortgage.reviewFrequency),
    nextReviewDate: mortgage.nextReviewDate,
    referenceOffset: String(Number.isInteger(mortgage.referenceOffset) ? mortgage.referenceOffset : DEFAULT_REFERENCE_OFFSET),
    amortizations: (mortgage.amortizations || []).map((item) => ({
      date: item.date,
      amount: String(item.amount),
      mode: item.mode,
    })),
  };
}

function MortgageForm({ mortgage, isSaving, onCancel, onSave }) {
  const [form, setForm] = useState(() => (mortgage ? formFromMortgage(mortgage) : emptyForm));
  const [error, setError] = useState('');

  function updateField(event) {
    const { name, value } = event.target;
    setForm((previous) => ({ ...previous, [name]: value }));
  }

  function updateAmortization(index, field, value) {
    setForm((previous) => ({
      ...previous,
      amortizations: previous.amortizations.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item
      ),
    }));
  }

  function addAmortization() {
    setForm((previous) => ({
      ...previous,
      amortizations: [...previous.amortizations, { date: '', amount: '', mode: 'plazo' }],
    }));
  }

  function removeAmortization(index) {
    setForm((previous) => ({
      ...previous,
      amortizations: previous.amortizations.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    try {
      await onSave({
        name: form.name.trim(),
        initialPrincipal: optionalNumber(form.initialPrincipal),
        startDate: form.startDate || null,
        snapshotDate: form.snapshotDate,
        principal: Number(form.principal),
        endDate: form.endDate,
        currentPayment: optionalNumber(form.currentPayment),
        spread: Number(form.spread),
        reviewFrequency: Number(form.reviewFrequency),
        nextReviewDate: form.nextReviewDate,
        referenceOffset: Number(form.referenceOffset),
        amortizations: form.amortizations
          .map((item) => ({ date: item.date, amount: Number(item.amount), mode: item.mode }))
          .sort((first, second) => first.date.localeCompare(second.date)),
      });
    } catch (saveError) {
      setError(saveError.message || 'No se pudo guardar la hipoteca.');
    }
  }

  return (
    <form className="mortgage-form" onSubmit={handleSubmit}>
      <div className="mortgage-form-heading">
        <div>
          <span className="eyebrow">DATOS DEL PRÉSTAMO</span>
          <h3>{mortgage ? 'Editar hipoteca' : 'Nueva hipoteca'}</h3>
        </div>
        <button className="text-button mortgage-cancel" type="button" onClick={onCancel}>Cancelar</button>
      </div>

      <fieldset className="form-group">
        <legend>Situación en la fecha de los datos</legend>
        <div className="mortgage-form-grid">
          <label>
            Nombre
            <input name="name" required maxLength="60" value={form.name} onChange={updateField} placeholder="Hipoteca vivienda" />
          </label>
          <label>
            Fecha de estos datos
            <input name="snapshotDate" type="date" required max={todayIso()} value={form.snapshotDate} onChange={updateField} />
          </label>
          <label>
            Capital pendiente (€)
            <input name="principal" type="number" min="1" step="0.01" required value={form.principal} onChange={updateField} />
          </label>
          <label>
            Fecha final actual
            <input name="endDate" type="date" required value={form.endDate} onChange={updateField} />
          </label>
          <label>
            Cuota actual real (€) <small>opcional</small>
            <input name="currentPayment" type="number" min="0" step="0.01" value={form.currentPayment} onChange={updateField} />
          </label>
          <label>
            Diferencial sobre Euríbor (%)
            <input name="spread" type="number" min="-10" max="20" step="0.001" required value={form.spread} onChange={updateField} />
          </label>
        </div>
      </fieldset>

      <fieldset className="form-group">
        <legend>Revisión del tipo</legend>
        <div className="mortgage-form-grid">
          <label>
            Frecuencia
            <select name="reviewFrequency" value={form.reviewFrequency} onChange={updateField}>
              <option value="6">Semestral</option>
              <option value="12">Anual</option>
            </select>
          </label>
          <label>
            Próxima revisión
            <input name="nextReviewDate" type="date" required value={form.nextReviewDate} onChange={updateField} />
          </label>
          <label className="span-2">
            Euríbor medio que se aplica
            <select name="referenceOffset" value={form.referenceOffset} onChange={updateField}>
              <option value="0">Media del mismo mes de la revisión</option>
              <option value="1">Media del mes anterior</option>
              <option value="2">Media de 2 meses antes</option>
              <option value="3">Media de 3 meses antes (p. ej. junio → septiembre)</option>
              <option value="4">Media de 4 meses antes</option>
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset className="form-group">
        <legend>Origen del préstamo <small>opcional</small></legend>
        <div className="mortgage-form-grid">
          <label>
            Capital inicial (€)
            <input name="initialPrincipal" type="number" min="1" step="0.01" value={form.initialPrincipal} onChange={updateField} />
          </label>
          <label>
            Fecha de inicio
            <input name="startDate" type="date" value={form.startDate} onChange={updateField} />
          </label>
        </div>
      </fieldset>

      <fieldset className="form-group">
        <legend>Amortizaciones anticipadas realizadas <small>opcional</small></legend>
        {form.amortizations.length > 0 && (
          <div className="amortization-list">
            {form.amortizations.map((item, index) => (
              <div className="amortization-row" key={index}>
                <input
                  type="date"
                  required
                  aria-label="Fecha de la amortización"
                  value={item.date}
                  onChange={(event) => updateAmortization(index, 'date', event.target.value)}
                />
                <input
                  type="number"
                  min="1"
                  step="0.01"
                  required
                  placeholder="Importe (€)"
                  aria-label="Importe de la amortización"
                  value={item.amount}
                  onChange={(event) => updateAmortization(index, 'amount', event.target.value)}
                />
                <select
                  aria-label="Efecto de la amortización"
                  value={item.mode}
                  onChange={(event) => updateAmortization(index, 'mode', event.target.value)}
                >
                  <option value="plazo">Redujo plazo</option>
                  <option value="cuota">Redujo cuota</option>
                </select>
                <button className="text-button mortgage-action mortgage-action--delete" type="button" onClick={() => removeAmortization(index)}>
                  Quitar
                </button>
                {item.date && (
                  <span className={`amort-tag${item.date > form.snapshotDate ? ' amort-tag--applied' : ''}`}>
                    {item.date > form.snapshotDate
                      ? 'Posterior a los datos: se aplica a la proyección'
                      : 'Anterior a los datos: ya está incluida'}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
        <button className="text-button mortgage-action" type="button" onClick={addAmortization}>+ Añadir amortización</button>
      </fieldset>

      <p className="form-hint">Capital pendiente, cuota y fecha final deben corresponder a la fecha de los datos. A partir de ahí la aplicación proyecta mes a mes, aplicando las revisiones con el Euríbor real y las amortizaciones posteriores a esa fecha. Actualiza los datos cuando quieras reajustarlos con el banco. Sistema francés, sin comisiones ni límites de tipo.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button button--primary mortgage-save" type="submit" disabled={isSaving}>
        {isSaving ? 'Guardando…' : mortgage ? 'Guardar cambios' : 'Guardar hipoteca'}
      </button>
    </form>
  );
}

function LoanProgress({ mortgage, balance }) {
  const { initialPrincipal, amortizations = [] } = mortgage;
  const principal = balance;
  const totalExtra = amortizations.reduce((sum, item) => sum + item.amount, 0);
  const hasInitial = initialPrincipal > 0 && initialPrincipal >= principal;
  if (!hasInitial && amortizations.length === 0) return null;
  const paidShare = hasInitial ? Math.min(((initialPrincipal - principal) / initialPrincipal) * 100, 100) : 0;

  return (
    <div className="loan-progress">
      {hasInitial && (
        <>
          <div className="loan-progress-bar" role="img" aria-label={`${paidShare.toFixed(0)}% del capital devuelto`}>
            <span style={{ width: `${paidShare}%` }} />
          </div>
          <p>
            <strong>{paidShare.toFixed(1).replace('.', ',')}%</strong> devuelto · {formatEuroRound(initialPrincipal - principal)} de {formatEuroRound(initialPrincipal)}
            {mortgage.startDate && <> · desde {formatDate(mortgage.startDate)}</>}
          </p>
        </>
      )}
      {amortizations.length > 0 && (
        <details className="amortization-details">
          <summary>
            {amortizations.length} {amortizations.length === 1 ? 'amortización anticipada' : 'amortizaciones anticipadas'} por {formatEuroRound(totalExtra)}
          </summary>
          <div className="table-wrap">
            <table className="amortization-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th className="number-cell">Importe</th>
                  <th>Efecto</th>
                </tr>
              </thead>
              <tbody>
                {[...amortizations].reverse().map((item) => (
                  <tr key={`${item.date}-${item.amount}`}>
                    <td>
                      {formatDate(item.date)}
                      {mortgage.snapshotDate && item.date > mortgage.snapshotDate && (
                        <span className="badge badge--real">en la proyección</span>
                      )}
                    </td>
                    <td className="number-cell">{formatEuro(item.amount)}</td>
                    <td>{item.mode === 'cuota' ? 'Redujo la cuota' : 'Redujo el plazo'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="number-cell">{formatEuro(totalExtra)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

function MortgageCard({ mortgage, rates, onEdit, onDelete }) {
  const frequencyLabel = mortgage.reviewFrequency === 6 ? 'semestral' : 'anual';
  const projection = useMemo(
    () => projectMortgage(mortgage, monthlyAverages(rates), todayIso()),
    [mortgage, rates]
  );
  const balance = projection ? projection.current.balance : mortgage.principal;
  const remaining = projection ? projection.current.remainingMonths : null;

  return (
    <article className="mortgage-card">
      <div className="mortgage-card-header">
        <div>
          <span className="eyebrow">HIPOTECA {frequencyLabel.toUpperCase()}</span>
          <h3>{mortgage.name}</h3>
          <p className="mortgage-meta">
            {formatEuro(balance)} pendientes hoy
            {remaining != null && <> · {remaining} meses (hasta {formatDate(projection.endDate)})</>} ·
            {' '}Euríbor {mortgage.spread >= 0 ? '+' : ''}{formatPercent(mortgage.spread)} · próxima revisión {formatDate(mortgage.nextReviewDate)}
          </p>
        </div>
        <div className="mortgage-actions">
          <button className="text-button mortgage-action" type="button" onClick={() => onEdit(mortgage)}>Editar</button>
          <button className="text-button mortgage-action mortgage-action--delete" type="button" onClick={() => onDelete(mortgage)}>Eliminar</button>
        </div>
      </div>
      <LoanProgress mortgage={mortgage} balance={balance} />
      <SimulationPanel mortgage={mortgage} rates={rates} />
    </article>
  );
}

export default function MortgageManager({ user, rates, onMortgagesChange }) {
  const [mortgages, setMortgages] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [formError, setFormError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingMortgage, setEditingMortgage] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const mortgageCollection = collection(db, 'users', user.uid, 'mortgages');

  useEffect(() => {
    if (onMortgagesChange) onMortgagesChange(mortgages);
  }, [mortgages]);

  useEffect(() => {
    let active = true;

    async function loadMortgages() {
      setIsLoading(true);
      setLoadError('');
      try {
        const snapshot = await getDocs(query(mortgageCollection, orderBy('createdAt', 'desc')));
        if (active) {
          setMortgages(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
        }
      } catch (loadErrorValue) {
        if (active) setLoadError(loadErrorValue.message || 'No se pudieron cargar tus hipotecas.');
      } finally {
        if (active) setIsLoading(false);
      }
    }

    loadMortgages();
    return () => {
      active = false;
    };
  }, [user.uid]);

  async function saveMortgage(values) {
    if (!values.name) throw new Error('Escribe un nombre para identificar la hipoteca.');
    const today = todayIso();
    if (!values.snapshotDate || values.snapshotDate > today) {
      throw new Error('La fecha de los datos no puede ser posterior a hoy.');
    }
    if (!(values.principal > 0)) throw new Error('El capital pendiente debe ser mayor que cero.');
    if (!values.endDate || values.endDate <= today) {
      throw new Error('La fecha final debe ser posterior a hoy.');
    }
    if (!Number.isFinite(values.spread) || values.spread < -10 || values.spread > 20) {
      throw new Error('Introduce un diferencial válido.');
    }
    if (!values.nextReviewDate) throw new Error('Indica la fecha de la próxima revisión.');
    if (values.initialPrincipal != null && values.initialPrincipal < values.principal) {
      throw new Error('El capital inicial no puede ser menor que el pendiente.');
    }
    if (values.startDate && values.startDate >= values.endDate) {
      throw new Error('La fecha de inicio debe ser anterior a la final.');
    }
    if (values.amortizations.some((item) => !item.date || !(item.amount > 0))) {
      throw new Error('Cada amortización necesita fecha e importe mayor que cero.');
    }
    calculateMonthlyPayment(values.principal, values.spread, monthsBetween(values.snapshotDate, values.endDate) || 1);

    setIsSaving(true);
    setFormError('');
    try {
      if (editingMortgage) {
        const mortgageRef = doc(mortgageCollection, editingMortgage.id);
        await updateDoc(mortgageRef, { ...values, updatedAt: serverTimestamp() });
        setMortgages((previous) => previous.map((item) =>
          item.id === editingMortgage.id ? { ...item, ...values } : item
        ));
      } else {
        const mortgageRef = await addDoc(mortgageCollection, {
          ...values,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        setMortgages((previous) => [{ id: mortgageRef.id, ...values }, ...previous]);
      }
      setShowForm(false);
      setEditingMortgage(null);
    } catch (saveError) {
      throw new Error(saveError.message || 'No se pudo guardar la hipoteca.');
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteMortgage() {
    if (!pendingDelete) return;
    setFormError('');
    try {
      await deleteDoc(doc(mortgageCollection, pendingDelete.id));
      setMortgages((previous) => previous.filter((item) => item.id !== pendingDelete.id));
      setPendingDelete(null);
    } catch (deleteError) {
      setFormError(deleteError.message || 'No se pudo eliminar la hipoteca.');
      setPendingDelete(null);
    }
  }

  function startEditing(mortgage) {
    setEditingMortgage(mortgage);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingMortgage(null);
  }

  return (
    <section className="mortgages-section">
      <div className="mortgages-heading">
        <div>
          <span className="eyebrow">TU PERFIL</span>
          <h2>Mis hipotecas</h2>
          <p>Añade tus datos para ver una estimación de cuota y comparar escenarios con el Euríbor histórico.</p>
        </div>
        {!showForm && (
          <button
            className="button button--primary mortgage-add"
            type="button"
            onClick={() => {
              setEditingMortgage(null);
              setShowForm(true);
            }}
          >
            + Añadir hipoteca
          </button>
        )}
      </div>

      {showForm && (
        <MortgageForm
          key={editingMortgage?.id || 'new'}
          mortgage={editingMortgage}
          isSaving={isSaving}
          onCancel={closeForm}
          onSave={saveMortgage}
        />
      )}
      {formError && <p className="form-error" role="alert">{formError}</p>}
      {isLoading ? (
        <p className="muted">Cargando tus hipotecas…</p>
      ) : loadError ? (
        <p className="form-error" role="alert">{loadError}</p>
      ) : mortgages.length === 0 && !showForm ? (
        <div className="mortgage-empty">
          <span className="mortgage-empty-mark">€</span>
          <h3>Aún no has añadido una hipoteca</h3>
          <p>Guarda el capital pendiente, el plazo y el diferencial para comenzar a comparar cuotas.</p>
          <button className="button button--light mortgage-add-first" type="button" onClick={() => setShowForm(true)}>
            Añadir mi primera hipoteca
          </button>
        </div>
      ) : (
        <div className="mortgage-list">
          {mortgages.map((mortgage) => (
            <MortgageCard
              key={mortgage.id}
              mortgage={mortgage}
              rates={rates}
              onEdit={startEditing}
              onDelete={setPendingDelete}
            />
          ))}
        </div>
      )}

      {pendingDelete && (
        <div className="confirm-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setPendingDelete(null);
        }}>
          <section className="confirm-card" role="dialog" aria-modal="true" aria-labelledby="delete-title">
            <h3 id="delete-title">¿Eliminar “{pendingDelete.name}”?</h3>
            <p>Se borrarán sus datos guardados. Esta acción no se puede deshacer.</p>
            <div className="confirm-actions">
              <button className="button button--light" type="button" onClick={() => setPendingDelete(null)}>Cancelar</button>
              <button className="button button--danger" type="button" onClick={deleteMortgage}>Eliminar</button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
