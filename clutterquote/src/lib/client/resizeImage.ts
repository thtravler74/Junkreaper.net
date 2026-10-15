/**
 * Downscale a photo in the browser before upload. Phone photos are 3–12 MB;
 * vision models gain nothing past ~1600px on the long edge, and a 300 KB JPEG
 * uploads in a second on a weak cell signal. createImageBitmap honors EXIF
 * orientation, so portrait shots stay upright.
 */
export async function resizeImage(file: File, maxEdge = 1600, quality = 0.82): Promise<{ mime: "image/jpeg"; base64: string; previewUrl: string }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  return { mime: "image/jpeg", base64: dataUrl.slice(dataUrl.indexOf(",") + 1), previewUrl: dataUrl };
}
