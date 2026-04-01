import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";

interface AuthContextValue {
  isAuthenticated: boolean;
  loading: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  isAuthenticated: false,
  loading: true,
  login: async () => ({ success: false }),
  logout: () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  const checkSession = useCallback(async () => {
    const token = localStorage.getItem("linker_token");
    if (!token) {
      setIsAuthenticated(false);
      setLoading(false);
      return;
    }
    try {
      const result = await invoke<{ valid: boolean }>("check_session", { token });
      setIsAuthenticated(!!result?.valid);
    } catch {
      setIsAuthenticated(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  const login = async (username: string, password: string) => {
    try {
      const result = await invoke<{ success: boolean; token?: string; error?: string }>(
        "login",
        { username, password }
      );
      if (result.success && result.token) {
        localStorage.setItem("linker_token", result.token);
        setIsAuthenticated(true);
        return { success: true };
      }
      return { success: false, error: result.error || "Error al iniciar sesion" };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  };

  const logout = () => {
    localStorage.removeItem("linker_token");
    setIsAuthenticated(false);
  };

  if (loading) {
    return null;
  }

  return (
    <AuthContext.Provider value={{ isAuthenticated, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
