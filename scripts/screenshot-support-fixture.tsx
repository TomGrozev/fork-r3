// Isolated capability checks for the real screenshot toolbar; no daemon or publication.
import { useRef } from "react";
import { createRoot } from "react-dom/client";
import { PreviewScreenshot } from "../web/src/components/PreviewScreenshot.tsx";
import "../web/src/main.css";

const missing = new URLSearchParams(location.search).get("missing");
if (missing === "region") Object.defineProperty(window, "CropTarget", { value: undefined });
if (missing === "frame") Object.defineProperty(window, "ImageCapture", { value: undefined });
if (missing === "display")
  Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", { value: undefined });

function Fixture() {
  const frame = useRef<HTMLIFrameElement>(null);
  return (
    <>
      <PreviewScreenshot
        artifactId="screenshot-support-fixture"
        versionSeq={1}
        path="index.html"
        frame={frame}
        onTarget={() => {}}
      />
      <iframe ref={frame} title="Preview fixture" sandbox="allow-scripts" srcDoc="<p>Preview</p>" />
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
