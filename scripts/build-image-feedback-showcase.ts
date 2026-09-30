import { buildComponentArtifact } from "./build-component-artifact.ts";

await buildComponentArtifact({
  entrypoint: "web/src/showcase/image-feedback/index.tsx",
  directory: "dist/image-feedback-showcase",
  title: "r3 — Image feedback playground",
});
