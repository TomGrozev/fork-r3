import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
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
