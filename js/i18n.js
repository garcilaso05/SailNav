const DEFAULT_LANG = 'en';
const SUPPORTED_LANGS = ['en', 'es', 'ca', 'fr', 'de', 'it'];
const STORAGE_KEY = 'sailnav.lang';

const dictionaries = new Map();
let currentLang = DEFAULT_LANG;

function normalizeLang(lang) {
  if (!lang) return DEFAULT_LANG;
  const short = lang.toLowerCase().split('-')[0];
  return SUPPORTED_LANGS.includes(short) ? short : DEFAULT_LANG;
}

async function loadDictionary(lang) {
  const normalized = normalizeLang(lang);
  if (dictionaries.has(normalized)) {
    return dictionaries.get(normalized);
  }

  const url = new URL(`../i18n/${normalized}.json`, import.meta.url);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load language file: ${normalized}`);
  }

  const dict = await response.json();
  dictionaries.set(normalized, dict);
  return dict;
}

function interpolate(template, params = {}) {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const value = params[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

export function t(key, params = {}) {
  const active = dictionaries.get(currentLang) || {};
  const fallback = dictionaries.get(DEFAULT_LANG) || {};
  const raw = active[key] ?? fallback[key] ?? key;
  return interpolate(raw, params);
}

export function getCurrentLanguage() {
  return currentLang;
}

export function applyTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });

  root.querySelectorAll('[data-i18n-attr]').forEach(el => {
    const entries = el.dataset.i18nAttr.split(',').map(s => s.trim()).filter(Boolean);
    entries.forEach(entry => {
      const [attr, key] = entry.split(':').map(s => s.trim());
      if (!attr || !key) return;
      el.setAttribute(attr, t(key));
    });
  });
}

export async function setLanguage(lang, { persist = true } = {}) {
  const normalized = normalizeLang(lang);

  // Ensure default dictionary is always available for fallback lookups.
  if (!dictionaries.has(DEFAULT_LANG)) {
    await loadDictionary(DEFAULT_LANG);
  }

  await loadDictionary(normalized);
  currentLang = normalized;

  document.documentElement.lang = normalized;

  if (persist) {
    localStorage.setItem(STORAGE_KEY, normalized);
  }

  applyTranslations();

  window.dispatchEvent(new CustomEvent('i18n:changed', {
    detail: { language: normalized }
  }));
}

export async function initI18n() {
  const stored = localStorage.getItem(STORAGE_KEY);
  const browser = normalizeLang(navigator.language);
  const initial = normalizeLang(stored || browser || DEFAULT_LANG);

  await setLanguage(initial, { persist: false });

  const selector = document.getElementById('language-select');
  if (selector) {
    selector.value = currentLang;
    selector.addEventListener('change', e => {
      setLanguage(e.target.value).catch(err => {
        console.error('Language switch failed:', err);
      });
    });
  }
}
