import { hydrateRoot } from "react-dom/client";
import { App } from "./App.js";
import { PolicyCatalog } from "./PolicyCatalog.js";
import { RouteCatalog } from "./RouteCatalog.js";
import { ClientContracts } from "./ClientContracts.js";
const pathname = window.location.pathname.replace(/\/$/, "");
hydrateRoot(document.getElementById("root")!, pathname === "/experiments/contracts" ? <ClientContracts/> : pathname === "/experiments/routes" ? <RouteCatalog/> : pathname === "/experiments/policies" ? <PolicyCatalog/> : <App/>);
