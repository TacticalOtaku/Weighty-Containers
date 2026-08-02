import { MODULE_ID } from "../constants.js";

export function normalizeToken(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function parseTokenList(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeToken).filter(Boolean);
  }
  return String(value ?? "")
    .split(/[,\n;]/)
    .map(normalizeToken)
    .filter(Boolean);
}

export function getContainerRestrictions(containerItem) {
  const flags = containerItem?.flags?.[MODULE_ID] ?? {};
  return {
    allowedTypes: parseTokenList(flags.allowedTypes),
    allowedSubtypes: parseTokenList(flags.allowedSubtypes),
    requiredProperties: parseTokenList(flags.requiredProperties),
    forbiddenProperties: parseTokenList(flags.forbiddenProperties),
    propertyMatchMode: flags.propertyMatchMode === "any" ? "any" : "all"
  };
}

export function getItemPropertyTokens(itemData) {
  const properties = itemData?.system?.properties;
  const tokens = new Set();
  if (properties instanceof Set || Array.isArray(properties)) {
    for (const property of properties) tokens.add(normalizeToken(property));
  } else if (properties && typeof properties === "object") {
    for (const [key, value] of Object.entries(properties)) {
      if (value) tokens.add(normalizeToken(key));
    }
  } else if (properties) {
    tokens.add(normalizeToken(properties));
  }
  tokens.delete("");
  return tokens;
}

export function getItemMatchTokens(itemData, weaponTypeMap = {}) {
  const tokens = new Set();
  const add = value => {
    const token = normalizeToken(value);
    if (token) tokens.add(token);
  };

  add(itemData?.type);
  const typeData = itemData?.system?.type;
  if (typeData && typeof typeData === "object") {
    add(typeData.value);
    add(typeData.subtype);
    add(typeData.baseItem);
    add(typeData.identifier);
    add(weaponTypeMap[typeData.value]);
  }

  const attackType = itemData?.system?.attackType;
  add(typeof attackType === "function" ? null : attackType);
  for (const property of getItemPropertyTokens(itemData)) add(property);
  return tokens;
}

export function validateContainerRestrictions(
  containerItem,
  itemData,
  { weaponTypeMap = {} } = {}
) {
  const restrictions = getContainerRestrictions(containerItem);
  if (!restrictions.allowedTypes.length
      && !restrictions.allowedSubtypes.length
      && !restrictions.requiredProperties.length
      && !restrictions.forbiddenProperties.length) {
    return { ok: true, restrictions };
  }

  const itemType = normalizeToken(itemData?.type);
  if (restrictions.allowedTypes.length
      && !restrictions.allowedTypes.includes(itemType)) {
    return { ok: false, reason: "type", restrictions };
  }

  const matchTokens = getItemMatchTokens(itemData, weaponTypeMap);
  if (restrictions.allowedSubtypes.length
      && !restrictions.allowedSubtypes.some(token => matchTokens.has(token))) {
    return { ok: false, reason: "subtype", restrictions };
  }

  const propertyTokens = getItemPropertyTokens(itemData);
  const requiredMatches = restrictions.propertyMatchMode === "any"
    ? restrictions.requiredProperties.some(token => propertyTokens.has(token))
    : restrictions.requiredProperties.every(token => propertyTokens.has(token));
  if (restrictions.requiredProperties.length && !requiredMatches) {
    return { ok: false, reason: "property", restrictions };
  }

  if (restrictions.forbiddenProperties.some(token => propertyTokens.has(token))) {
    return { ok: false, reason: "forbiddenProperty", restrictions };
  }

  return { ok: true, restrictions };
}
