import { AsyncLocalStorage } from "node:async_hooks";
import Module from "node:module";
import React from "react";

// Import this first. Next's bundler gives server code the server build of next/navigation and renders client
// components as references; plain Node under the react-server condition does neither. This does the same two
// things, so server actions and server pages load as they would on the server. Their logic is untouched.
(globalThis as unknown as { AsyncLocalStorage: unknown }).AsyncLocalStorage = AsyncLocalStorage; // Next's server sets this at startup
(globalThis as unknown as { React: unknown }).React = React; // pages are compiled with the classic JSX transform here
const load = (Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown })._load;
(Module as unknown as { _load: typeof load })._load = (request, parent, isMain) => {
  if (request === "next/navigation") return load("next/dist/client/components/navigation.react-server", parent, isMain);
  if (request === "next/link" || /\/SignInForms$/.test(request)) return { __esModule: true, default: () => null, SignInForms: () => null };
  return load(request, parent, isMain);
};
