import type { Meta, StoryObj } from "@storybook/react-vite";
import { createRef, useRef } from "react";
import { expect, fn, userEvent, within } from "storybook/test";
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
export const CaptureCancelled: Story = {
  beforeEach: () => {
    const crop = Object.getOwnPropertyDescriptor(window, "CropTarget");
    const image = Object.getOwnPropertyDescriptor(window, "ImageCapture");
    const display = Object.getOwnPropertyDescriptor(navigator.mediaDevices, "getDisplayMedia");
    Object.defineProperty(window, "CropTarget", {
      configurable: true,
      value: { fromElement: async () => ({}) },
    });
    Object.defineProperty(window, "ImageCapture", { configurable: true, value: class {} });
    Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
      configurable: true,
      value: async () => {
        throw new DOMException("Sharing denied", "NotAllowedError");
      },
    });
    return () => {
      for (const [object, key, descriptor] of [
        [window, "CropTarget", crop],
        [window, "ImageCapture", image],
        [navigator.mediaDevices, "getDisplayMedia", display],
      ] as const) {
        if (descriptor) Object.defineProperty(object, key, descriptor);
        else Reflect.deleteProperty(object, key);
      }
    };
  },
  render: (args) => {
    const frame = useRef<HTMLIFrameElement>(null);
    return (
      <>
        <PreviewScreenshot {...args} frame={frame} />
        <iframe ref={frame} title="Sample preview" srcDoc="<p>Sample content</p>" />
      </>
    );
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Capture area" }));
    await expect(
      await within(document.body).findByText(
        "Capture cancelled. You can paste a screenshot instead.",
      ),
    ).toBeVisible();
    await userEvent.click(
      within(document.body).getByRole("button", { name: "Dismiss Capture notice" }),
    );
    await expect(within(document.body).queryByText("Capture notice")).toBeNull();
  },
};
