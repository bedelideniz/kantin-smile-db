import { useAuth } from "@/hooks/useAuth";
import { Navigate } from "react-router-dom";

export default function Index() {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex min-h-screen items-center justify-center">Yükleniyor…</div>;
  return <Navigate to={user ? "/admin" : "/login"} replace />;
}
