import { AnimatedNumber, Empty, GlassCard, Icon, dt, eur, int } from './ui';

const BLUE = '#2f7de1';
const TEAL = '#14b8a6';
const SKY = '#93c5fd';
const short = (n) => new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

// Tiny responsive SVG chart. series: [{ key, name, color }]; area = lines+fill, else grouped bars.
// Labels are HTML so they are never stretched by the non-uniform svg scaling.
const W = 600, H = 240;
function Chart({ data, labelKey, series, area, label }) {
  const vals = data.flatMap((d) => series.map((s) => d[s.key] || 0));
  const min = Math.min(0, ...vals), max = Math.max(0, ...vals), range = max - min || 4; // all-zero: integer ticks 0..4
  const y = (v) => H - ((v - min) / range) * H;
  const n = data.length;
  const gw = W / n;
  const x = (i) => (n > 1 ? (i / (n - 1)) * W : W / 2);
  const step = Math.ceil(n / 6); // area: thin x labels so they never overlap
  const bw = Math.min(gw * 0.8, 60) / series.length;
  return (
    <div className="chart">
      <div className="chart-plot">
        <div className="chart-y">
          {[0, 1, 2, 3, 4].map((k) => <span key={k} style={{ top: `${(1 - k / 4) * 100}%` }}>{short(min + (range * k) / 4)}</span>)}
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={H} role="img" aria-label={label}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`g-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          {[0, 1, 2, 3, 4].map((k) => <line key={k} x1="0" x2={W} y1={(k / 4) * H} y2={(k / 4) * H} stroke="rgba(15,37,64,0.07)" vectorEffect="non-scaling-stroke" />)}
          {series.map((s, j) => {
            const pts = data.map((d, i) => `${x(i)},${y(d[s.key] || 0)}`);
            return (
              <g key={s.key}>
                {area ? (
                  <>
                    <polygon points={`${x(0)},${y(0)} ${pts.join(' ')} ${x(n - 1)},${y(0)}`} fill={`url(#g-${s.key})`} />
                    <polyline points={pts.join(' ')} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                  </>
                ) : null}
                {data.map((d, i) => {
                  const v = d[s.key] || 0, t = <title>{`${d[labelKey]} · ${s.name} : ${dt(v)}`}</title>;
                  return area
                    ? (n === 1 ? <circle key={i} cx={x(i)} cy={y(v)} r="5" fill={s.color}>{t}</circle> : null)
                    : <rect key={i} x={i * gw + gw / 2 + (j - series.length / 2) * bw} y={Math.min(y(v), y(0))} width={bw} height={Math.abs(y(0) - y(v))} fill={s.color}>{t}</rect>;
                })}
              </g>
            );
          })}
          {area && data.map((d, i) => (
            <rect key={i} x={x(i) - W / n / 2} y="0" width={W / n} height={H} fill="transparent">
              <title>{`${d[labelKey]} · ${series.map((s) => `${s.name} : ${dt(d[s.key] || 0)}`).join(' · ')}`}</title>
            </rect>
          ))}
        </svg>
      </div>
      <div className={`chart-x ${area ? 'edge' : ''}`}>{data.map((d, i) => (!area || i === n - 1 || (i % step === 0 && n - 1 - i >= step)) && <span key={i}>{d[labelKey]}</span>)}</div>
      <div className="chart-legend">{series.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.name}</span>)}</div>
    </div>
  );
}

// Animated ring showing a percentage (0–100).
function Ring({ pct }) {
  const r = 52;
  return (
    <div className="ring">
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r={r} className="ring-track" />
        <circle cx="60" cy="60" r={r} className="ring-bar" transform="rotate(-90 60 60)" pathLength="100"
          style={{ strokeDashoffset: 100 - Math.min(pct, 100) }} />
      </svg>
      <div className="ring-label">
        <b><AnimatedNumber value={pct} format={(v) => `${v.toFixed(0)}%`} /></b>
        <small>marge</small>
      </div>
    </div>
  );
}

