import axios from "axios";
import router from "@/router";

const api = axios.create({
  baseURL: import.meta.env.VITE_APP_BASE_URL_API || "http://localhost:8000",
});

api.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    console.dir(error);
    throw new Error(httpErrorHandler(error));
  }
);

const setAuthorizationToken = (newToken: string) => {
  api.defaults.headers.common["authorization"] = `Bearer ${newToken}`;
};

const httpErrorHandler = function (error: any): string {
  if (error.response) {
    if (error.response.status === 400) {
      return (
        error.response.data.message ||
        "Erro de requisição. Verifique os dados enviados"
      );
    } else if (error.response.status === 401) {
      router.push("/login");
      return error.response.data.message || "Faça login";
    } else if (error.response.status === 403) {
      return (
        error.response.data.message || "Você não possui permissão para isso"
      );
    } else if (error.response.status === 404) {
      return "Rota não encontrada";
    } else if (error.response.status === 408) {
      return "Tempo limite da requisição excedido";
    } else if (error.response.status === 409) {
      return error.response.data.message || "Verifique os conflitos";
    } else if (error.response.status === 500) {
      return "Erro no servidor. Já estamos trabalhando nisso";
    } else {
      return "Erro interno. Já estamos trabalhando nisso";
    }
  } else if (error.request) {
    return "Nenhuma resposta recebida";
  } else {
    if (error.code === "ECONNABORTED") {
      return "Tempo limite da requisição excedido";
    } else if (error.message === "Network Error") {
      return "Problema de conexão com a rede. Verifique sua internet";
    } else {
      return "Erro interno. Já estamos trabalhando nisso";
    }
  }
};

export { api, setAuthorizationToken };
