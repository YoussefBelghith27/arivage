import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './api';
import { Background } from './ui';
import App from './App';
import Login from './Login';
import './styles.css';

function Root() {
  const [user, setUser] = useState(undefined); // undefined = checking the session
  useEffect(() => {
    api.get('/me').then(setUser, () => setUser(null));
  }, []);
  const logout = async () => {
    await api.post('/logout').catch(() => {});
    setUser(null);
  };
  if (user === undefined) return <Background />;
  return user ? <App key={user.id} user={user} onLogout={logout} /> : <><Background /><Login onLogin={setUser} /></>;
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