// reseller: his stock has no € price; margin counts only the articles he has priced.
export default function Overview({ stats, settings, reseller }) {
  const marginBase = reseller ? stats.priced_cost_dt : stats.stock_cost_dt;
  const marginPct = marginBase ? (stats.potential_profit_dt / marginBase) * 100 : 0;
  const kpis = [
    { label: 'Valeur d’achat', value: stats.stock_cost_dt, icon: 'wallet', sub: reseller ? 'Stock au prix payé' : `Stock à 1 € = ${settings.rate_buy} DT` },
    { label: 'Valeur de vente', value: stats.stock_value_dt, icon: 'drop',
      sub: reseller ? `${stats.unpriced_count} article(s) sans prix` : `Stock à 1 € = ${settings.rate_sell} DT` },
    { label: 'Chiffre d’affaires', value: stats.revenue_dt, icon: 'cart', sub: `${stats.sales_count} vente(s) · ${int(stats.sold_units)} unité(s)` },
    { label: 'Bénéfice réalisé', value: stats.profit_dt, icon: 'trend', sub: 'Ventes − coût d’achat', accent: true },
  ];

  return (
    <div className="page">
      <div className="kpi-grid">
        {kpis.map((k, i) => (
          <GlassCard key={k.label} className={`kpi ${k.accent ? 'accent' : ''}`} delay={i * 0.07}>
            <span className="kpi-icon"><Icon name={k.icon} /></span>
            <div className="kpi-value"><AnimatedNumber value={k.value} format={dt} /></div>
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-sub">{k.sub}</div>
          </GlassCard>
        ))}
      </div>

      <div className="row-2-1">
        <GlassCard delay={0.3}>
          <h3 className="card-title">Évolution des ventes</h3>
          <p className="card-sub">Chiffre d’affaires et bénéfice par jour</p>
          {stats.by_day.length ? (
            <Chart data={stats.by_day} labelKey="day" area label="Courbe du chiffre d’affaires et du bénéfice par jour"
              series={[{ key: 'revenue', name: 'Chiffre d’affaires', color: BLUE }, { key: 'profit', name: 'Bénéfice', color: TEAL }]} />
          ) : (
            <Empty icon="cart">Aucune vente pour l’instant.<br />Enregistrez une vente dans <b>Ventes</b>.</Empty>
          )}
        </GlassCard>

        <GlassCard delay={0.36} className="ring-card">
          <h3 className="card-title">Marge du stock</h3>
          <p className="card-sub">Bénéfice si tout le stock est vendu</p>
          <Ring pct={marginPct} />
          <div className="mini-stats">
            {reseller
              ? <div><b>{stats.unpriced_count}</b><small>Sans prix</small></div>
              : <div><b>{eur(stats.stock_eur)}</b><small>Stock en €</small></div>}
            <div><b>{int(stats.stock_units)}</b><small>Unités</small></div>
            <div><b>{stats.article_count}</b><small>Articles</small></div>
          </div>
          <div className="potential">
            <span>Bénéfice potentiel</span>
            <b><AnimatedNumber value={stats.potential_profit_dt} format={dt} /></b>
          </div>
        </GlassCard>
      </div>

      <div className="row-2-1">
        <GlassCard delay={0.42}>
          <h3 className="card-title">Stock par catégorie</h3>
          <p className="card-sub">Coût d’achat et valeur de vente en DT</p>
          <Chart data={stats.by_category} labelKey="category" label="Histogramme du coût d’achat et de la valeur de vente par catégorie"
            series={[{ key: 'cost', name: 'Achat', color: SKY }, { key: 'value', name: 'Vente', color: BLUE }]} />
        </GlassCard>

        <GlassCard delay={0.48} className="lists">
          <h3 className="card-title"><Icon name="alert" /> Stock bas</h3>
          {stats.low_stock.length ? (
            <ul className="mini-list">
              {stats.low_stock.slice(0, 6).map((a, i) => (
                <li key={a.id} className="rise" style={{ animationDelay: `${0.5 + i * 0.06}s` }}>
                  <span className="truncate">{a.name}</span>
                  <span className={`badge ${a.stock === 0 ? 'neg' : 'warn'}`}>{a.stock}</span>
                </li>
              ))}
              {stats.low_stock.length > 6 && <li className="muted">+ {stats.low_stock.length - 6} autres</li>}
            </ul>
          ) : <p className="muted">Tout est bien approvisionné.</p>}

          <h3 className="card-title"><Icon name="trend" /> Meilleures ventes</h3>
          {stats.top.length ? (
            <ul className="mini-list">
              {stats.top.map((a) => (
                <li key={a.id}><span className="truncate">{a.name}</span><span className="badge pos">{a.sold} vendus</span></li>
              ))}
            </ul>
          ) : <p className="muted">Pas encore de ventes.</p>}
        </GlassCard>
      </div>
    </div>
  );
}
