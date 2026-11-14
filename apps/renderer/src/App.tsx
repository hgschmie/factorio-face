// Composition root of the renderer: the project session provides state and commands, the catalog provides names and icons,
// the application settings say which installation of the game the icons come from, and the workbench renders all of it.
// Nothing below this component knows where its props come from.
import { useCallback, useMemo } from "react";
import { useCatalogEntityIcons } from "./icons/catalogEntityIcons.ts";
import { useCatalogIcons } from "./icons/catalogSignalIcons.ts";
import type { SignalDescriber, SignalPickerRenderer } from "./inspector/SignalField.tsx";
import { SignalPicker } from "./picker/SignalPicker.tsx";
import { useAppSettings } from "./settings/useAppSettings.ts";
import { useProjectSession } from "./session/useProjectSession.ts";
import type { WireIconResolver } from "./workbench/CanvasStrip.tsx";
import { Workbench } from "./workbench/Workbench.tsx";

const STATUS_WARNINGS = { known: undefined, unknown: "Not a signal of Factorio's catalog", disabled: "Belongs to a signal group that is switched off" } as const;

export function App() {
  const api = window.face;
  const controller = useProjectSession(api);
  const appSettings = useAppSettings(api);
  // Another installation of the game: the same icon ids have other images, which a new revision in the URLs makes the views fetch.
  const iconRevision = appSettings?.state?.iconRevision ?? 0;
  const resolveEntityIcon = useCatalogEntityIcons(api?.catalogAssetUrl, iconRevision);
  const { iconUrl, status: iconStatus } = useCatalogIcons(api?.catalogAssetUrl, iconRevision);
  // The game's wire items carry the icons of its wire tools.
  const resolveWireIcon = useCallback<WireIconResolver>((color) => iconUrl(`item/${color}-wire`), [iconUrl]);
  const catalog = controller.state.catalog;

  const describeSignal = useMemo<SignalDescriber>(() => {
    return (signal) => {
      const info = catalog.describe(signal);
      return { displayName: info.displayName, iconUrl: info.icon === undefined ? undefined : iconUrl(info.icon), warning: STATUS_WARNINGS[info.status] };
    };
  }, [catalog, iconUrl]);

  const renderSignalPicker = useCallback<SignalPickerRenderer>(
    (props) => <SignalPicker groups={catalog.picker()} qualities={catalog.qualities} value={props.value} wildcards={props.wildcards} iconUrl={iconUrl} onSelect={props.onSelect} close={props.close} />,
    [catalog, iconUrl],
  );

  return (
    <Workbench
      controller={controller}
      api={api}
      appSettings={appSettings}
      iconsMissing={iconStatus === "missing"}
      resolveEntityIcon={resolveEntityIcon}
      resolveWireIcon={resolveWireIcon}
      renderSignalPicker={renderSignalPicker}
      describeSignal={describeSignal}
    />
  );
}
