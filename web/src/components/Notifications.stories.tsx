import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { phoneViewport } from "../storyViewport.ts";
import { Button } from "../ui.tsx";
import { AGENT_DELIVERY_HELP } from "./ArtifactHandoffNotice.tsx";
import { Notification, type NotificationProps } from "./Notifications.tsx";

function Example(args: NotificationProps) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <p className="mb-3 text-sm text-neutral-500">
        Notices share the bottom-right corner, independently of the originating pane.
      </p>
      <Button onClick={() => setOpen((value) => !value)}>
        {open ? "Remove originating component" : "Show notification"}
      </Button>
      {open && <Notification {...args} onDismiss={() => setOpen(false)} />}
    </>
  );
}

const meta = {
  title: "Components/Notifications",
  component: Notification,
  args: {
    title: "Agent notified",
    message: "Your feedback is ready for the agent to fetch.",
    tone: "success",
    onDismiss: () => {},
  },
  render: (args) => <Example {...args} />,
} satisfies Meta<typeof Notification>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Success: Story = {};
export const SuccessDark: Story = { globals: { theme: "dark" } };
export const DeliveryFailure: Story = {
  args: {
    title: "Agent notification failed",
    message: AGENT_DELIVERY_HELP,
    tone: "error",
    command: "r3 feedback fetch artifact_example",
    details: "Delivery adapter is unavailable",
  },
  play: async ({ canvasElement }) => {
    const screen = within(document.body);
    const alert = await screen.findByRole("alert");
    await expect(alert).toHaveTextContent("Check that your agent session is still running");
    await userEvent.click(within(alert).getByText("Delivery details"));
    await expect(within(alert).getByText("Delivery adapter is unavailable")).toBeVisible();
    await userEvent.click(within(alert).getByRole("button", { name: "Copy fetch command" }));
    await expect(within(alert).getByRole("button", { name: "Command copied" })).toBeVisible();
    await userEvent.click(
      within(alert).getByRole("button", { name: "Dismiss Agent notification failed" }),
    );
    await expect(screen.queryByRole("alert")).toBeNull();
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Show notification" }));
    await expect(await screen.findByRole("alert")).toBeVisible();
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Remove originating component" }),
    );
    await expect(screen.queryByRole("alert")).toBeNull();
  },
};
export const DeliveryFailureDark: Story = { ...DeliveryFailure, globals: { theme: "dark" } };
export const Phone: Story = { ...DeliveryFailure, ...phoneViewport };
export const ArchiveDeliveryFailure: Story = {
  args: {
    title: "Archived, but agent notification failed",
    message:
      "Your message is saved in the artifact history. Check that the agent session is still running.",
    tone: "warning",
    command: undefined,
  },
};
export const Stack: Story = {
  render: (args) => (
    <>
      <Example
        {...args}
        title="Review notice"
        message="Finish or discard the current draft before changing its target."
        tone="warning"
      />
      <Example
        {...args}
        title="Capture notice"
        message="Capture cancelled. You can paste a screenshot instead."
        tone="info"
      />
    </>
  ),
  play: async () => {
    const screen = within(document.body);
    const notices = await screen.findAllByRole("status");
    await expect(notices).toHaveLength(2);
    const [upper, lower] = notices.map((notice) => notice.getBoundingClientRect());
    await expect(upper.bottom).toBeLessThanOrEqual(lower.top);
    await expect(lower.right).toBeLessThan(window.innerWidth);
    await userEvent.click(screen.getByRole("button", { name: "Dismiss Review notice" }));
    await expect(screen.queryByText("Review notice")).toBeNull();
    await expect(screen.getByText("Capture notice")).toBeVisible();
  },
};
