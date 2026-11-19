import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { setAuthLostHandler } from "./lib/api";
import { useAuth } from "./store/auth";
import "./styles.css";

// If the refresh token is rejected anywhere, drop back to the sign-in screen.
setAuthLostHandler(() => useAuth.setState({ user: null }));

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
