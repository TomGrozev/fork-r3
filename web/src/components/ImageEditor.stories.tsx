import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { exampleImage } from "../image-fixture.ts";
import { ImageEditor } from "./ImageEditor.tsx";

const meta = {
  title: "Components/ImageEditor",
  component: ImageEditor,
  args: { onCancel: fn(), onSave: fn(async () => {}) },
  loaders: [async () => ({ blob: await exampleImage() })],
  render: (args, { loaded }) => <ImageEditor {...args} blob={loaded.blob} />,
} satisfies Meta<typeof ImageEditor>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Crop: Story = { args: { blob: new Blob() } };
export const Dark: Story = { ...Crop, globals: { theme: "dark" } };

export const DrawingTools: Story = {
  ...Crop,
  play: async () => {
    const screen = within(document.body);
    const arrow = await screen.findByRole("button", { name: "Arrow" });
    await waitFor(() => expect(arrow).toBeEnabled());
    await userEvent.click(arrow);
    await expect(screen.getByRole("button", { name: "Arrow" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await userEvent.selectOptions(screen.getByLabelText("Stroke width"), "8");
  },
};
export const DrawingToolsDark: Story = { ...DrawingTools, globals: { theme: "dark" } };
