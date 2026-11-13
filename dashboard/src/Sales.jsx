import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from './api';
import { AnimatedNumber, ConfirmModal, Empty, GlassCard, Icon, Modal, Search, dt, int, today } from './ui';

// Article ids are numbers (supplier) or keys like 'x3' (reseller), so ids are compared as strings.
// resellers: admin only (undefined hides "Vendu à"); buyerDefault = a reseller id, or null for another client.
export function SaleForm({ articles, presetId, onSubmit, onCancel, resellers, buyerDefault = null }) {
  const available = articles.filter((a) => a.stock > 0 || a.id === presetId);
  const [articleId, setArticleId] = useState(String(presetId ?? ''));
  const [qty, setQty] = useState('1');
  const [price, setPrice] = useState('');
  const [client, setClient] = useState('');
  const [date, setDate] = useState(today());
  const [buyer, setBuyer] = useState(String(buyerDefault ?? '')); // '' = another client
  const toClient = !!resellers && buyer === ''; // another client: his name is required

  // Falls back to the first article when the chosen one sold out.
  const article = available.find((a) => String(a.id) === articleId) ?? available[0];
  const unit = price === '' ? article?.sell_dt ?? 0 : Number(price);
  const total = unit * (Number(qty) || 0);
  const profit = (unit - (article?.buy_dt ?? 0)) * (Number(qty) || 0);

  const submit = async (e) => {
    e.preventDefault();
    const ok = await onSubmit({
      article_id: article.id,
      qty: Number(qty),
      ...(price === '' ? {} : { unit_price_dt: Number(price) }),
      client: client.trim(),
      sold_at: date,
      ...(resellers ? { reseller_id: buyer === '' ? null : Number(buyer) } : {}),
    });
    if (ok) { setQty('1'); setPrice(''); setClient(''); }
  };

  if (!available.length) return <p className="muted">Aucun article en stock à vendre.</p>;

  return (
    <form className="form" onSubmit={submit}>
      <label>Article
        <select value={String(article.id)} onChange={(e) => { setArticleId(e.target.value); setPrice(''); }} required>
          {available.map((a) => <option key={a.id} value={a.id}>{a.name} — stock {a.stock}</option>)}
        </select>
      </label>
      {resellers && (
        <label>Vendu à
          <select value={buyer} onChange={(e) => setBuyer(e.target.value)}>
            <option value="">Client externe</option>
            {resellers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
      )}
      <div className="grid-2">
        <label>Quantité
          <input type="number" min="1" max={article.stock || 1} step="1" required value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
        <label>Prix unitaire (DT)
          <input type="number" min="0" step="0.001" value={price} required={article.sell_dt == null}
            placeholder={article.sell_dt == null ? 'à saisir' : article.sell_dt.toFixed(3)}
            onChange={(e) => setPrice(e.target.value)} />
        </label>
        <label>Client {!toClient && <span className="opt">(optionnel)</span>}
          <input type="text" maxLength={80} required={toClient} value={client} onChange={(e) => setClient(e.target.value)} />
        </label>
        <label>Date
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      <div className="preview">
        <span>Total</span>
        <b><AnimatedNumber value={total} format={dt} /></b>
        <b className={profit >= 0 ? 'pos' : 'neg'}>bénéfice <AnimatedNumber value={profit} format={dt} /></b>
      </div>
      <div className="form-actions">
        {onCancel && <button type="button" className="btn ghost" onClick={onCancel}>Annuler</button>}
        <button type="submit" className="btn primary"><Icon name="cart" size={16} /> Enregistrer la vente</button>
      </div>
    </form>
  );
}

// "Vendre" from a stock row: the sale form preset on that article, closed once the sale is saved.
export const SellModal = ({ articles, article, url, run, onClose, resellers, buyerDefault }) => (
  <Modal open={!!article} title="Vendre" onClose={onClose}>
    {article && (
      <SaleForm articles={articles} presetId={article.id} onCancel={onClose} resellers={resellers} buyerDefault={buyerDefault}
        onSubmit={async (body) => {
          const ok = await run(() => api.post(url, body), 'Vente enregistrée');
          if (ok) onClose();
          return ok;
        }} />
    )}
  </Modal>
);

// Admin: edit a sale's qty, price, client, date and buyer (the article stays). max = units this sale can take.
function EditSaleForm({ sale, max, resellers, onSubmit, onCancel }) {
  const [qty, setQty] = useState(String(sale.qty));
  const [price, setPrice] = useState(String(sale.unit_price_dt));
  const [client, setClient] = useState(sale.client);
  const [date, setDate] = useState(sale.sold_at);
  const [buyer, setBuyer] = useState(String(sale.reseller_id ?? '')); // '' = another client
  const submit = (e) => {
    e.preventDefault();
    onSubmit({ qty: Number(qty), unit_price_dt: Number(price), client: client.trim(), sold_at: date, reseller_id: buyer === '' ? null : Number(buyer) });
  };
  return (
    <form className="form" onSubmit={submit}>
      <p className="cell-name">{sale.article_name}</p>
      <label>Vendu à
        <select value={buyer} onChange={(e) => setBuyer(e.target.value)}>
          <option value="">Client externe</option>
          {resellers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </label>
      <div className="grid-2">
        <label>Quantité
          <input type="number" min="1" max={max} step="1" required value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
        <label>Prix unitaire (DT)
          <input type="number" min="0" step="0.001" required value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
        <label>Client {buyer !== '' && <span className="opt">(optionnel)</span>}
          <input type="text" maxLength={80} required={buyer === ''} value={client} onChange={(e) => setClient(e.target.value)} />
        </label>
        <label>Date
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      <div className="preview"><span>Total</span><b>{dt(Number(price) * (Number(qty) || 0))}</b></div>
      <div className="form-actions">
        <button type="button" className="btn ghost" onClick={onCancel}>Annuler</button>
        <button type="submit" className="btn primary"><Icon name="edit" size={16} /> Enregistrer</button>
      </div>
    </form>
  );
}

// Bon de vente (BV) / bon de livraison (BL): hidden on screen, the only thing printed (see @media print).
function SaleDoc({ sale, kind }) {
  const bv = kind === 'BV';
  return createPortal(
    <div className="print-doc">
      <header>
        <div><h1>Arivage</h1><div>Youssef Belghith</div></div>
        <div className="r">
          <h2>{bv ? 'Bon de vente' : 'Bon de livraison'}</h2>
          <div>N° {kind}-{String(sale.id).padStart(6, '0')}</div>
          <div>Date : {sale.sold_at.split('-').reverse().join('/')}</div>
        </div>
      </header>
      <p><b>Client :</b> {sale.reseller_name || sale.client || 'Client'}</p>
      <table>
        <thead>
          <tr><th>Article</th><th className="r">Quantité</th>{bv && <><th className="r">Prix unitaire</th><th className="r">Total</th></>}</tr>
        </thead>
        <tbody>
          <tr>
            <td>{sale.article_name}</td><td className="r">{sale.qty}</td>
            {bv && <><td className="r">{dt(sale.unit_price_dt)}</td><td className="r">{dt(sale.total_dt)}</td></>}
          </tr>
        </tbody>
        {bv && <tfoot><tr><th colSpan={3} className="r">Total</th><th className="r">{dt(sale.total_dt)}</th></tr></tfoot>}
      </table>
      {!bv && (
        <div className="signatures">
          <div>Livré par</div>
          <div>Reçu par (nom, date, signature)</div>
        </div>
      )}
    </div>,
    document.body,
  );
}

export function SalesTable({ sales, onDelete, onEdit, onPrint, title = 'Historique des ventes' }) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return sales.filter((x) => `${x.article_name} ${x.client} ${x.supplier ?? ''}`.toLowerCase().includes(s));
  }, [sales, q]);

  return (
    <>
      <div className="card-head">
        <h3 className="card-title"><Icon name="cart" /> {title}</h3>
        <Search value={q} onChange={setQ} label="Rechercher une vente" />
      </div>
      {shown.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Date</th><th>Article</th><th className="r">Qté</th><th className="r">Prix unit.</th><th className="r">Total</th><th className="r">Bénéfice</th>{onDelete && <th />}</tr>
            </thead>
            <tbody>
              {shown.map((s, i) => (
                <tr key={s.id} className="rise" style={{ animationDelay: `${Math.min(i, 10) * 0.025}s` }}>
                  <td className="muted nowrap">{s.sold_at}</td>
                  <td>
                    <div className="cell-name">{s.article_name}</div>
                    {(s.client || s.supplier) && (
                      <div className="cell-sub">
                        {s.supplier && <span className="tag">{s.supplier}</span>}
                        {s.client}
                      </div>
                    )}
                  </td>
                  <td className="r">{s.qty}</td>
                  <td className="r nowrap">{dt(s.unit_price_dt)}</td>
                  <td className="r nowrap"><b>{dt(s.total_dt)}</b></td>
                  <td className={`r nowrap ${s.profit_dt >= 0 ? 'pos' : 'neg'}`}>{dt(s.profit_dt)}</td>
                  {onDelete && (
                    <td className="r nowrap">
                      {onEdit && (
                        <>
                          <button type="button" className="icon-btn" aria-label={`Modifier la vente ${s.article_name}`} title="Modifier" onClick={() => onEdit(s)}><Icon name="edit" size={16} /></button>
                          <button type="button" className="icon-btn" aria-label={`Bon de vente ${s.article_name}`} title="Bon de vente" onClick={() => onPrint({ sale: s, kind: 'BV' })}><Icon name="doc" size={16} /></button>
                          <button type="button" className="icon-btn" aria-label={`Bon de livraison ${s.article_name}`} title="Bon de livraison" onClick={() => onPrint({ sale: s, kind: 'BL' })}><Icon name="box" size={16} /></button>
                        </>
                      )}
                      <button type="button" className="icon-btn danger" aria-label={`Supprimer la vente ${s.article_name}`} title="Supprimer" onClick={() => onDelete(s)}>
                        <Icon name="trash" size={16} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty icon="cart">{sales.length ? 'Aucun résultat.' : 'Aucune vente enregistrée.'}</Empty>
      )}
    </>
  );
}

export const SalesChips = ({ stats }) => (
  <div className="chips">
    <div className="chip glass"><span>Ventes</span><b>{stats.sales_count}</b></div>
    <div className="chip glass"><span>Unités vendues</span><b>{int(stats.sold_units)}</b></div>
    <div className="chip glass"><span>Chiffre d’affaires</span><b><AnimatedNumber value={stats.revenue_dt} format={dt} /></b></div>
    <div className="chip glass"><span>Bénéfice</span><b className="pos"><AnimatedNumber value={stats.profit_dt} format={dt} /></b></div>
  </div>
);

const sum = (list, key) => list.reduce((t, s) => t + s[key], 0);

// buyer: admin only — null = sales to other clients, a reseller id = sales to that reseller; undefined = reseller (all his sales).
export default function Sales({ articles, sales, stats, run, base = '/sales', buyer, resellers }) {
  const [deleting, setDeleting] = useState(null);
  const [editing, setEditing] = useState(null);
  const [doc, setDoc] = useState(null); // { sale, kind }, printed once rendered
  useEffect(() => { if (doc) window.print(); }, [doc]);
  const admin = buyer !== undefined;
  const list = buyer === undefined ? sales : sales.filter((s) => s.reseller_id === buyer);
  const name = resellers?.find((u) => u.id === buyer)?.name;
  const totals = buyer === undefined ? stats
    : { sales_count: list.length, sold_units: sum(list, 'qty'), revenue_dt: sum(list, 'total_dt'), profit_dt: sum(list, 'profit_dt') };
  return (
    <div className="page">
      <SalesChips stats={totals} />
      <div className="row-1-2">
        <GlassCard>
          <h3 className="card-title"><Icon name="plus" /> Nouvelle vente</h3>
          <SaleForm key={String(buyer)} articles={articles} resellers={resellers} buyerDefault={buyer}
            onSubmit={(body) => run(() => api.post(base, body), 'Vente enregistrée')} />
        </GlassCard>
        <GlassCard delay={0.08}>
          <SalesTable sales={list} onDelete={setDeleting} onEdit={admin ? setEditing : undefined} onPrint={setDoc}title={buyer === null ? 'Ventes externes' : name && `Ventes à ${name}`} />
        </GlassCard>
      </div>
      <Modal open={!!editing} title="Modifier la vente" onClose={() => setEditing(null)}>
        {editing && (
          <EditSaleForm sale={editing} resellers={resellers} onCancel={() => setEditing(null)}
            max={editing.qty + (articles.find((x) => x.id === editing.article_id)?.stock ?? 0)}
            onSubmit={async (body) => { if (await run(() => api.put(`${base}/${editing.id}`, body), 'Vente modifiée')) setEditing(null); }} />
        )}
      </Modal>
      {doc && <SaleDoc {...doc} />}
      <ConfirmModal
        message={deleting && `Supprimer la vente de ${deleting.qty} × « ${deleting.article_name} » ? La quantité sera remise en stock.`}
        onConfirm={() => run(() => api.del(`${base}/${deleting.id}`), 'Vente supprimée, stock rétabli')}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
