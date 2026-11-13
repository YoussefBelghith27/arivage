import { useEffect, useState } from 'react';
import { api } from './api';
import { Modal, dt } from './ui';

export default function Settings({ open, settings, run, onClose }) {
  const [buy, setBuy] = useState(String(settings.rate_buy));
  const [sell, setSell] = useState(String(settings.rate_sell));
  const [ship, setShip] = useState(String(settings.rate_shipping));

  useEffect(() => {
    if (open) {
      setBuy(String(settings.rate_buy));
      setSell(String(settings.rate_sell));
      setShip(String(settings.rate_shipping));
    }
  }, [open, settings]);

  const submit = async (e) => {
    e.preventDefault();
    const ok = await run(() => api.put('/settings', { rate_buy: Number(buy), rate_sell: Number(sell), rate_shipping: Number(ship) }), 'Taux mis à jour');
    if (ok) onClose();
  };

  return (
    <Modal open={open} title="Taux de conversion" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <p className="hint">Les prix d’achat et de vente en DT sont calculés à partir du prix en euro. Un prix de vente fixé à la main sur un article reste prioritaire.</p>
        <div className="grid-2">
          <label>1 € en DT (achat)
            <input type="number" step="0.001" min="0.001" max="100" required value={buy} onChange={(e) => setBuy(e.target.value)} />
          </label>
          <label>1 € en DT (vente)
            <input type="number" step="0.001" min="0.001" max="100" required value={sell} onChange={(e) => setSell(e.target.value)} />
          </label>
          <label>Livraison 1 € = (DT, facturée au revendeur)
            <input type="number" step="0.001" min="0.001" max="100" required value={ship} onChange={(e) => setShip(e.target.value)} />
          </label>
        </div>
        <div className="preview">
          <span>Exemple 10 €</span>
          <b>achat {dt(10 * (Number(buy) || 0))}</b>
          <b className="pos">vente {dt(10 * (Number(sell) || 0))}</b>
        </div>
        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn primary">Enregistrer</button>
        </div>
      </form>
    </Modal>
  );
}
