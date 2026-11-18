import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { loadDataInUse } from "./gameData/dataInUse.ts";
import { loadHiddenItems } from "./settings/hiddenItems.ts";
import "./styles/index.css";

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");
// The entity and signal data comes first: built in, or read from the user's game. Nothing reads a circuit before it is applied,
// and nothing is offered before it is known what the user hid.
void Promise.all([loadDataInUse(window.face), loadHiddenItems(window.face)]).then(([data, hidden]) =>
  createRoot(container).render(
    <StrictMode>
      <App data={data} hidden={hidden} />
    </StrictMode>,
  ),
);
