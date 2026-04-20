import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { PublicView } from "./components/PublicView.jsx";
import "./App.css";
import { parsePublicViewFileIdFromHash } from "./shareLink.js";

function Root() {
  const [publicFileId, setPublicFileId] = useState(
    parsePublicViewFileIdFromHash,
  );

  useEffect(() => {
    const sync = () => setPublicFileId(parsePublicViewFileIdFromHash());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  if (publicFileId) {
    return (
      <React.StrictMode>
        <PublicView
          fileId={publicFileId}
          onOpenEditor={() => {
            window.location.hash = "";
          }}
        />
      </React.StrictMode>
    );
  }

  return (
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<Root />);
