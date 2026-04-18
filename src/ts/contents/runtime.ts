interface ChromeStorageResult {
  doNotShowPopup?: boolean;
}

interface MessageResponse {
  req: number | string;
}

interface MessageRequest {
  action: "start";
}

/**
 * Constants & Configuration
 */
const FRIEND_COUNT_SELECTORS = [
    'a[href*="friends"] div.foundation-web-badge span',
    'a[href*="friends"] span.friend-count',
    'a[href*="friends"] .nav-menu-item-text + span'
];

/**
 * Handles all UI-related DOM manipulations
 */
class DOMUtility {
    public static updateLeftNavFriendsCount(count: number | string): void {
        const displayCount = typeof count === 'number' ? count.toLocaleString() : String(count);
        
        for (const selector of FRIEND_COUNT_SELECTORS) {
            const element = document.querySelector<HTMLSpanElement>(selector);
            if (element && element.innerHTML !== displayCount) {
                element.innerHTML = displayCount;
                element.setAttribute('id', 'friendSubLeftNav');
                console.log("Updated left navigation Friends count to:", displayCount);
                break;
            }
        }
    }

    public static waitForElm(selector: string): Promise<Element | null> {
        return new Promise((resolve) => {
            const existing = document.querySelector(selector);
            if (existing) return resolve(existing);

            const observer = new MutationObserver(() => {
                const element = document.querySelector(selector);
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
 * Manages the connection and communication with the Extension Background
 */
class ExtensionMessenger {
    private static backgroundPort: chrome.runtime.Port | null = null;

    private static connect(): chrome.runtime.Port {
        if (this.backgroundPort) return this.backgroundPort;

        this.backgroundPort = chrome.runtime.connect({ name: "friendRequestPort" });
        this.backgroundPort.onDisconnect.addListener(() => {
            console.warn("Background script disconnected.");
            this.backgroundPort = null;
        });
        return this.backgroundPort;
    }

    public static async sendMessageWithRetry(message: MessageRequest, retries = 3, delay = 1000): Promise<MessageResponse> {
        for (let i = 0; i < retries; i++) {
            try {
                const port = this.connect();
                return await new Promise((resolve, reject) => {
                    const timeoutId = setTimeout(() => reject(new Error("Timeout")), 10000);
                    
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
                await new Promise(res => setTimeout(res, delay));
            }
        }
        throw new Error("Communication failed.");
    }
}

/**
 * Handles URL pattern matching
 */
class URLUtility {
    public static isFriendRequestPage(): boolean {
        const url = window.location.href;
        return url.startsWith("https://www.roblox.com/users/") && url.includes("friends#!/friend-requests");
    }
}

/**
 * Monitors the DOM for new elements to apply updates automatically
 */
class FriendCountObserver {
    private static observer: MutationObserver | null = null;
    private static lastCount: number = 0;

    public static init(initialCount: number) {
        this.lastCount = initialCount;
        if (this.observer) return;

        this.observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                const hasAddedNodes = Array.from(mutation.addedNodes).some(node => 
                    node.nodeType === 1 && 
                    FRIEND_COUNT_SELECTORS.some(s => (node as Element).matches(s) || (node as Element).querySelector(s))
                );

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
 * Orchestrator for the entire script logic
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
            const response = await ExtensionMessenger.sendMessageWithRetry({ action: "start" });
            const count = response.req;
            const numCount = typeof count === 'number' ? count : parseInt(String(count)) || 0;

            FriendCountObserver.init(numCount);
            FriendCountObserver.updateLastCount(numCount);

            this.updateUI(count);
        } catch (err) {
            console.error("Refresh failed:", err);
        }
    }

    private static updateUI(count: number | string) {
        const formatted = typeof count === 'number' ? count.toLocaleString() : String(count);
        
        // 1. Update Notification Badges
        const badges = document.getElementsByClassName("notification-blue notification");
        if (badges.length > 0) {
            (badges[0] as HTMLElement).innerHTML = formatted;
            badges[0].setAttribute('id', 'friendSub');
        }

        // 2. Update Left Nav
        DOMUtility.updateLeftNavFriendsCount(count);

        // 3. Update Subtitle if on the right page
        if (URLUtility.isFriendRequestPage()) {
            DOMUtility.waitForElm(".friends-subtitle").then(elm => {
                if (elm && elm.innerHTML.includes("Requests")) {
                    this.updateSubtitle(elm, formatted);
                }
            });
        }
    }

    private static updateSubtitle(container: Element, formattedCount: string) {
        const display = `(${formattedCount})`;
        const countSpan = container.querySelector('span[class*="count"], span[class*="number"]');
        
        if (countSpan) {
            countSpan.textContent = display;
        } else {
            const regex = /\([\d,]+\+?\)|\([\d,]+\)/;
            if (regex.test(container.innerHTML)) {
                container.innerHTML = container.innerHTML.replace(regex, display);
            } else {
                container.innerHTML += ` <span class="text-secondary">${display}</span>`;
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