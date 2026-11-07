# Hosted UI design sandbox

Run `npm run dev:ui`, then open http://127.0.0.1:5180/tagging.

- Uses the actual hosted `CloudGameTracker`, `CloudPortal`, shared UI components and styles — not the older local-demo UI.
- No username, password, Azure credentials or Azure connection. The real API service runs against disposable in-memory data on loopback only.
- Edit React components or CSS and Vite updates the preview immediately.
- Expand **UI sandbox · local only** in the bottom-right corner to switch between Tagging, Roster setup and Competitions, or reset sample data.
- All tracker tabs, starter selection, scoring, substitutions and save feedback use the hosted code paths.
- Sample changes survive a page reload while the server is running, but reset on server restart or **Reset sample data**. This is not durable game storage.
- Keep one editor tab per sample session; the hosted single-editor lock remains active.
- The middleware is loaded only by Vite's `serve` command in `ui` mode. The sandbox entry is guarded by `import.meta.env.DEV` and is excluded from production builds. Never publish or tunnel this server.

The older `npm run dev` demo remains available on its separate port, but use `dev:ui` for designs intended for Azure.