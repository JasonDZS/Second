"use strict";

function cleanSlackText(text) {
  return String(text || "")
    .replace(/<@[A-Z0-9]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeSlack(text) {
  return String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function chunkSlackText(text, maxLength) {
  const source = String(text || "");
  if (!source) return [];
  const chunks = [];
  let rest = source;
  while (rest.length > maxLength) {
    const window = rest.slice(0, maxLength);
    const splitAt = Math.max(
      window.lastIndexOf("\n\n"),
      window.lastIndexOf("\n"),
      window.lastIndexOf("。"),
      window.lastIndexOf(". "),
    );
    const cut = splitAt > maxLength * 0.5 ? splitAt + 1 : maxLength;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function truncateSlackPlainText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function truncateSlackButtonText(text) {
  const value = String(text || "选择").trim();
  return value.length > 72 ? `${value.slice(0, 69)}...` : value;
}

function validHttpsUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

module.exports = {
  chunkSlackText,
  cleanSlackText,
  escapeSlack,
  truncateSlackButtonText,
  truncateSlackPlainText,
  validHttpsUrl,
};
