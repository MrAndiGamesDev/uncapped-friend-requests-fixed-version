interface MessageResponse {
  req: number | string;
}

interface MessageRequest {
  action: "start";
}

interface FriendCountSelectors {
  targetSelectors: string[];
}

/**
 * Holds the selectors used to target friend count elements in the DOM
 */
class GetFriendCountSelectors {
    public static readonly targetSelectors: FriendCountSelectors["targetSelectors"] = [
        'a[href*="friends"] div.foundation-web-badge span',
        'a[href*="friends"] span.friend-count',
        'a[href*="friends"] .nav-menu-item-text + span'
    ];

    public static getSelectors(): FriendCountSelectors["targetSelectors"] {
        return this.targetSelectors;
    }
}

/**
 * Handles all UI-related DOM manipulations, such as updating friend counts
 */
class DOMUtility {
    public static updateLeftNavFriendsCount(count: number | string): void {
        const displayCount = typeof count === 'number' ? count.toLocaleString() : String(count);
        for (const selector of GetFriendCountSelectors.getSelectors()) {
            const element: HTMLSpanElement | null = document.querySelector<HTMLSpanElement>(selector);
            if (element && element.innerHTML !== displayCount) {
                element.innerHTML = displayCount;
                element.setAttribute('id', 'friendSubLeftNav');
                break;
            }
        }
    }

    public static waitForElm(selector: string): Promise<Element | null> {
        return new Promise((resolve: (value: Element | null | PromiseLike<Element | null>) => void) => {
            const existing: Element | null = document.querySelector(selector);
            if (existing) return resolve(existing);
            const observer: MutationObserver = new MutationObserver(() => {
                const element: HTMLSpanElement | null = document.querySelector(selector);
                if (element) {
                    resolve(element);
                    observer.disconnect();
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
        });
    }
}

/**
 * Manages the connection and communication with the Extension Background Script
 */
class ExtensionMessenger {
    private static backgroundPort: chrome.runtime.Port | null = null;

    private static connect(): chrome.runtime.Port {
        if (this.backgroundPort) return this.backgroundPort;
        this.backgroundPort = chrome.runtime.connect({ name: "friendRequestPort" });
        this.backgroundPort.onDisconnect.addListener(() => {
            this.backgroundPort = null;
        });
        return this.backgroundPort;
    }

    public static async sendMessageWithRetry(message: MessageRequest, retries: number = 3, delay: number = 1000): Promise<MessageResponse> {
        for (let i = 0; i < retries; i++) {
            try {
                const port: chrome.runtime.Port = this.connect();
                return await new Promise<MessageResponse>((resolve: (value: MessageResponse | PromiseLike<MessageResponse>) => void, reject: (reason?: any) => void) => {
                    const timeoutId: number = setTimeout(() => reject(new Error("Timeout")), 10000);
                    const handler = (response: MessageResponse) => {
                        clearTimeout(timeoutId);
                        port.onMessage.removeListener(handler);
                        resolve(response);
                    };
                    port.onMessage.addListener(handler);
                    port.postMessage(message);
                });
            } catch (error: any) {
                if (i === retries - 1) throw error;
                await new Promise((resolve: (value: unknown) => void) => setTimeout(resolve, delay));
            }
        }
        throw new Error("Communication failed.");
    }
}

/**
 * Handles URL pattern matching to determine if the current page is a friend requests page
 */
class URLUtility {
    public static isFriendRequestPage(): boolean {
        const url: string = window.location.href;
        return url.startsWith("https://www.roblox.com/users/") && url.includes("friends#!/friend-requests");
    }
}

/**
 * Monitors the DOM for new elements to apply updates automatically when friend counts change
 */
class FriendCountObserver {
    private static observer: MutationObserver | null = null;
    private static lastCount: number = 0;

    public static init(initialCount: number) {
        this.lastCount = initialCount;
        if (this.observer) return;
        this.observer = new MutationObserver((mutations: MutationRecord[]) => {
            for (const mutation of mutations) {
                const selectors: string[] = GetFriendCountSelectors.getSelectors();
                const hasAddedNodes: boolean = Array.from(mutation.addedNodes).some(node => node.nodeType === 1 && selectors.some((s: string) => (node as Element).matches(s) || (node as Element).querySelector(s)));
                if (hasAddedNodes && this.lastCount > 0) {
                    DOMUtility.updateLeftNavFriendsCount(this.lastCount);
                    break;
                }
            }
        });
        this.observer.observe(document.body, { childList: true, subtree: true });
    }

    public static updateLastCount(count: number) {
        this.lastCount = count;
    }
}

/**
 * Orchestrator for the entire script logic, including initial setup, periodic updates, and cleanup
 */
class AppController {
    private static updateInterval: number | null = null;

    public static async start() {
        await this.refresh();
        this.updateInterval = window.setInterval(() => this.refresh(), 1000);
        window.addEventListener("beforeunload", () => {
            if (this.updateInterval) clearInterval(this.updateInterval);
        });
    }

    private static async refresh() {
        try {
            const response: MessageResponse = await ExtensionMessenger.sendMessageWithRetry({ action: "start" });
            const count: number | string = response.req;
            const numCount: number = typeof count === 'number' ? count : parseInt(String(count)) || 0;
            FriendCountObserver.init(numCount);
            FriendCountObserver.updateLastCount(numCount);
            this.updateUI(count);
        } catch (err) {
            console.error("Refresh failed:", err);
        }
    }

    private static updateUI(count: number | string) {
        const formatted: string = typeof count === 'number' ? count.toLocaleString() : String(count);
        
        // 1. Update Notification Badges
        const badges: HTMLCollectionOf<Element> = document.getElementsByClassName("notification-blue notification");
        const element: HTMLElement | null = badges[0] as HTMLElement;

        if (badges && badges.length > 0) {
            if (element) {
                element.innerHTML = formatted;
                element.setAttribute('id', 'friendSub');
            }
        }
        
        // 2. Update Left Nav Friends Count
        DOMUtility.updateLeftNavFriendsCount(count);

        // 3. Update Subtitle if on the right page
        if (URLUtility.isFriendRequestPage()) {
            DOMUtility.waitForElm(".friends-subtitle").then((elm: Element | null) => {
                if (elm && elm.innerHTML.includes("Requests")) {
                    this.updateSubtitle(elm, formatted);
                }
            });
        }
    }

    private static updateSubtitle(container: Element, formattedCount: string) {
        const display: string = `(${formattedCount})`;
        const countSpan: HTMLElement | null = container.querySelector('span[class*="count"], span[class*="number"]');
        if (countSpan) {
            countSpan.textContent = display;
        } else {
            const regex: RegExp = /\([\d,]+\+?\)|\([\d,]+\)/;
            if (regex.test(container.innerHTML)) {
                container.innerHTML = container.innerHTML.replace(regex, display);
            } else {
                container.innerHTML += `<span class="text-secondary">${display}</span>`;
            }
        }
    }
}

// Execution Entry Point
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => AppController.start());
} else {
    AppController.start();
}