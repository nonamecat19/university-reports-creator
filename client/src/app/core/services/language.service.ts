import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

const STORAGE_KEY = 'preferred_language';
const SUPPORTED = ['en', 'uk'] as const;

@Injectable({ providedIn: 'root' })
export class LanguageService {
  private translate = inject(TranslateService);

  constructor() {
    this.translate.addLangs([...SUPPORTED]);

    const saved = this.getSaved();
    this.translate.use(saved);

    this.updateHtmlLang(saved);
  }

  get current(): string {
    return this.translate.getCurrentLang() ?? 'en';
  }

  setLanguage(lang: string): void {
    if (!SUPPORTED.includes(lang as typeof SUPPORTED[number])) return;
    this.translate.use(lang);
    this.save(lang);
    this.updateHtmlLang(lang);
  }

  private getSaved(): string {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && SUPPORTED.includes(saved as typeof SUPPORTED[number])) {
      return saved;
    }
    return this.detectBrowserLang();
  }

  private detectBrowserLang(): string {
    const browserLang = navigator.language;
    if (browserLang.startsWith('uk')) return 'uk';
    return 'en';
  }

  private save(lang: string): void {
    localStorage.setItem(STORAGE_KEY, lang);
  }

  private updateHtmlLang(lang: string): void {
    document.documentElement.setAttribute('lang', lang);
  }
}
