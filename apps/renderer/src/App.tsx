// Composition root of the renderer. Until the language session exists, the workbench runs on the in-memory demo
// controller; replacing `useDemoSession` with the real session is the only change needed here.
import { useCatalogEntityIcons } from "./icons/catalogEntityIcons.ts";
import { useDemoSession } from "./workbench/demoSession.ts";
import { Workbench } from "./workbench/Workbench.tsx";

export function App() {
  const api = window.face;
  const controller = useDemoSession(api);
  const resolveEntityIcon = useCatalogEntityIcons(api?.catalogAssetUrl);
  return <Workbench controller={controller} api={api} resolveEntityIcon={resolveEntityIcon} />;
}
