import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import AppLayout from "./layouts/AppLayout";

import Dashboard from "./pages/Dashboard";
import Conferencia from "./pages/Conferencia";
import Comunicacao from "./pages/Comunicacao";
import Auditoria from "./pages/Auditoria";
import Estatisticas from "./pages/Estatisticas";
import Log from "./pages/Log";
import Configuracoes from "./pages/Configuracoes";
import Sobre from "./pages/Sobre";
import Periodos from "./pages/Periodos";
import Login from "./pages/Login";
import { AuthProvider, useAuth } from "./contexts/AuthContext";

function Rotas() {
  const { usuario, carregando } = useAuth();
  if (carregando) return <div className="auth-boot">Carregando sessão...</div>;
  return <Routes>
        <Route path="/login" element={<Login />} />
        {usuario ? <>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/conferencia" element={<Conferencia />} />
          <Route path="/comunicacao" element={<Comunicacao />} />
          <Route path="/auditoria" element={<Auditoria />} />
          <Route path="/estatisticas" element={<Estatisticas />} />
          <Route path="/log" element={<Log />} />
          <Route path="/configuracoes" element={<Configuracoes />} />
          <Route path="/periodos" element={<Periodos />} />
          <Route path="/sobre" element={<Sobre />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
        </> : <Route path="*" element={<Navigate to="/login" replace />} />}
      </Routes>
}

function App() { return <BrowserRouter><AuthProvider><Rotas /></AuthProvider></BrowserRouter>;
}

export default App;
