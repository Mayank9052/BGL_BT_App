import { Navigate, Outlet } from "react-router-dom";
import { useAuthStore } from "../store/authStore"


export default function AdminRoute() {
  const { user, loading } = useAuthStore();

  if (loading) return null;
  if (user?.role !== "Admin") return <Navigate to="/dashboard" replace />;

  return <Outlet />;
}