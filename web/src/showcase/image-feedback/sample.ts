// An intentionally crowded chart label gives the playground something to review.
export async function sampleScreenshot(): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 760;
  const ctx = canvas.getContext("2d")!;
  const text = (
    value: string,
    x: number,
    y: number,
    size = 20,
    color = "#667085",
    bold = false,
  ) => {
    ctx.fillStyle = color;
    ctx.font = `${bold ? 600 : 400} ${size}px system-ui, sans-serif`;
    ctx.fillText(value, x, y);
  };
  const line = (x: number, y: number, width: number) => {
    ctx.fillStyle = "#e7e9ee";
    ctx.fillRect(x, y, width, 1);
  };
  ctx.fillStyle = "#f8f9fc";
  ctx.fillRect(0, 0, 1200, 760);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 1200, 86);
  text("S", 42, 55, 26, "#5757e9", true);
  text("Studio", 82, 55, 24, "#202432", true);
  text("Overview", 260, 54, 18, "#5757e9", true);
  text("Projects", 392, 54, 18);
  text("Audience", 510, 54, 18);
  text("Example workspace", 955, 54, 17);
  line(0, 86, 1200);
  text("Your work, in perspective.", 48, 153, 34, "#202432", true);
  text("A little more momentum, every month.", 48, 190, 19);
  const stats = [
    ["Total views", "24,860", "+18.6%"],
    ["New subscribers", "1,284", "+12.4%"],
    ["Projects shipped", "32", "+4 this month"],
  ];
  stats.forEach(([label, value, change], i) => {
    const x = 48 + i * 378;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x, 226, 348, 126);
    ctx.strokeStyle = "#e7e9ee";
    ctx.strokeRect(x, 226, 348, 126);
    text(label!, x + 22, 260, 17);
    text(value!, x + 22, 314, 34, "#202432", true);
    text(change!, x + 190, 308, 16, "#088268", true);
  });
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(48, 382, 1104, 330);
  ctx.strokeStyle = "#e7e9ee";
  ctx.strokeRect(48, 382, 1104, 330);
  text("Audience growth", 72, 424, 22, "#202432", true);
  text("Monthly views", 72, 454, 16);
  text("Last 6 months", 970, 424, 16);
  for (let i = 0; i < 3; i++) {
    const y = 488 + i * 76;
    text(["10k", "5k", "0"][i]!, 76, y + 6, 14);
    line(130, y, 986);
  }
  const heights = [58, 76, 88, 104, 126, 157];
  heights.forEach((height, i) => {
    const x = 172 + i * 162;
    ctx.fillStyle = i === 5 ? "#5757e9" : "#d8dafc";
    ctx.fillRect(x, 640 - height, 74, height);
    text(["Apr", "May", "Jun", "Jul", "Aug", "Sep"][i]!, x + 20, 673, 16);
  });
  ctx.fillStyle = "#eef0ff";
  ctx.fillRect(943, 462, 172, 40);
  text("Best month yet", 955, 488, 16, "#4947bd", true);
  text("9,840", 993, 480, 20, "#202432", true);
  text("SAMPLE DESIGN · The September value collides with its callout.", 48, 744, 13);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Unable to build sample"))),
      "image/png",
    ),
  );
}
