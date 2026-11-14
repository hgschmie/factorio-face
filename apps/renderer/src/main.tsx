import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { loadDataInUse } from "./gameData/dataInUse.ts";
import "./styles/index.css";

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");
// The entity and signal data comes first: built in, or read from the user's game. Nothing reads a circuit before it is applied.
void loadDataInUse(window.face).then((data) =>
  createRoot(container).render(
    <StrictMode>
      <App data={data} />
    </StrictMode>,
  ),
);
