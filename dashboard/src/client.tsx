import { hydrateRoot } from "react-dom/client";
import { App } from "./App.js";
import { PolicyCatalog } from "./PolicyCatalog.js";
hydrateRoot(document.getElementById("root")!, window.location.pathname.replace(/\/$/, "") === "/experiments/policies" ? <PolicyCatalog/> : <App/>);
