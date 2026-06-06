export const NORTH_POLE_HAT_BILLBOARD_PX = 160;

const HAT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 148" width="256" height="296">
  <ellipse cx="64" cy="132" rx="56" ry="13" fill="#141428" stroke="#080812" stroke-width="2"/>
  <ellipse cx="64" cy="128" rx="56" ry="13" fill="#1e1e38" stroke="#080812" stroke-width="1.5"/>
  <rect x="30" y="44" width="68" height="86" rx="3" fill="#1e1e38" stroke="#080812" stroke-width="2"/>
  <rect x="30" y="98" width="68" height="14" fill="#7c2d4a"/>
  <rect x="30" y="98" width="68" height="5" fill="#9a3a5c" opacity="0.55"/>
  <ellipse cx="64" cy="44" rx="34" ry="7" fill="#2a2a48" stroke="#080812" stroke-width="1.5"/>
  <ellipse cx="64" cy="43" rx="28" ry="4" fill="#353560" opacity="0.35"/>
</svg>`;

let cachedImageUrl = null;

export function loadGentlemanHatImage() {
  if (cachedImageUrl) {
    return Promise.resolve(cachedImageUrl);
  }

  return new Promise((resolve) => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 296;
    const ctx = canvas.getContext("2d");
    const svgUrl = `data:image/svg+xml,${encodeURIComponent(HAT_SVG)}`;

    if (!ctx) {
      cachedImageUrl = svgUrl;
      resolve(cachedImageUrl);
      return;
    }

    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      cachedImageUrl = canvas.toDataURL("image/png");
      resolve(cachedImageUrl);
    };
    img.onerror = () => {
      cachedImageUrl = svgUrl;
      resolve(cachedImageUrl);
    };
    img.src = svgUrl;
  });
}
