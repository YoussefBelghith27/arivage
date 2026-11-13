import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { Background, Empty, Icon, Toast } from './ui';
import Overview from './Overview';
import Stock from './Stock';
import ResellerStock from './ResellerStock';
import Sales from './Sales';
import Settings from './Settings';
import Purchases from './Purchases';
import AzizView, { AddReseller } from './AzizView';

// What each role loads and sees. The server enforces the same split.
const ROLES = {
  admin: {
    title: 'Fournisseur',
    load: { articles: '/articles', sales: '/sales', stats: '/stats', settings: '/settings', resellers: '/resellers' },
    tabs: [['overview', 'Vue d’ensemble', 'chart'], ['stock', 'Stock', 'box'], ['external', 'Ventes externes', 'wallet'], ['sales', 'Ventes revendeurs', 'cart'], ['follow', 'Suivi revendeurs', 'trend']],
  },
  reseller: {
    title: 'Revendeur',
    load: { articles: '/reseller/items', sales: '/reseller/sales', stats: '/reseller/stats', purchases: '/reseller/purchases', rate: '/reseller/rate' },
    tabs: [['overview', 'Vue d’ensemble', 'chart'], ['stock', 'Mon stock', 'box'], ['purchases', 'Mes achats', 'wallet'], ['sales', 'Mes ventes', 'cart']],
  },
};
const TODAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());

export default function App({ user, onLogout }) {
  const role = ROLES[user.role];
  const isAdmin = user.role === 'admin';
  const [tab, setTab] = useState('overview');
  const [data, setData] = useState(null);
  const [toast, setToast] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [adding, setAdding] = useState(false);
  const [pick, setPick] = useState(null); // admin: reseller shown on "Ventes revendeurs" and "Suivi revendeurs"

  const notify = useCallback((msg, type = 'ok') => setToast({ msg, type, id: Date.now() }), []);
  const clearToast = useCallback(() => setToast(null), []);
  const fail = useCallback((e) => (e.status === 401 ? onLogout() : notify(e.message, 'err')), [onLogout, notify]);

  const refresh = useCallback(async () => {
    try {
      const entries = Object.entries(role.load);
      const values = await Promise.all(entries.map(([, url]) => api.get(url)));
      setData(Object.fromEntries(entries.map(([key], i) => [key, values[i]])));
    } catch (e) {
      fail(e);
    }
  }, [role, fail]);

  useEffect(() => { refresh(); }, [refresh]);

  // Runs a mutation, reloads everything, and reports the outcome. Returns true on success.
  const run = useCallback(async (action, successMsg) => {
    try {
      await action();
      await refresh();
      if (successMsg) notify(successMsg);
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  }, [refresh, notify, fail]);

  const categories = useMemo(
    () => [...new Set((data?.articles ?? []).map((a) => a.category).filter(Boolean))].sort(),
    [data],
  );

  const resellers = data?.resellers;
  const current = resellers?.find((u) => u.id === pick) ?? resellers?.[0];
  const perReseller = isAdmin && (tab === 'sales' || tab === 'follow');

  const go = (key) => {
    setTab(key);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <>
      <Background />
      <div className="layout">
        <aside className="sidebar glass rise">
          <div className="brand">
            <span className="brand-mark"><Icon name="drop" size={20} /></span>
            <div>
              <strong>Arivage</strong>
              <small>{role.title}</small>
            </div>
          </div>
          <nav className="nav" aria-label="Sections">
            {role.tabs.map(([key, label, icon]) => (
              <button key={key} type="button" className={`nav-item ${tab === key ? 'active' : ''}`}
                onClick={() => go(key)} aria-current={tab === key ? 'page' : undefined}>
                {tab === key && <span className="nav-pill" />}
                <Icon name={icon} size={18} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
          {isAdmin && (
            <button type="button" className="btn ghost add-reseller" onClick={() => setAdding(true)} aria-label="Ajouter un revendeur" title="Ajouter un revendeur">
              <Icon name="plus" size={16} /> <span>Ajouter un revendeur</span>
            </button>
          )}
          <div className="side-bottom">
            {isAdmin && data && (
              <button type="button" className="rates-card" onClick={() => setShowSettings(true)} title="Modifier les taux">
                <span className="rates-title"><Icon name="sliders" size={16} /> Taux du dinar</span>
                <span>Achat <b>1 € = {data.settings.rate_buy} DT</b></span>
                <span>Vente <b>1 € = {data.settings.rate_sell} DT</b></span>
              </button>
            )}
            <div className="user-card">
              <span className="avatar">{user.name.split(' ').map((w) => w[0]).join('')}</span>
              <div>
                <b>{user.name}</b>
                <small>{role.title}</small>
              </div>
              <button type="button" className="icon-btn" onClick={onLogout} aria-label="Se déconnecter" title="Se déconnecter">
                <Icon name="logout" size={16} />
              </button>
            </div>
          </div>
        </aside>

        <div className="main">
          <header className="pagehead">
            <div>
              <h1>{role.tabs.find(([key]) => key === tab)[1]}</h1>
              <p>{TODAY}</p>
            </div>
            {tab !== 'sales' && tab !== 'external' && (
              <button type="button" className="btn primary" onClick={() => go('sales')}>
                <Icon name="cart" size={16} /> Nouvelle vente
              </button>
            )}
          </header>

          <main>
            {!data ? (
              <div className="loading"><span className="loader" />Chargement…</div>
            ) : (
              <div key={tab} className="rise">
                {perReseller && (resellers.length ? (
                  <label className="reseller-pick">Revendeur
                    <select className="select-sm" value={current.id} onChange={(e) => setPick(Number(e.target.value))}>
                      {resellers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </label>
                ) : (
                  <Empty icon="trend">Aucun revendeur pour l’instant.<br />Créez-en un avec « Ajouter un revendeur ».</Empty>
                ))}
                {tab === 'overview' && <Overview {...data} reseller={!isAdmin} />}
                {tab === 'stock' && (isAdmin
                  ? <Stock {...data} categories={categories} run={run} />
                  : <ResellerStock {...data} categories={categories} run={run} />)}
                {(tab === 'sales' || tab === 'external') && (!perReseller || current) && (
                  <Sales {...data} run={run} base={role.load.sales} buyer={isAdmin ? (tab === 'external' ? null : current.id) : undefined} />
                )}
                {tab === 'purchases' && <Purchases {...data} run={run} />}
                {tab === 'follow' && current && <AzizView key={current.id} reseller={current} fail={fail} />}
              </div>
            )}
          </main>
        </div>
      </div>

      {isAdmin && data && <Settings open={showSettings} settings={data.settings} run={run} onClose={() => setShowSettings(false)} />}
      {isAdmin && <AddReseller open={adding} run={run} onClose={() => setAdding(false)} />}
      <Toast toast={toast} onDone={clearToast} />
    </>
  );
}
