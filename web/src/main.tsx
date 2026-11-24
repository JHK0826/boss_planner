import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { moveToCanonical } from "./lib/canonical";
import { ThemeProvider, ToastProvider } from "./ui/common";
import "./styles.css";

function render() {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <BrowserRouter>
        <ThemeProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </ThemeProvider>
      </BrowserRouter>
    </StrictMode>,
  );
}

// 예전 주소로 열었으면 새 주소로 옮기고, 아니면 화면을 그린다.
moveToCanonical().then(
  (moved) => !moved && render(),
  () => render(),
);
