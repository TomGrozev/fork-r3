// Code-drawn feedback screenshot used by component stories.
export async function exampleImage(): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = 800;
  canvas.height = 450;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fafafa";
  ctx.fillRect(0, 0, 800, 450);
  ctx.fillStyle = "#e5e5e5";
  ctx.fillRect(0, 0, 180, 450);
  ctx.fillStyle = "#171717";
  ctx.font = "bold 28px sans-serif";
  ctx.fillText("Revenue overview", 220, 65);
  ctx.font = "18px sans-serif";
  ctx.fillText("The chart label overlaps the legend", 220, 105);
  ctx.fillStyle = "#4f46e5";
  for (let i = 0; i < 6; i++) ctx.fillRect(230 + i * 75, 350 - i * 30, 45, 40 + i * 30);
  ctx.fillStyle = "#737373";
  ctx.font = "16px sans-serif";
  ctx.fillText("Monthly revenue · Example data", 230, 390);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob!), "image/png"));
}
