import i18next from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";
import zhCN from "./locales/zh-CN.json";

export const LANGS = ["en", "zh-CN"] as const;
export type Lang = (typeof LANGS)[number];
const STORAGE_KEY = "broom-lang";

function detect(): Lang {
  if (typeof window === "undefined") return "en";
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "zh-CN") return saved;
  } catch {
    /* storage unavailable */
  }
  const nav = (window.navigator.language || "").toLowerCase();
  return nav.startsWith("zh") ? "zh-CN" : "en";
}

void i18next.use(initReactI18next).init({
  resources: { en: { translation: en }, "zh-CN": { translation: zhCN } },
  lng: detect(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  returnNull: false,
});

export function setLang(lang: Lang) {
  void i18next.changeLanguage(lang);
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* ignore */
  }
}

export function toggleLang() {
  setLang(i18next.language === "zh-CN" ? "en" : "zh-CN");
}

export const i18n = i18next;
