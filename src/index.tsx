import React from "react";
import { createRoot } from "react-dom/client";
import MetatronVectorFOIL from "./MetatronVectorFOIL";

const host = document.querySelector("#root .frame");
if (!host) throw new Error("No host element");
createRoot(host).render(<MetatronVectorFOIL />);
