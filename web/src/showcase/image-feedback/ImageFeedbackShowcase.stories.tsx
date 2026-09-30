import type { Meta, StoryObj } from "@storybook/react-vite";
import { ImageFeedbackShowcase } from "./ImageFeedbackShowcase.tsx";

const meta = {
  title: "Showcases/Image feedback",
  component: ImageFeedbackShowcase,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ImageFeedbackShowcase>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = {};
export const Dark: Story = { globals: { theme: "dark" } };
export const Mobile: Story = { globals: { viewport: { value: "mobile1" } } };
