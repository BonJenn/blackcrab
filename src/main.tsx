import ReactDOM from "react-dom/client";
import App from "./App";

// Startup owns one serialized native service/desktop attempt per app launch.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />,
);
