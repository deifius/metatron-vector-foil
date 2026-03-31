import React from "react";
import { createRoot } from "react-dom/client";
import MetatronVectorFOIL from "./MetatronVectorFOIL";

const el = document.getElementById("root");
if (!el) throw new Error("No root element");

createRoot(el).render(<MetatronVectorFOIL />);
