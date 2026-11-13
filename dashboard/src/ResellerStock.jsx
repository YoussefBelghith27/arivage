import { useMemo, useState } from 'react';
import { api } from './api';
import { SellModal } from './Sales';
import { PriceCell } from './Stock';
import { AnimatedNumber, Empty, GlassCard, Icon, Search, dt, eur, int } from './ui';

// The reseller's stock: units bought from the supplier (his cost = supplier's sale price); he sets his own sale price.
export default function ResellerStock({ articles, stats, categories, run }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [selling, setSelling] = useState(null);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return articles.filter((a) => (!cat || a.category === cat) && a.name.toLowerCase().includes(s));
  }, [articles, q, cat]);

  const setPrice = (a, value) => run(
    () => api.put(`/reseller/items/${a.id}/price`, { sell_price_dt: value }),
    value === null ? 'Prix de vente effacé' : 'Prix de vente enregistré',
  );

  return (
    <div className="page">
      <div className="chips">
        <div className="chip glass"><span>Unités en stock</span><b>{int(stats.stock_units)}</b></div>
        <div className="chip glass"><span>Coût d’achat</span><b><AnimatedNumber value={stats.stock_cost_dt} format={dt} /></b></div>
        <div className="chip glass"><span>Valeur de vente</span><b className="pos"><AnimatedNumber value={stats.stock_value_dt} format={dt} /></b></div>
        <div className="chip glass"><span>Prix à définir</span><b className={stats.unpriced_count ? 'warn' : ''}>{stats.unpriced_count}</b></div>
      </div>

      <GlassCard>
        <div className="card-head">
          <h3 className="card-title"><Icon name="box" /> Mon inventaire</h3>
          <div className="toolbar">
            <Search value={q} onChange={setQ} label="Rechercher un article" />
            <select className="select-sm" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Filtrer par catégorie">
              <option value="">Toutes catégories</option>
              {categories.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <p className="hint">Cliquez sur un prix de vente pour le saisir. Votre prix d’achat est le prix de vente de votre fournisseur.</p>

        {articles.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Article</th><th className="r">Achat DT</th><th className="r">Vente DT</th>
                  <th className="r">Marge</th><th className="c">Stock</th><th className="r">Vendus</th><th />
                </tr>
              </thead>
              <tbody>
                {shown.map((a, i) => (
                  <tr key={a.id} className={`rise ${a.stock === 0 ? 'out' : ''}`} style={{ animationDelay: `${Math.min(i, 12) * 0.02}s` }}>
                    <td>
                      <div className="cell-name">{a.name}</div>
                      {a.category && <div className="cell-sub"><span className="tag">{a.category}</span></div>}
                    </td>
                    <td className="r nowrap">
                      {dt(a.buy_dt)}
                      {a.eur_rate && <div className="cell-sub">{eur(a.price_eur)} × {a.eur_rate}</div>}
                    </td>
                    <td className="r nowrap">
                      <PriceCell value={a.sell_dt} fixed={a.sell_dt} tag={false} label={`Prix de vente de ${a.name}`}
                        onSave={(v) => setPrice(a, v)} />
                    </td>
                    <td className={`r nowrap ${a.margin_dt == null ? 'muted' : a.margin_dt >= 0 ? 'pos' : 'neg'}`}>
                      {a.margin_dt == null ? '—' : dt(a.margin_dt)}
                    </td>
                    <td className="c">
                      <span className={`badge ${a.stock === 0 ? 'neg' : a.stock <= 1 ? 'warn' : 'pos'}`}>{a.stock}</span>
                    </td>
                    <td className="r">{a.sold}</td>
                    <td className="r nowrap">
                      <button type="button" className="icon-btn sell" disabled={a.stock === 0} aria-label={`Vendre ${a.name}`}
                        title="Vendre" onClick={() => setSelling(a)}><Icon name="cart" size={16} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon="box">Aucun article pour l’instant.<br />Vos achats auprès du fournisseur apparaîtront ici.</Empty>
        )}
      </GlassCard>

      <SellModal articles={articles} article={selling} url="/reseller/sales" run={run} onClose={() => setSelling(null)} />
    </div>
  );
}
