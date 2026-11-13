import { useMemo, useState } from 'react';
import { api } from './api';
import { AnimatedNumber, ConfirmModal, Empty, GlassCard, Icon, dt, eur, today } from './ui';

export const PurchaseChips = ({ stats }) => (
  <div className="chips">
    <div className="chip glass"><span>Achats chez Youssef</span><b><AnimatedNumber value={stats.bought_supplier_dt} format={dt} /></b></div>
    <div className="chip glass"><span>Achats autres fournisseurs</span><b><AnimatedNumber value={stats.bought_external_dt} format={dt} /></b></div>
    <div className="chip glass"><span>Total des achats</span><b><AnimatedNumber value={stats.bought_supplier_dt + stats.bought_external_dt} format={dt} /></b></div>
    <div className="chip glass"><span>Stock actuel</span><b><AnimatedNumber value={stats.stock_cost_dt} format={dt} /></b></div>
  </div>
);

// All purchases: from the supplier (read-only here) and from other suppliers (deletable when onDelete is given).
export function PurchasesTable({ purchases, onDelete }) {
  const [source, setSource] = useState('');
  const shown = useMemo(() => purchases.filter((p) => !source || p.source === source), [purchases, source]);
  return (
    <>
      <div className="card-head">
        <h3 className="card-title"><Icon name="box" /> Historique des achats</h3>
        <select className="select-sm" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Filtrer par fournisseur">
          <option value="">Tous les fournisseurs</option>
          <option value="fournisseur">Youssef Belghith</option>
          <option value="externe">Autres fournisseurs</option>
        </select>
      </div>
      {shown.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Date</th><th>Article</th><th className="r">Qté</th><th className="r">Coût unit.</th><th className="r">Total</th>{onDelete && <th />}</tr>
            </thead>
            <tbody>
              {shown.map((p, i) => (
                <tr key={p.id} className="rise" style={{ animationDelay: `${Math.min(i, 10) * 0.025}s` }}>
                  <td className="muted nowrap">{p.date}</td>
                  <td>
                    <div className="cell-name">{p.name}</div>
                    <div className="cell-sub">
                      <span className={`tag ${p.source === 'externe' ? 'ext' : ''}`}>{p.supplier || 'Autre fournisseur'}</span>
                      {p.category}
                    </div>
                  </td>
                  <td className="r">{p.qty}</td>
                  <td className="r nowrap">
                    {dt(p.unit_cost_dt)}
                    {p.price_eur != null && <div className="cell-sub">{eur(p.price_eur)} × {p.rate}</div>}
                  </td>
                  <td className="r nowrap"><b>{dt(p.total_dt)}</b></td>
                  {onDelete && (
                    <td className="r">
                      {p.source === 'externe' && (
                        <button type="button" className="icon-btn danger" aria-label={`Supprimer l’achat ${p.name}`} onClick={() => onDelete(p)}>
                          <Icon name="trash" size={16} />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty icon="box">Aucun achat.</Empty>
      )}
    </>
  );
}

function PurchaseForm({ items, rate, onSubmit }) {
  const external = items.filter((i) => i.source === 'externe');
  const [itemKey, setItemKey] = useState(''); // '' = new article
  const [currency, setCurrency] = useState('eur');
  const [chosenRate, setChosenRate] = useState(null); // null = his current rate
  const [f, setF] = useState({ name: '', supplier: '', category: '', qty: '1', cost: '', date: today() });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const eurRate = chosenRate ?? rate.rate;
  const unitDt = (Number(f.cost) || 0) * (currency === 'eur' ? eurRate : 1);
  const total = (Number(f.qty) || 0) * unitDt;

  const submit = async (e) => {
    e.preventDefault();
    const price = currency === 'eur' ? { unit_price_eur: Number(f.cost), eur_rate: eurRate } : { unit_cost_dt: Number(f.cost) };
    const base = { qty: Number(f.qty), ...price, bought_at: f.date, supplier: f.supplier.trim(), category: f.category.trim() };
    const ok = await onSubmit(itemKey ? { ...base, item_id: Number(itemKey.slice(1)) } : { ...base, name: f.name.trim() });
    if (ok) setF({ ...f, name: '', qty: '1', cost: '' });
  };

  return (
    <form className="form" onSubmit={submit}>
      {external.length > 0 && (
        <label>Article
          <select value={itemKey} onChange={(e) => setItemKey(e.target.value)}>
            <option value="">+ Nouvel article</option>
            {external.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.supplier || 'autre'})</option>)}
          </select>
        </label>
      )}
      {!itemKey && (
        <>
          <label>Nom de l’article
            <input type="text" required maxLength={120} value={f.name} onChange={set('name')} />
          </label>
          <div className="grid-2">
            <label>Fournisseur
              <input type="text" maxLength={80} value={f.supplier} onChange={set('supplier')} placeholder="ex. Boutique X" />
            </label>
            <label>Catégorie
              <input type="text" maxLength={40} value={f.category} onChange={set('category')} />
            </label>
          </div>
        </>
      )}
      <div className="grid-2">
        <label>Quantité
          <input type="number" required min="1" step="1" value={f.qty} onChange={set('qty')} />
        </label>
        <label>Prix d’achat unitaire
          <span className="currency-field">
            <input type="number" required min="0" step={currency === 'eur' ? '0.01' : '0.001'} value={f.cost} onChange={set('cost')} />
            <span className="currency-switch" role="group" aria-label="Devise du prix">
              {[['eur', '€'], ['dt', 'DT']].map(([key, label]) => (
                <button key={key} type="button" className={currency === key ? 'on' : ''} aria-pressed={currency === key}
                  onClick={() => setCurrency(key)}>{label}</button>
              ))}
            </span>
          </span>
        </label>
        {currency === 'eur' && (
          <label>Taux (1 € en DT)
            <select value={eurRate} onChange={(e) => setChosenRate(Number(e.target.value))}>
              {rate.rates.map((r) => <option key={r} value={r}>× {r}{r === rate.rate ? ' (mon taux)' : ''}</option>)}
            </select>
          </label>
        )}
        <label>Date d’achat
          <input type="date" required value={f.date} onChange={set('date')} />
        </label>
      </div>
      <div className="preview">
        {currency === 'eur' && <span>{eur(Number(f.cost) || 0)} × {eurRate} = {dt(unitDt)} / unité</span>}
        <span>Total de l’achat</span>
        <b><AnimatedNumber value={total} format={dt} /></b>
      </div>
      <div className="form-actions">
        <button type="submit" className="btn primary"><Icon name="plus" size={16} /> Enregistrer l’achat</button>
      </div>
    </form>
  );
}

// His own purchase rate, editable in place (Enter to save, Escape to cancel).
function RateBadge({ rate, run }) {
  const [draft, setDraft] = useState(null);
  const save = async (e) => {
    e.preventDefault();
    if (await run(() => api.put('/reseller/rate', { rate: Number(draft) }), 'Taux d’achat mis à jour')) setDraft(null);
  };
  if (draft !== null) {
    return (
      <form className="rate-badge" onSubmit={save}>
        <Icon name="sliders" size={15} /> 1 € =
        <input className="rate-input" type="number" min="0.01" max="100" step="0.01" required autoFocus value={draft}
          aria-label="Mon taux d’achat" onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setDraft(null)} /> DT
        <button type="submit" className="rate-save">OK</button>
      </form>
    );
  }
  return (
    <button type="button" className="rate-badge" onClick={() => setDraft(String(rate))} title="Modifier mon taux d’achat">
      <Icon name="sliders" size={15} /> Mon taux d’achat : <b>1 € = {rate} DT</b> <Icon name="edit" size={14} />
    </button>
  );
}

// Reseller page: record purchases from other suppliers and see every purchase.
export default function Purchases({ articles, purchases, stats, rate, run }) {
  const [deleting, setDeleting] = useState(null);
  return (
    <div className="page">
      <PurchaseChips stats={stats} />
      <div className="row-1-2">
        <GlassCard>
          <h3 className="card-title"><Icon name="plus" /> Achat chez un autre fournisseur</h3>
          <p className="hint">Les achats chez Youssef Belghith s’ajoutent tout seuls.</p>
          <RateBadge rate={rate.rate} run={run} />
          <PurchaseForm items={articles} rate={rate} onSubmit={(body) => run(() => api.post('/reseller/purchases', body), 'Achat enregistré')} />
        </GlassCard>
        <GlassCard delay={0.08}>
          <PurchasesTable purchases={purchases} onDelete={setDeleting} />
        </GlassCard>
      </div>
      <ConfirmModal
        message={deleting && `Supprimer l’achat de ${deleting.qty} × « ${deleting.name} » ? Les unités sortiront du stock.`}
        onConfirm={() => run(() => api.del(`/reseller/purchases/${deleting.id.slice(1)}`), 'Achat supprimé')}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
