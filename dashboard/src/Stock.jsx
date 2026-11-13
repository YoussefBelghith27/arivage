import { useMemo, useRef, useState } from 'react';
import { api } from './api';
import { SellModal } from './Sales';
import { AnimatedNumber, ConfirmModal, GlassCard, Icon, Modal, Search, dt, eur, int } from './ui';

// The fields the API accepts for an article (it rejects any other key).
const toBody = (a) => ({
  name: a.name, supplier: a.supplier, category: a.category, price_eur: a.price_eur, shipping_eur: a.shipping_eur,
  buy_price_dt: a.buy_price_dt, sell_price_dt: a.sell_price_dt, stock: a.stock, arrival: a.arrival, carrier: a.carrier,
  reseller_id: a.reseller_id ?? null,
});
const optional = (v) => (v === '' ? null : Number(v));

// Price cell editable in place: click, type, Enter to save, empty = automatic price (or none).
export function PriceCell({ value, fixed, label, onSave, tag = true }) {
  const [draft, setDraft] = useState(null);
  const cancelled = useRef(false);
  const commit = () => {
    const v = draft?.trim() ?? '';
    setDraft(null);
    if (cancelled.current) { cancelled.current = false; return; }
    const next = optional(v);
    if (next !== null && !(next >= 0)) return;
    if (next !== (fixed ?? null)) onSave(next);
  };
  if (draft !== null) {
    return (
      <input className="cell-input" type="number" min="0" step="0.001" autoFocus value={draft} placeholder="auto"
        aria-label={label} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') { cancelled.current = true; e.currentTarget.blur(); }
        }} />
    );
  }
  return (
    <button type="button" className="cell-edit" aria-label={label} title="Cliquer pour modifier · vide = automatique"
      onClick={() => setDraft(fixed == null ? '' : String(fixed))}>
      {value == null ? <span className="todo">à définir</span> : dt(value)}
      {tag && fixed != null && <span className="fixed">fixe</span>}
    </button>
  );
}

