"use client";

import dynamic from "next/dynamic";
import "@scalar/api-reference-react/style.css";

// Scalar renders in the browser only: it touches `window` at mount, so we load
// it via a client-side dynamic import with `ssr: false` (permitted inside a
// client component) to keep it out of the server render. It fetches the spec
// same-origin from `/api/openapi`, carrying the session cookie.
const ApiReferenceReact = dynamic(
  () => import("@scalar/api-reference-react").then((m) => m.ApiReferenceReact),
  { ssr: false },
);

export default function ApiReferenceView() {
  return <ApiReferenceReact configuration={{ url: "/api/openapi" }} />;
}
