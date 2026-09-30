import type { Meta, StoryObj } from "@storybook/react-vite";
import { createRef } from "react";
import { expect, fn, within } from "storybook/test";
import { PreviewScreenshot } from "./PreviewScreenshot.tsx";

const meta = {
  title: "Components/PreviewScreenshot",
  component: PreviewScreenshot,
  args: {
    artifactId: "screenshot-story",
    versionSeq: 1,
    path: "index.html",
    frame: createRef<HTMLIFrameElement>(),
    onTarget: fn(),
  },
} satisfies Meta<typeof PreviewScreenshot>;
export default meta;
type Story = StoryObj<typeof meta>;
export const BrowserSupport: Story = {};
export const Unavailable: Story = {
  beforeEach: () => {
    const original = Object.getOwnPropertyDescriptor(window, "CropTarget");
    Object.defineProperty(window, "CropTarget", { configurable: true, value: undefined });
    return () => {
      if (original) Object.defineProperty(window, "CropTarget", original);
      else Reflect.deleteProperty(window, "CropTarget");
    };
  },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement);
    await expect(screen.queryByRole("button", { name: "Capture area" })).toBeNull();
  },
};
export const UnavailableDark: Story = { ...Unavailable, globals: { theme: "dark" } };
