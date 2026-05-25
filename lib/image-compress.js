/** Client-side image compression to max width before upload. */
export async function compressImageFile(file, maxWidth = 1600) {
  const bitmap = await createImageBitmap(file);
  const scale = bitmap.width > maxWidth ? maxWidth / bitmap.width : 1;
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Failed to compress image"))),
      "image/jpeg",
      0.85
    );
  });

  return new File([blob], file.name.replace(/\.\w+$/, ".jpg") || "photo.jpg", {
    type: "image/jpeg",
  });
}
