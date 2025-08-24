import React from 'react';
import { useAuthState } from 'react-firebase-hooks/auth';
import { auth } from './firebaseConfig';
import LoginPage from './LoginPage';
import AdminPanel from './AdminPanel';
import './App.css';

function App() {
  const [user, loading] = useAuthState(auth);

  if (loading) {
    return <div className="container"><h1>Loading...</h1></div>;
  }

  return (
    <div className="App">
      {user ? <AdminPanel /> : <LoginPage />}
    </div>
  );
}

export default App;
