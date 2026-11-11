// Renderer containment: no navigation, no new windows, no webviews, no permissions, no remote requests.
import { app, type Session } from "electron";

export function hardenWebContents(): void {
  app.on("web-contents-created", (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", (event) => event.preventDefault());
    contents.on("will-redirect", (event) => event.preventDefault());
    contents.on("will-attach-webview", (event) => event.preventDefault());
  });
}

export function hardenSession(session: Session): void {
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  // The CSP already forbids remote and local-file content; cancelling at the network layer also covers anything the
  // page policy does not see. The app itself is served from face-app:// and never needs file:// URLs.
  session.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*", "file://*/*"] }, (_details, callback) => callback({ cancel: true }));
}
