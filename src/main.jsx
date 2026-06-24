import React from "react";
import { createRoot } from "react-dom/client";
import RadiTriage from "./RadiTriage.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <div style={{ minHeight: "100vh" }}>
      <RadiTriage />
    </div>
  </React.StrictMode>
);
