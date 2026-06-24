import { chromium, Browser, BrowserContext, Page, CDPSession } from 'playwright';

export class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  public page: Page | null = null;
  public cdpSession: CDPSession | null = null;
  public onCdpSessionCreated?: (session: CDPSession) => Promise<void> | void;

    async init(headless: boolean = false) {
        // Launch browser
        this.browser = await chromium.launch({ 
        headless,
        args: ['--disable-blink-features=AutomationControlled'] // basic evasion
    });
    this.context = await this.browser.newContext({
        viewport: { width: 1440, height: 900 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        ignoreHTTPSErrors: true
    });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(5000);
    this.page.on('dialog', async dialog => {
        try {
            await dialog.dismiss();
        } catch {}
    });
    
    // Initialize Chrome DevTools Protocol session
    this.cdpSession = await this.context.newCDPSession(this.page);
    await this.cdpSession.send('Accessibility.enable');
    await this.cdpSession.send('DOM.enable');

    if (this.onCdpSessionCreated) {
        await this.onCdpSessionCreated(this.cdpSession);
    }
    
    // Automatically hijack new tabs (e.g. target="_blank" links)
    this.context.on('page', async (newPage) => {
        console.log('[BrowserManager] New tab opened! Switching context...');
        this.page = newPage;
        this.page.setDefaultTimeout(5000);
        this.page.on('dialog', async dialog => {
            try {
                await dialog.dismiss();
            } catch {}
        });
        // The old page might still exist, but we point our CDP session to the new one
        this.cdpSession = await this.context!.newCDPSession(newPage);
        await this.cdpSession.send('Accessibility.enable');
        await this.cdpSession.send('DOM.enable');
        
        if (this.onCdpSessionCreated) {
            await this.onCdpSessionCreated(this.cdpSession);
        }
    });
  }

  async navigate(url: string) {
    if (!this.page) throw new Error("Browser not initialized");
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  async openTab(url?: string) {
    if (!this.context) throw new Error("Browser not initialized");
    const newPage = await this.context.newPage();
    newPage.setDefaultTimeout(5000);
    newPage.on('dialog', async dialog => {
      try {
        await dialog.dismiss();
      } catch {}
    });
    this.page = newPage;
    this.cdpSession = await this.context.newCDPSession(newPage);
    await this.cdpSession.send('Accessibility.enable');
    await this.cdpSession.send('DOM.enable');

    if (this.onCdpSessionCreated) {
        await this.onCdpSessionCreated(this.cdpSession);
    }

    if (url) {
      await newPage.goto(url, { waitUntil: 'domcontentloaded' });
    }

    return newPage;
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }
}
