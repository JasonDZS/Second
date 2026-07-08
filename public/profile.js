(function initSecondProfile(root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  const target = root || {};
  if (target) target.SecondProfile = api;
  if (typeof window === "object") window.SecondProfile = api;
  if (typeof globalThis === "object") globalThis.SecondProfile = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSecondProfile() {
  const NICE_AVATAR_SOURCE_URL = "https://nice-avatar.wwayne.com/";

  const NICE_AVATAR_OPTIONS = {
    sex: ["man", "woman"],
    faceColor: ["#F9C9B6", "#AC6651", "#E8B08A", "#F4D7C7"],
    earSize: ["small", "big"],
    hairColor: ["#171921", "#77311D", "#F48150", "#FC909F", "#D2EFF3", "#506AF4", "#FFFFFF"],
    hairStyle: ["normal", "thick", "mohawk", "womanLong", "womanShort"],
    hatColor: ["#171921", "#77311D", "#F48150", "#FC909F", "#D2EFF3", "#506AF4", "#FFFFFF"],
    hatStyle: ["none", "beanie", "turban"],
    eyeBrowStyle: ["up", "upWoman"],
    eyeStyle: ["circle", "oval", "smile"],
    glassesStyle: ["none", "round", "square"],
    noseStyle: ["short", "long", "round"],
    mouthStyle: ["laugh", "smile", "peace"],
    shirtStyle: ["hoody", "short", "polo"],
    shirtColor: ["#9287FF", "#6BD9E9", "#FC909F", "#F4D150", "#77311D", "#506AF4", "#74D153"],
    bgColor: ["#9287FF", "#6BD9E9", "#FC909F", "#F4D150", "#E0DDFF", "#D2EFF3", "#FFEDEF", "#FFEBA4", "#506AF4", "#F48150", "#74D153"],
  };

  const NICE_AVATAR_DEFAULT_CONFIG = {
    sex: "man",
    faceColor: "#F9C9B6",
    earSize: "small",
    hairColor: "#171921",
    hairStyle: "normal",
    hatColor: "#506AF4",
    hatStyle: "none",
    eyeBrowStyle: "up",
    eyeStyle: "circle",
    glassesStyle: "none",
    noseStyle: "short",
    mouthStyle: "smile",
    shirtStyle: "hoody",
    shirtColor: "#9287FF",
    bgColor: "#D2EFF3",
    isGradient: false,
  };

  const NICE_AVATAR_SHAPES = [
    { id: "circle", label: "圆形" },
    { id: "rounded", label: "圆角" },
    { id: "square", label: "方形" },
  ];

  const NICE_AVATAR_RANDOM_SEEDS = [
    "atlas",
    "beam",
    "cipher",
    "delta",
    "ember",
    "flux",
    "harbor",
    "ion",
    "kepler",
    "lumen",
    "matrix",
    "nova",
  ];

  function profileFormFromState(profile = {}) {
    const seed = profile.avatarSeed || profile.name || profile.avatar || "Second";
    return {
      name: profile.name || "",
      roleIntro: profile.roleIntro || profile.tagline || "",
      avatarSeed: seed,
      avatarShape: normalizeNiceAvatarShape(profile.avatarShape || profile.avatarConfig?.shape || "circle"),
      avatarConfig: normalizeNiceAvatarConfig(profile.avatarConfig, seed),
    };
  }

  function profileAvatarMarkup(profile = {}, className = "avatar", html = {}) {
    const escapeAttr = html.escapeAttr || escapeHtmlAttribute;
    const escapeHtml = html.escapeHtml || escapeHtmlText;
    const url = niceAvatarUrlFromProfile(profile);
    const fallback = profile.avatar || Array.from(String(profile.name || "?"))[0] || "?";
    if (url) {
      return `<div class="${escapeAttr(className)}"><img src="${escapeAttr(url)}" alt="" loading="lazy" decoding="async" /></div>`;
    }
    return `<div class="${escapeAttr(className)}">${escapeHtml(fallback)}</div>`;
  }

  function niceAvatarUrlFromProfile(profile = {}) {
    const form = profileFormFromState(profile);
    return niceAvatarDataUrl(form.avatarConfig, form.avatarShape);
  }

  function normalizeNiceAvatarConfig(config = {}, seed = "Second", fallbackConfig = NICE_AVATAR_DEFAULT_CONFIG) {
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      return niceAvatarConfigFromSeed(seed);
    }
    const fallback = fallbackConfig && typeof fallbackConfig === "object"
      ? { ...NICE_AVATAR_DEFAULT_CONFIG, ...fallbackConfig }
      : NICE_AVATAR_DEFAULT_CONFIG;
    const normalized = {
      sex: optionValue("sex", config.sex, fallback.sex),
      faceColor: colorValue(config.faceColor, fallback.faceColor),
      earSize: optionValue("earSize", config.earSize, fallback.earSize),
      hairColor: colorValue(config.hairColor, fallback.hairColor),
      hairStyle: optionValue("hairStyle", config.hairStyle, fallback.hairStyle),
      hatColor: colorValue(config.hatColor, fallback.hatColor),
      hatStyle: optionValue("hatStyle", config.hatStyle, fallback.hatStyle),
      eyeBrowStyle: optionValue("eyeBrowStyle", config.eyeBrowStyle, fallback.eyeBrowStyle || (config.sex === "woman" ? "upWoman" : "up")),
      eyeStyle: optionValue("eyeStyle", config.eyeStyle, fallback.eyeStyle),
      glassesStyle: optionValue("glassesStyle", config.glassesStyle, fallback.glassesStyle),
      noseStyle: optionValue("noseStyle", config.noseStyle, fallback.noseStyle),
      mouthStyle: optionValue("mouthStyle", config.mouthStyle, fallback.mouthStyle),
      shirtStyle: optionValue("shirtStyle", config.shirtStyle, fallback.shirtStyle),
      shirtColor: colorValue(config.shirtColor, fallback.shirtColor),
      bgColor: colorValue(config.bgColor, fallback.bgColor),
      isGradient: config.isGradient == null ? Boolean(fallback.isGradient) : Boolean(config.isGradient),
    };
    if (normalized.sex === "woman" && normalized.eyeBrowStyle === "up") normalized.eyeBrowStyle = "upWoman";
    if (normalized.sex === "man" && normalized.eyeBrowStyle === "upWoman") normalized.eyeBrowStyle = "up";
    return normalized;
  }

  function normalizeNiceAvatarShape(shape = "circle", fallback = "circle") {
    const value = String(shape || "circle");
    if (NICE_AVATAR_SHAPES.some((item) => item.id === value)) return value;
    const fallbackValue = String(fallback || "circle");
    return NICE_AVATAR_SHAPES.some((item) => item.id === fallbackValue) ? fallbackValue : "circle";
  }

  function niceAvatarConfigFromSeed(seed = "Second") {
    const text = String(seed || "Second");
    const sex = seededPick(NICE_AVATAR_OPTIONS.sex, text, "sex");
    const hatStyle = seededPick(weighted(["none", "none", "none", "beanie", "turban"]), text, "hatStyle");
    const glassesStyle = seededPick(weighted(["none", "none", "round", "square"]), text, "glassesStyle");
    const hairStyle = sex === "woman"
      ? seededPick(["normal", "womanLong", "womanShort"], text, "hairStyle")
      : seededPick(["normal", "thick", "mohawk"], text, "hairStyle");
    return normalizeNiceAvatarConfig({
      sex,
      faceColor: seededPick(NICE_AVATAR_OPTIONS.faceColor, text, "faceColor"),
      earSize: seededPick(NICE_AVATAR_OPTIONS.earSize, text, "earSize"),
      hairColor: seededPick(NICE_AVATAR_OPTIONS.hairColor, text, "hairColor"),
      hairStyle,
      hatColor: seededPick(NICE_AVATAR_OPTIONS.hatColor, text, "hatColor"),
      hatStyle,
      eyeBrowStyle: sex === "woman" ? "upWoman" : "up",
      eyeStyle: seededPick(NICE_AVATAR_OPTIONS.eyeStyle, text, "eyeStyle"),
      glassesStyle,
      noseStyle: seededPick(NICE_AVATAR_OPTIONS.noseStyle, text, "noseStyle"),
      mouthStyle: seededPick(NICE_AVATAR_OPTIONS.mouthStyle, text, "mouthStyle"),
      shirtStyle: seededPick(NICE_AVATAR_OPTIONS.shirtStyle, text, "shirtStyle"),
      shirtColor: seededPick(NICE_AVATAR_OPTIONS.shirtColor, text, "shirtColor"),
      bgColor: seededPick(NICE_AVATAR_OPTIONS.bgColor, text, "bgColor"),
    }, text);
  }

  function randomNiceAvatarConfig(random = Math.random) {
    const sex = randomPick(NICE_AVATAR_OPTIONS.sex, random);
    const hairStyle = sex === "woman"
      ? randomPick(["normal", "womanLong", "womanShort"], random)
      : randomPick(["normal", "thick", "mohawk"], random);
    return normalizeNiceAvatarConfig({
      sex,
      faceColor: randomPick(NICE_AVATAR_OPTIONS.faceColor, random),
      earSize: randomPick(NICE_AVATAR_OPTIONS.earSize, random),
      hairColor: randomPick(NICE_AVATAR_OPTIONS.hairColor, random),
      hairStyle,
      hatColor: randomPick(NICE_AVATAR_OPTIONS.hatColor, random),
      hatStyle: randomPick(weighted(["none", "none", "none", "beanie", "turban"]), random),
      eyeBrowStyle: sex === "woman" ? "upWoman" : "up",
      eyeStyle: randomPick(NICE_AVATAR_OPTIONS.eyeStyle, random),
      glassesStyle: randomPick(weighted(["none", "none", "round", "square"]), random),
      noseStyle: randomPick(NICE_AVATAR_OPTIONS.noseStyle, random),
      mouthStyle: randomPick(NICE_AVATAR_OPTIONS.mouthStyle, random),
      shirtStyle: randomPick(NICE_AVATAR_OPTIONS.shirtStyle, random),
      shirtColor: randomPick(NICE_AVATAR_OPTIONS.shirtColor, random),
      bgColor: randomPick(NICE_AVATAR_OPTIONS.bgColor, random),
    });
  }

  function niceAvatarDataUrl(config = {}, shape = "circle") {
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(niceAvatarSvg(config, shape))}`;
  }

  function niceAvatarSvg(config = {}, shape = "circle") {
    const avatar = normalizeNiceAvatarConfig(config);
    const avatarShape = normalizeNiceAvatarShape(shape);
    const radius = avatarShape === "circle" ? 100 : avatarShape === "rounded" ? 24 : 0;
    const bgFill = avatar.isGradient ? "url(#niceBg)" : avatar.bgColor;
    const hairLayer = avatar.hatStyle === "none" ? renderHair(avatar.hairStyle, avatar.hairColor) : "";
    const hatLayer = renderHat(avatar.hatStyle, avatar.hatColor);
    return `
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200" fill="none">
  <defs>
    <clipPath id="niceAvatarClip"><rect width="200" height="200" rx="${radius}" /></clipPath>
    <linearGradient id="niceBg" x1="18" y1="10" x2="182" y2="190" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${avatar.bgColor}" />
      <stop offset="1" stop-color="${avatar.shirtColor}" />
    </linearGradient>
  </defs>
  <rect width="200" height="200" rx="${radius}" fill="${bgFill}" />
  <g clip-path="url(#niceAvatarClip)">
    ${renderShirt(avatar.shirtStyle, avatar.shirtColor)}
    ${avatar.hairStyle === "womanLong" && avatar.hatStyle === "none" ? renderHairBack(avatar.hairColor) : ""}
    ${renderEars(avatar.faceColor, avatar.earSize)}
    ${renderFace(avatar.faceColor)}
    ${hairLayer}
    ${hatLayer}
    ${renderBrows(avatar.eyeBrowStyle)}
    ${renderEyes(avatar.eyeStyle)}
    ${renderGlasses(avatar.glassesStyle)}
    ${renderNose(avatar.noseStyle)}
    ${renderMouth(avatar.mouthStyle)}
  </g>
</svg>`.trim();
  }

  function renderFace(color) {
    return `<ellipse cx="100" cy="91" rx="47" ry="56" fill="${color}" stroke="#171921" stroke-width="4" />`;
  }

  function renderEars(color, size) {
    const r = size === "big" ? 15 : 11;
    return `
      <circle cx="55" cy="92" r="${r}" fill="${color}" stroke="#171921" stroke-width="4" />
      <circle cx="145" cy="92" r="${r}" fill="${color}" stroke="#171921" stroke-width="4" />
    `;
  }

  function renderHairBack(color) {
    return `<path d="M52 82c0-36 22-58 51-58 36 0 55 27 52 70-2 28-9 48-27 60-7 5-49 5-58 0-14-11-20-38-18-72Z" fill="${color}" stroke="#171921" stroke-width="4" />`;
  }

  function renderHair(style, color) {
    if (style === "mohawk") {
      return `<path d="M82 43c8-22 24-26 37-23-7 12-4 24 9 34-18-6-33-5-46 4Z" fill="${color}" stroke="#171921" stroke-width="4" stroke-linejoin="round" />`;
    }
    if (style === "thick") {
      return `<path d="M54 78c4-34 26-55 58-52 29 3 43 25 42 52-18-16-40-22-68-14-15 4-25 10-32 14Z" fill="${color}" stroke="#171921" stroke-width="4" stroke-linejoin="round" />`;
    }
    if (style === "womanLong") {
      return `<path d="M59 71c8-30 27-45 55-41 24 3 37 20 40 45-18-16-38-21-63-15-14 3-25 7-32 11Z" fill="${color}" stroke="#171921" stroke-width="4" stroke-linejoin="round" />`;
    }
    if (style === "womanShort") {
      return `<path d="M59 74c6-28 29-47 56-43 22 3 37 18 40 43-11-7-22-9-34-8-23 3-42 5-62 8Z" fill="${color}" stroke="#171921" stroke-width="4" stroke-linejoin="round" />`;
    }
    return `<path d="M58 75c6-31 27-49 58-45 20 3 35 17 40 40-22-13-44-15-66-9-15 4-25 9-32 14Z" fill="${color}" stroke="#171921" stroke-width="4" stroke-linejoin="round" />`;
  }

  function renderHat(style, color) {
    if (style === "beanie") {
      return `
        <path d="M59 71c4-31 24-48 54-45 26 3 40 21 42 45-32-13-64-13-96 0Z" fill="${color}" stroke="#171921" stroke-width="4" stroke-linejoin="round" />
        <path d="M58 72c28 12 66 12 98 0l3 18c-34 10-70 10-104 0Z" fill="${color}" stroke="#171921" stroke-width="4" />
      `;
    }
    if (style === "turban") {
      return `
        <path d="M57 75c5-29 27-47 57-43 24 3 39 20 42 43-21-11-43-14-66-10-13 2-24 6-33 10Z" fill="${color}" stroke="#171921" stroke-width="4" />
        <path d="M69 67c18 12 43 14 73 5M79 50c14 12 34 16 58 12" stroke="#171921" stroke-width="4" stroke-linecap="round" />
      `;
    }
    return "";
  }

  function renderBrows(style) {
    if (style === "upWoman") {
      return `
        <path d="M68 78c7-7 18-9 27-5" stroke="#171921" stroke-width="4" stroke-linecap="round" />
        <path d="M110 72c9-4 21-2 28 6" stroke="#171921" stroke-width="4" stroke-linecap="round" />
        <path d="M72 70l-6-7M132 70l7-7" stroke="#171921" stroke-width="3" stroke-linecap="round" />
      `;
    }
    return `
      <path d="M68 78c8-6 18-7 27-3" stroke="#171921" stroke-width="4" stroke-linecap="round" />
      <path d="M110 75c9-4 20-3 28 3" stroke="#171921" stroke-width="4" stroke-linecap="round" />
    `;
  }

  function renderEyes(style) {
    if (style === "smile") {
      return `
        <path d="M69 92c6 6 16 6 22 0" stroke="#171921" stroke-width="4" stroke-linecap="round" />
        <path d="M112 92c6 6 16 6 22 0" stroke="#171921" stroke-width="4" stroke-linecap="round" />
      `;
    }
    if (style === "oval") {
      return `
        <ellipse cx="80" cy="92" rx="7" ry="10" fill="#171921" />
        <ellipse cx="121" cy="92" rx="7" ry="10" fill="#171921" />
      `;
    }
    return `
      <circle cx="80" cy="92" r="7" fill="#171921" />
      <circle cx="121" cy="92" r="7" fill="#171921" />
    `;
  }

  function renderGlasses(style) {
    if (style === "round") {
      return `
        <circle cx="80" cy="92" r="16" stroke="#171921" stroke-width="4" />
        <circle cx="121" cy="92" r="16" stroke="#171921" stroke-width="4" />
        <path d="M96 92h9" stroke="#171921" stroke-width="4" stroke-linecap="round" />
      `;
    }
    if (style === "square") {
      return `
        <rect x="63" y="77" width="33" height="29" rx="7" stroke="#171921" stroke-width="4" />
        <rect x="105" y="77" width="33" height="29" rx="7" stroke="#171921" stroke-width="4" />
        <path d="M96 92h9" stroke="#171921" stroke-width="4" stroke-linecap="round" />
      `;
    }
    return "";
  }

  function renderNose(style) {
    if (style === "long") {
      return `<path d="M101 98c-1 13 7 20 0 27-4 4-11 4-16 1" stroke="#171921" stroke-width="4" stroke-linecap="round" />`;
    }
    if (style === "round") {
      return `<path d="M95 108c8-5 17 0 15 9-2 8-13 10-20 4" stroke="#171921" stroke-width="4" stroke-linecap="round" />`;
    }
    return `<path d="M101 101c0 9 5 15 0 20-3 3-8 3-12 1" stroke="#171921" stroke-width="4" stroke-linecap="round" />`;
  }

  function renderMouth(style) {
    if (style === "laugh") {
      return `
        <path d="M74 130c13 18 43 17 55-2-16 5-37 6-55 2Z" fill="#171921" stroke="#171921" stroke-width="4" stroke-linejoin="round" />
        <path d="M90 142c10 5 21 4 29-2" stroke="#FC909F" stroke-width="5" stroke-linecap="round" />
      `;
    }
    if (style === "peace") {
      return `<path d="M76 133c14 12 36 13 51-1" stroke="#171921" stroke-width="4" stroke-linecap="round" />`;
    }
    return `<path d="M77 129c13 16 37 17 51 1" stroke="#171921" stroke-width="4" stroke-linecap="round" />`;
  }

  function renderShirt(style, color) {
    if (style === "polo") {
      return `
        <path d="M42 200c10-38 31-57 58-57s49 19 58 57Z" fill="${color}" stroke="#171921" stroke-width="4" />
        <path d="M82 145l18 25 18-25M82 145l-10 22 26 6M118 145l10 22-26 6" stroke="#171921" stroke-width="4" stroke-linejoin="round" />
      `;
    }
    if (style === "short") {
      return `<path d="M39 200c9-35 30-52 61-52s52 17 61 52Z" fill="${color}" stroke="#171921" stroke-width="4" />`;
    }
    return `
      <path d="M37 200c11-39 32-58 63-58s52 19 63 58Z" fill="${color}" stroke="#171921" stroke-width="4" />
      <path d="M74 150c8 18 17 27 26 27s18-9 26-27" stroke="#171921" stroke-width="4" stroke-linecap="round" />
      <path d="M67 184h66" stroke="#171921" stroke-width="4" stroke-linecap="round" opacity=".32" />
    `;
  }

  function randomProfileSeed(now = Date.now(), random = Math.random) {
    const word = NICE_AVATAR_RANDOM_SEEDS[Math.floor(random() * NICE_AVATAR_RANDOM_SEEDS.length)] || "second";
    return `${word}-${now.toString(36).slice(-4)}-${random().toString(36).slice(2, 6)}`;
  }

  function seededPick(values, seed, key) {
    return values[hashSeed(`${seed}:${key}`) % values.length];
  }

  function randomPick(values, random = Math.random) {
    return values[Math.floor(random() * values.length)] || values[0];
  }

  function weighted(values) {
    return values;
  }

  function hashSeed(value) {
    const text = String(value || "");
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
      hash = (hash << 5) - hash + text.charCodeAt(index);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  function optionValue(key, value, fallback) {
    const text = String(value || "");
    return NICE_AVATAR_OPTIONS[key]?.includes(text) ? text : fallback;
  }

  function colorValue(value, fallback) {
    const text = String(value || "").trim();
    const six = text.match(/^#([0-9a-fA-F]{6})$/);
    if (six) return `#${six[1].toUpperCase()}`;
    const three = text.match(/^#([0-9a-fA-F]{3})$/);
    if (three) {
      return `#${three[1].split("").map((char) => `${char}${char}`).join("").toUpperCase()}`;
    }
    return fallback;
  }

  function escapeHtmlText(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function escapeHtmlAttribute(value) {
    return escapeHtmlText(value).replace(/"/g, "&quot;");
  }

  return {
    NICE_AVATAR_DEFAULT_CONFIG,
    NICE_AVATAR_OPTIONS,
    NICE_AVATAR_RANDOM_SEEDS,
    NICE_AVATAR_SOURCE_URL,
    niceAvatarConfigFromSeed,
    niceAvatarDataUrl,
    niceAvatarSvg,
    niceAvatarUrlFromProfile,
    normalizeNiceAvatarConfig,
    normalizeNiceAvatarShape,
    profileAvatarMarkup,
    profileFormFromState,
    randomNiceAvatarConfig,
    randomProfileSeed,
  };
});
