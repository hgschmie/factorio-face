// Composition root of the renderer: the project session provides state and commands, the catalog provides names and icons,
// the application settings say which installation of the game the icons come from and which data the editor works with, and
// the workbench renders all of it. Nothing below this component knows where its props come from.
import { useCallback, useMemo } from "react";
import type { HiddenModuleItems } from "../../desktop/src/ipc.ts";
import type { DataInUse } from "./gameData/dataInUse.ts";
import { useGameData } from "./gameData/useGameData.ts";
import { useCatalogEntityIcons } from "./icons/catalogEntityIcons.ts";
import { useCatalogIcons } from "./icons/catalogSignalIcons.ts";
import type { SignalDescriber, SignalPickerRenderer } from "./inspector/SignalField.tsx";
import { signalWarning } from "./inspector/signalWarning.ts";
import { SignalPicker } from "./picker/SignalPicker.tsx";
import { useAppSettings } from "./settings/useAppSettings.ts";
import { useProjectSession } from "./session/useProjectSession.ts";
import type { WireIconResolver } from "./workbench/CanvasStrip.tsx";
import { Workbench } from "./workbench/Workbench.tsx";

export interface AppProps {
  /** The game data the window works with, applied before anything was rendered. */
  readonly data: DataInUse;
  /** What the user hid of the modules on this machine, as it is when the window starts. */
  readonly hidden: readonly HiddenModuleItems[];
}

export function App({ data, hidden }: AppProps) {
  const api = window.face;
  const controller = useProjectSession(api, data, hidden);
  const appSettings = useAppSettings(api);
  // The installation decides whether the game can be read; its state is asked for again when it changes.
  const gameData = useGameData(api, controller.commands.reloadWindow, appSettings?.state);
  // Another installation of the game: the same icon ids have other images, which a new revision in the URLs makes the views fetch.
  const iconRevision = appSettings?.state?.iconRevision ?? 0;
  // Which icons there are is part of the data: no view asks for one the main process has no entry for in its icon table.
  const resolveEntityIcon = useCatalogEntityIcons(api?.catalogAssetUrl, iconRevision, data.icons);
  const { iconUrl, status: iconStatus } = useCatalogIcons(api?.catalogAssetUrl, iconRevision, data.icons);
  // The game's wire items carry the icons of its wire tools.
  const resolveWireIcon = useCallback<WireIconResolver>((color) => iconUrl(`item/${color}-wire`), [iconUrl]);
  const catalog = controller.state.catalog;

  const describeSignal = useMemo<SignalDescriber>(() => {
    return (signal) => {
      const info = catalog.describe(signal);
      return { displayName: info.displayName, iconUrl: info.icon === undefined ? undefined : iconUrl(info.icon), warning: signalWarning(info) };
    };
  }, [catalog, iconUrl]);

  const renderSignalPicker = useCallback<SignalPickerRenderer>(
    ({ value, wildcards, onSelect, close }) => (
      <SignalPicker groups={catalog.picker()} notOffered={catalog.notOffered()} qualities={catalog.qualities} value={value} wildcards={wildcards} iconUrl={iconUrl} onSelect={onSelect} close={close} />
    ),
    [catalog, iconUrl],
  );

  return (
    <Workbench
      controller={controller}
      api={api}
      appSettings={appSettings}
      gameData={gameData}
      dataProblem={data.problem}
      iconsMissing={iconStatus === "missing"}
      resolveEntityIcon={resolveEntityIcon}
      resolveWireIcon={resolveWireIcon}
      resolveCatalogIcon={iconUrl}
      renderSignalPicker={renderSignalPicker}
      describeSignal={describeSignal}
    />
  );
}
