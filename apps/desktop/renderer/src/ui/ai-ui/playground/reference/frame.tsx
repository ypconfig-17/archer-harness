import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Specimen } from "./Specimen";
import { isReferenceConfig, tokenNames, type SampleState } from "./protocol";
import "./frame.css";

function Frame() {
  const [state, setState] = useState<SampleState>("running");
  useEffect(() => {
    const receive = (event: MessageEvent<unknown>) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== window.parent ||
        !isReferenceConfig(event.data)
      )
        return;
      const config = event.data;
      const root = document.documentElement;
      root.dataset.appearance = config.appearance;
      root.classList.toggle("dark", config.appearance === "dark");
      for (const key of tokenNames) {
        const value = config.tokens[key];
        if (value) root.style.setProperty(`--${key}`, value);
        else root.style.removeProperty(`--${key}`);
      }
      setState(config.state);
    };
    window.addEventListener("message", receive);
    window.parent.postMessage(
      { type: "archer-reference-ready" },
      window.location.origin,
    );
    return () => window.removeEventListener("message", receive);
  }, []);
  return <Specimen state={state} />;
}
createRoot(document.getElementById("root")!).render(<Frame />);
