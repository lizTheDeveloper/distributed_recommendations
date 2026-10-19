// dist/dap.js: the DAP upload client (@divviup/dap 0.9.1 through packages/analytics'
// upload.ts). Built separately and injected only when a discovery-stats report is due,
// so app.js doesn't carry it. Exposes a frozen global the app reads once.
import { divviupClient, runUploads } from "../../../../../packages/analytics/src/upload.ts";

Object.defineProperty(globalThis, "__MF_DAP__", { value: Object.freeze({ divviupClient, runUploads }), configurable: false, writable: false });
