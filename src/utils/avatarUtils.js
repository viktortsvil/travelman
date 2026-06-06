export const AVATAR_BILLBOARD_PX = 48;

const TEXTURE_SIZE = 128;
const inflight = new Set();
const MIN_AVATAR_PX = 32;

function markerFillColor(color) {
  const normalized = String(color ?? "").toLowerCase();
  if (!normalized || normalized === "#fff" || normalized === "#ffffff") {
    return "#4ecdc4";
  }
  return color;
}

export function initialsForName(name) {
  const parts = String(name || "?")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return (parts[0]?.slice(0, 2) ?? "?").toUpperCase();
}

/** Local circular marker with traveler initials. */
export function travelerMarkerImage(displayName, color = "#4ecdc4") {
  const size = TEXTURE_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  const fill = markerFillColor(color);
  const borderWidth = 3;
  const radius = size / 2 - borderWidth / 2;

  ctx.beginPath();
  ctx.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = borderWidth;
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.font = `600 ${Math.round(size * 0.36)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(initialsForName(displayName), size / 2, size / 2);

  return canvas.toDataURL("image/png");
}

function isValidAvatarImage(img) {
  return img.naturalWidth >= MIN_AVATAR_PX && img.naturalHeight >= MIN_AVATAR_PX;
}

function photoMarkerDataUrl(img) {
  if (!isValidAvatarImage(img)) return null;

  const size = TEXTURE_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const borderWidth = 3;
  const radius = size / 2 - borderWidth / 2;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  const sourceSize = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - sourceSize) / 2;
  const sy = (img.naturalHeight - sourceSize) / 2;
  ctx.drawImage(img, sx, sy, sourceSize, sourceSize, 0, 0, size, size);

  ctx.beginPath();
  ctx.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = borderWidth;
  ctx.stroke();

  try {
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

function finishLoad(key, onSuccess, image) {
  inflight.delete(key);
  if (image) onSuccess(image);
}

/**
 * Try loading a profile photo once. On failure, the caller keeps the local initials image.
 * @param {(image: string) => void} onSuccess called only when a valid photo loads
 */
export function tryLoadTravelerAvatar({
  userId,
  avatarUrl,
  onSuccess,
}) {
  if (!avatarUrl || !onSuccess) return;

  const key = `${userId}:${avatarUrl}`;
  if (inflight.has(key)) return;
  inflight.add(key);

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    if (!isValidAvatarImage(img)) {
      finishLoad(key, onSuccess, null);
      return;
    }

    const photo = photoMarkerDataUrl(img);
    // Canvas crop when CORS allows; otherwise pass URL straight to Cesium.
    finishLoad(key, onSuccess, photo ?? avatarUrl);
  };
  img.onerror = () => {
    const fallback = new Image();
    fallback.onload = () => {
      if (!isValidAvatarImage(fallback)) {
        finishLoad(key, onSuccess, null);
        return;
      }
      finishLoad(key, onSuccess, avatarUrl);
    };
    fallback.onerror = () => finishLoad(key, onSuccess, null);
    fallback.src = avatarUrl;
  };
  img.src = avatarUrl;
}

export function applyBillboardImage(entity, image) {
  if (entity?.billboard && image) {
    entity.billboard.image = image;
  }
}
