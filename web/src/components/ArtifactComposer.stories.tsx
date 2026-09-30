import type { Meta, StoryObj } from "@storybook/react-vite";
import { useIsMutating } from "@tanstack/react-query";
import { useState } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { artifactApi } from "../artifact-api.ts";
import { artifactDrafts } from "../artifact-drafts.ts";
import { artifactFixtureFeedback } from "../artifact-fixtures.ts";
import { prepareDraftImage } from "../attachment-drafts.ts";
import { exampleImage } from "../image-fixture.ts";
import { ArtifactComposer } from "./ArtifactComposer.tsx";

const meta = {
  title: "Components/ArtifactComposer",
  component: ArtifactComposer,
  args: { artifactId: "artifact_composer_story" },
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ArtifactComposer>;
export default meta;
type Story = StoryObj<typeof meta>;
export const General: Story = { args: { artifactId: "artifact_general_composer" } };
export const GeneralDark: Story = { ...General, globals: { theme: "dark" } };
export const ImageOnly: Story = {
  args: { artifactId: "artifact_image_composer" },
  loaders: [
    async () => {
      const { attachment } = await prepareDraftImage(
        "artifact_image_composer",
        await exampleImage(),
      );
      artifactDrafts.update("artifact_image_composer", { attachments: [attachment], body: "" });
    },
  ],
};
export const ImageOnlyDark: Story = { ...ImageOnly, globals: { theme: "dark" } };
export const ImageOnlyNarrow: Story = {
  ...ImageOnly,
  decorators: [
    (Story) => (
      <div className="w-72">
        <Story />
      </div>
    ),
  ],
};
export const ImageOnlyNarrowDark: Story = { ...ImageOnlyNarrow, globals: { theme: "dark" } };
export const PasteAtCursor: Story = {
  args: { artifactId: "artifact_paste_composer" },
  beforeEach: () => {
    artifactDrafts.clear("artifact_paste_composer");
    return () => artifactDrafts.clear("artifact_paste_composer");
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("textbox") as HTMLTextAreaElement;
    await userEvent.type(input, "Beforeafter");
    input.setSelectionRange(6, 6);
    const data = new DataTransfer();
    data.items.add(new File([await exampleImage()], "example.png", { type: "image/png" }));
    input.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }),
    );
    await waitFor(() => expect(input).toHaveValue("Before [image1] after"));
    await expect(input.selectionStart).toBe(16);
    await expect(canvas.getByRole("button", { name: "Attach image" })).toHaveAttribute(
      "title",
      "Attach an image, or paste an image directly into the text input",
    );
  },
};
export const PasteAtCursorDark: Story = { ...PasteAtCursor, globals: { theme: "dark" } };
export const KeepDraftOnEscape: Story = {
  args: { artifactId: "artifact_persisted_composer" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const textbox = canvas.getByRole("textbox", { name: "Feedback" });
    await userEvent.type(textbox, "Keep this draft");
    await userEvent.keyboard("{Escape}");
    await expect(textbox).toHaveValue("Keep this draft");
  },
};

let finishPendingSave: (() => void) | undefined;
export const PreserveDraftDuringPendingSave: Story = {
  args: { artifactId: "artifact_pending_composer", onDone: fn() },
  beforeEach: () => {
    const original = artifactApi.addFeedback;
    artifactDrafts.update("artifact_pending_composer", { body: "Submitted note" });
    artifactApi.addFeedback = (artifactId, body, target) =>
      new Promise((resolve) => {
        finishPendingSave = () =>
          resolve({ ...artifactFixtureFeedback, artifactId, body, target, replies: [] });
      });
    return () => {
      finishPendingSave?.();
      finishPendingSave = undefined;
      artifactApi.addFeedback = original;
      artifactDrafts.clear("artifact_pending_composer");
    };
  },
  render: (args) => {
    const [visit, setVisit] = useState(0);
    const pending = useIsMutating();
    return (
      <>
        <button type="button" onClick={() => setVisit((value) => value + 1)}>
          Reopen composer
        </button>
        <button type="button" onClick={() => finishPendingSave?.()}>
          Complete pending save
        </button>
        <output>{pending ? "Save pending" : "Save finished"}</output>
        <ArtifactComposer key={visit} {...args} />
      </>
    );
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Add feedback" }));
    await waitFor(() => expect(canvas.getByRole("textbox")).toBeDisabled());
    await userEvent.click(canvas.getByRole("button", { name: "Reopen composer" }));
    const textbox = canvas.getByRole("textbox", { name: "Feedback" });
    await userEvent.clear(textbox);
    await userEvent.type(textbox, "Keep this newer draft");
    await userEvent.click(canvas.getByRole("button", { name: "Complete pending save" }));
    await waitFor(() => expect(canvas.getByRole("status")).toHaveTextContent("Save finished"));
    await expect(textbox).toHaveValue("Keep this newer draft");
    await expect(args.onDone).not.toHaveBeenCalled();
  },
};
export const RenderedTarget: Story = {
  loaders: [
    () => {
      artifactDrafts.anchor("artifact_composer_story", {
        kind: "rendered",
        versionSeq: 1,
        path: "index.md",
        locator: { selector: "a", quote: "View the comparison" },
      });
      return {};
    },
  ],
};
export const VersionedReply: Story = {
  args: { artifactId: "artifact_reply_story", replyTo: "feedback_story" },
  loaders: [
    () => {
      artifactDrafts.beginReply("artifact_reply_story", "feedback_story", {
        versionSeq: 3,
        representation: "source",
      });
      return {};
    },
  ],
};
export const RetiredDescriptionDraft: Story = {
  args: { artifactId: "artifact_description_draft" },
  loaders: [
    () => {
      artifactDrafts.anchor("artifact_description_draft", {
        kind: "version_summary",
        versionSeq: 1,
        locator: { quote: "Original description" },
      });
      artifactDrafts.update("artifact_description_draft", { body: "Keep this saved feedback" });
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Add feedback" })).toBeDisabled();
    await userEvent.click(canvas.getByRole("button", { name: "Clear target" }));
    await expect(canvas.getByRole("textbox", { name: "Feedback" })).toHaveValue(
      "Keep this saved feedback",
    );
    await expect(canvas.getByRole("button", { name: "Add feedback" })).toBeEnabled();
  },
};

export const Floating: Story = {
  ...RenderedTarget,
  args: { floating: { left: 360, top: 140, bottom: 164, onClose: () => {} } },
};
export const FloatingDark: Story = { ...Floating, globals: { theme: "dark" } };
