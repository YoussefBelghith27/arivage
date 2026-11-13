import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { Icon } from './ui';

// Shows Google's own "Se connecter avec Google" button when the server has a Client ID.
function GoogleButton({ onLogin, onError }) {
  const box = useRef(null);
  const [clientId, setClientId] = useState(null);

  useEffect(() => {
    api.get('/config').then((c) => setClientId(c.googleClientId), () => {});
  }, []);

  useEffect(() => {
    if (!clientId) return;
    const render = () => {
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: ({ credential }) => api.post('/login/google', { credential }).then(onLogin, (e) => onError(e.message)),
      });
      window.google.accounts.id.renderButton(box.current, { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', locale: 'fr', width: 300 });
    };
    if (window.google?.accounts) return render();
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = render;
    script.onerror = () => onError('Google est injoignable');
    document.head.appendChild(script);
  }, [clientId, onLogin, onError]);

  if (!clientId) return null;
  return (
    <>
      <div className="login-or"><span>ou</span></div>
      <div className="google-btn" ref={box} />
    </>
  );
}

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onLogin(await api.post('/login', { username, password }));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="glass login rise" onSubmit={submit}>
        <span className="brand-mark"><Icon name="drop" size={22} /></span>
        <h1>Arivage</h1>
        <p className="muted">Stock &amp; Ventes · connexion</p>
        <label>Identifiant
          <input type="text" autoComplete="username" required maxLength={40} value={username}
            onChange={(e) => setUsername(e.target.value)} autoFocus />
        </label>
        <label>Mot de passe
          <span className="pw-field">
            <input type={showPassword ? 'text' : 'password'} autoComplete="current-password" required maxLength={200}
              value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" className="pw-eye" onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'} aria-pressed={showPassword}>
              <Icon name={showPassword ? 'eyeOff' : 'eye'} size={18} />
            </button>
          </span>
        </label>
        {error && <p className="login-error" role="alert">{error}</p>}
        <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Connexion…' : 'Se connecter'}</button>
        <GoogleButton onLogin={onLogin} onError={setError} />
      </form>
    </div>
  );
}
