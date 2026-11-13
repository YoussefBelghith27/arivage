import { useEffect, useState } from 'react';
import { api } from './api';
import { GlassCard, Modal } from './ui';
import { PurchaseChips, PurchasesTable } from './Purchases';
import { SalesChips, SalesTable } from './Sales';

// "Ventes d’Aziz", "Ventes de Sami": French elision before a vowel or h.
const of = (name) => `${/^[aeiouyhàâéèêîïôûü]/i.test(name) ? 'd’' : 'de '}${name}`;

// Admin follow-up of one reseller, read-only: what he bought (from Youssef and elsewhere) and what he sold.
export default function AzizView({ reseller, fail }) {
  const [follow, setFollow] = useState(null);
  useEffect(() => { api.get(`/resellers/${reseller.id}/follow`).then(setFollow, fail); }, [reseller.id, fail]);
  if (!follow) return <div className="loading"><span className="loader" />Chargement…</div>;
  return (
    <div className="page">
      <PurchaseChips stats={follow.stats} />
      <SalesChips stats={follow.stats} />
      <GlassCard delay={0.1}>
        <PurchasesTable purchases={follow.purchases} />
      </GlassCard>
      <GlassCard delay={0.16}>
        <SalesTable sales={follow.sales} title={`Ventes ${of(reseller.name.split(' ')[0])}`} />
      </GlassCard>
    </div>
  );
}

// The admin creates a reseller account; it can sign in at once and sees only its own data.
export function AddReseller({ open, run, onClose }) {
  const [form, setForm] = useState({ name: '', username: '', password: '' });
  useEffect(() => { if (open) setForm({ name: '', username: '', password: '' }); }, [open]);
  const field = (key) => ({ value: form[key], onChange: (e) => setForm({ ...form, [key]: e.target.value }) });

  const submit = async (e) => {
    e.preventDefault();
    const ok = await run(() => api.post('/resellers', { ...form, name: form.name.trim() }), `Revendeur ${form.name.trim()} créé`);
    if (ok) onClose();
  };

  return (
    <Modal open={open} title="Ajouter un revendeur" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <p className="hint">Le revendeur pourra se connecter tout de suite avec cet identifiant et ce mot de passe. Il ne voit que ses propres articles, achats et ventes.</p>
        <label>Nom
          <input type="text" required maxLength={60} autoFocus {...field('name')} />
        </label>
        <div className="grid-2">
          <label>Identifiant
            <input type="text" required minLength={3} maxLength={30} pattern={'[a-z0-9._\\-]{3,30}'} autoComplete="off"
              title="3 à 30 caractères : minuscules, chiffres, point, tiret ou tiret bas" {...field('username')} />
          </label>
          <label>Mot de passe <span className="opt">(10 caractères min.)</span>
            <input type="password" required minLength={10} maxLength={200} autoComplete="new-password" {...field('password')} />
          </label>
        </div>
        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn primary">Créer le revendeur</button>
        </div>
      </form>
    </Modal>
  );
}