function ArticleForm({ initial, settings, categories, carriers, resellers, onSubmit, onCancel }) {
  const [f, setF] = useState({
    name: initial?.name ?? '',
    supplier: initial?.supplier ?? '',
    category: initial?.category ?? '',
    price_eur: initial ? String(initial.price_eur) : '',
    shipping_eur: String(initial?.shipping_eur ?? 0),
    buy_price_dt: initial?.buy_price_dt == null ? '' : String(initial.buy_price_dt),
    sell_price_dt: initial?.sell_price_dt == null ? '' : String(initial.sell_price_dt),
    stock: initial ? String(initial.stock) : '1',
    arrival: initial?.arrival == null ? '' : String(initial.arrival),
    carrier: initial?.carrier ?? '',
    reseller_id: String(initial?.reseller_id ?? ''), // '' = external sale
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const priceEur = Number(f.price_eur) || 0;
  const shipEur = Number(f.shipping_eur) || 0;
  // Same formulas as the server (store.js priced).
  const autoBuy = (priceEur + shipEur) * settings.rate_buy;
  const autoSell = priceEur * settings.rate_sell + shipEur * settings.rate_shipping;
  const buy = f.buy_price_dt === '' ? autoBuy : Number(f.buy_price_dt);
  const sell = f.sell_price_dt === '' ? autoSell : Number(f.sell_price_dt);

  const submit = (e) => {
    e.preventDefault();
    onSubmit({
      name: f.name.trim(),
      supplier: f.supplier.trim(),
      category: f.category.trim(),
      price_eur: Number(f.price_eur),
      shipping_eur: Number(f.shipping_eur) || 0,
      buy_price_dt: optional(f.buy_price_dt),
      sell_price_dt: optional(f.sell_price_dt),
      stock: Number(f.stock),
      arrival: optional(f.arrival),
      carrier: f.carrier.trim(),
      reseller_id: optional(f.reseller_id),
    });
  };

  return (
    <form className="form" onSubmit={submit}>
      <label>Nom de l’article
        <input type="text" required maxLength={120} value={f.name} onChange={set('name')} autoFocus />
      </label>
      <label>Destination
        <select value={f.reseller_id} onChange={set('reseller_id')}>
          <option value="">Vente externe</option>
          {resellers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </label>
      <div className="grid-2">
        <label>Fournisseur
          <input type="text" maxLength={80} value={f.supplier} onChange={set('supplier')} />
        </label>
        <label>Catégorie
          <input type="text" maxLength={40} list="categories" value={f.category} onChange={set('category')} />
          <datalist id="categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        </label>
        <label>Prix unitaire (€)
          <input type="number" required min="0" step="0.01" value={f.price_eur} onChange={set('price_eur')} />
        </label>
        <label>Livraison (€/unité)
          <input type="number" min="0" step="0.01" value={f.shipping_eur} onChange={set('shipping_eur')} />
        </label>
        <label>Quantité en stock
          <input type="number" required min="0" step="1" value={f.stock} onChange={set('stock')} />
        </label>
        <label>N° d’arrivage
          <input type="number" min="1" step="1" value={f.arrival} onChange={set('arrival')} placeholder="ex. 3" />
        </label>
        <label>Transporteur principal
          <input type="text" maxLength={60} list="carriers" value={f.carrier} onChange={set('carrier')} placeholder="ex. QA-store" />
          <datalist id="carriers">{carriers.map((c) => <option key={c} value={c} />)}</datalist>
        </label>
      </div>
      <div className="grid-2">
        <label>Prix d’achat (DT) <span className="opt">vide = (€ + livraison) × {settings.rate_buy}</span>
          <input type="number" min="0" step="0.001" value={f.buy_price_dt} placeholder={autoBuy.toFixed(3)} onChange={set('buy_price_dt')} />
        </label>
        <label>Prix de vente (DT) <span className="opt">vide = € × {settings.rate_sell} + livraison × {settings.rate_shipping}</span>
          <input type="number" min="0" step="0.001" value={f.sell_price_dt} placeholder={autoSell.toFixed(3)} onChange={set('sell_price_dt')} />
        </label>
      </div>
      <div className="preview">
        <span>Unité</span>
        <b>achat {dt(buy)}</b>
        <b>vente {dt(sell)}</b>
        <b className={sell - buy >= 0 ? 'pos' : 'neg'}>marge {dt(sell - buy)}</b>
      </div>
      <div className="form-actions">
        <button type="button" className="btn ghost" onClick={onCancel}>Annuler</button>
        <button type="submit" className="btn primary">{initial ? 'Enregistrer' : 'Ajouter l’article'}</button>
      </div>
    </form>
  );
}

export default function Stock({ articles, sales = [], stats, settings, categories, run, resellers }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [editing, setEditing] = useState(null); // null = closed, {} = new article, article = edit
  const [selling, setSelling] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return articles.filter((a) => (!cat || a.category === cat)
      && `${a.name} ${a.supplier} ${a.carrier} ${a.arrival != null ? `arrivage ${a.arrival}` : ''}`.toLowerCase().includes(s));
  }, [articles, q, cat]);

  // One section per destination: external sale first, then each reseller; empty ones are hidden.
  const sections = [{ id: null, title: 'Stock vente externe' }, ...resellers.map((u) => ({ id: u.id, title: `Stock ${u.name}` }))]
    .map((g) => ({ ...g, list: shown.filter((a) => (a.reseller_id ?? null) === g.id) }))
    .filter((g, i) => g.list.length || (i === 0 && !shown.length));

  const save = async (body) => {
    const isNew = !editing.id;
    const ok = await run(
      () => (isNew ? api.post('/articles', body) : api.put(`/articles/${editing.id}`, body)),
      isNew ? 'Article ajouté' : 'Article modifié',
    );
    if (ok) setEditing(null);
  };
  const adjust = (a, delta) => run(() => api.patch(`/articles/${a.id}/stock`, { delta }));
  const setPrice = (a, field, value) => run(
    () => api.put(`/articles/${a.id}`, { ...toBody(a), [field]: value }),
    value === null ? 'Prix automatique rétabli' : 'Prix mis à jour',
  );

  return (
    <div className="page">
      <div className="chips">
        <div className="chip glass"><span>Articles</span><b>{stats.article_count}</b></div>
        <div className="chip glass"><span>Unités en stock</span><b>{int(stats.stock_units)}</b></div>
        <div className="chip glass"><span>Coût d’achat</span><b><AnimatedNumber value={stats.stock_cost_dt} format={dt} /></b></div>
        <div className="chip glass"><span>Valeur de vente</span><b className="pos"><AnimatedNumber value={stats.stock_value_dt} format={dt} /></b></div>
      </div>

      <GlassCard>
        <div className="card-head">
          <h3 className="card-title"><Icon name="box" /> Inventaire</h3>
          <div className="toolbar">
            <Search value={q} onChange={setQ} label="Rechercher un article" />
            <select className="select-sm" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Filtrer par catégorie">
              <option value="">Toutes catégories</option>
              {categories.map((c) => <option key={c}>{c}</option>)}
            </select>
            <button type="button" className="btn primary" onClick={() => setEditing({})}><Icon name="plus" size={16} /> Article</button>
          </div>
        </div>

        {sections.map(({ id, title, list }) => {
          // Reseller section: value of the units already sold to that reseller (sold × sale price), not of the stock left.
          const sold = (a) => sales.reduce((n, s) => n + (s.article_id === a.id && s.reseller_id === id ? s.qty : 0), 0);
          const value = (a) => (id == null ? a.stock : sold(a)) * a.sell_dt;
          const totals = list.reduce((t, a) => ({
            units: t.units + a.stock,
            eur: t.eur + a.stock * a.price_eur,
            cost: t.cost + a.stock * a.buy_dt,
            value: t.value + value(a),
          }), { units: 0, eur: 0, cost: 0, value: 0 });
          return (
            <section key={id ?? 'external'} aria-label={title}>
              <h4 className="card-title">{title}</h4>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Article</th><th className="r">Prix €</th>{id != null && <th className="r">Shipping</th>}<th className="r">Achat DT</th><th className="r">Vente DT</th>
                      <th className="r">Marge</th><th className="c">Stock</th>
                      <th className="r">{id == null ? 'Valeur vente' : `Vendu à ${title.replace(/^Stock /, '')}`}</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((a, i) => (
                      <tr key={a.id} className={`rise ${a.stock === 0 ? 'out' : ''}`} style={{ animationDelay: `${Math.min(i, 12) * 0.02}s` }}>
                        <td>
                          <div className="cell-name">{a.name}</div>
                          <div className="cell-sub">
                            {a.category && <span className="tag">{a.category}</span>}
                            {a.supplier}
                            {a.arrival != null && <span className="ship">Arrivage {a.arrival}</span>}
                            {a.carrier && <span className="ship">{a.carrier}</span>}
                          </div>
                        </td>
                        <td className="r nowrap">{eur(a.price_eur)}</td>
                        {id != null && (
                          <td className="r nowrap">
                            {a.shipping_eur ? <>+{dt(a.shipping_dt)}<div className="cell-sub">coût {dt(a.shipping_cost_dt)}</div></> : '—'}
                          </td>
                        )}
                        <td className="r nowrap">
                          <PriceCell value={a.buy_dt} fixed={a.buy_price_dt} label={`Prix d’achat de ${a.name}`}
                            onSave={(v) => setPrice(a, 'buy_price_dt', v)} />
                        </td>
                        <td className="r nowrap">
                          <PriceCell value={a.sell_dt} fixed={a.sell_price_dt} label={`Prix de vente de ${a.name}`}
                            onSave={(v) => setPrice(a, 'sell_price_dt', v)} />
                        </td>
                        <td className={`r nowrap ${a.margin_dt >= 0 ? 'pos' : 'neg'}`}>{dt(a.margin_dt)}</td>
                        <td className="c">
                          <div className="stepper">
                            <button type="button" aria-label={`Retirer 1 ${a.name}`} disabled={a.stock === 0} onClick={() => adjust(a, -1)}><Icon name="minus" size={14} /></button>
                            <span key={a.stock} className={`badge pop ${a.stock === 0 ? 'neg' : a.stock <= 1 ? 'warn' : 'pos'}`}>{a.stock}</span>
                            <button type="button" aria-label={`Ajouter 1 ${a.name}`} onClick={() => adjust(a, 1)}><Icon name="plus" size={14} /></button>
                          </div>
                        </td>
                        <td className="r nowrap">
                          {dt(value(a))}
                          {id != null && <div className="cell-sub">{sold(a)} vendu{sold(a) > 1 ? 's' : ''}</div>}
                        </td>
                        <td className="r nowrap">
                          <button type="button" className="icon-btn sell" disabled={a.stock === 0} aria-label={`Vendre ${a.name}`} title="Vendre" onClick={() => setSelling(a)}><Icon name="cart" size={16} /></button>
                          <button type="button" className="icon-btn" aria-label={`Modifier ${a.name}`} title="Modifier" onClick={() => setEditing(a)}><Icon name="edit" size={16} /></button>
                          <button type="button" className="icon-btn danger" aria-label={`Supprimer ${a.name}`} title="Supprimer" onClick={() => setDeleting(a)}><Icon name="trash" size={16} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>{list.length} articles · {int(totals.units)} unités</td>
                      <td className="r nowrap">{eur(totals.eur)}</td>
                      {id != null && <td />}
                      <td className="r nowrap">{dt(totals.cost)}</td>
                      <td colSpan={2} />
                      <td />
                      <td className="r nowrap">{dt(totals.value)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
              {!list.length && <div className="empty"><p>Aucun article ne correspond.</p></div>}
            </section>
          );
        })}
      </GlassCard>

      <Modal open={!!editing} title={editing?.id ? 'Modifier l’article' : 'Nouvel article'} onClose={() => setEditing(null)}>
        {editing && <ArticleForm initial={editing.id ? editing : null} settings={settings} categories={categories}
          carriers={[...new Set(articles.map((a) => a.carrier).filter(Boolean))]} resellers={resellers} onSubmit={save} onCancel={() => setEditing(null)} />}
      </Modal>

      <SellModal articles={articles} article={selling} url="/sales" run={run} onClose={() => setSelling(null)}
        resellers={resellers} buyerDefault={selling?.reseller_id ?? null} />

      <ConfirmModal
        message={deleting && `Supprimer « ${deleting.name} » du stock ?`}
        onConfirm={() => run(() => api.del(`/articles/${deleting.id}`), 'Article supprimé')}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
