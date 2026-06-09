interface FriendRequestData {
  data: Record<string, any>[];
  nextPageCursor: string | null;
}

interface MessageResponse {
  req: number | string;
}

interface ChromeTabWithStore extends chrome.tabs.Tab {
  cookieStoreId?: string;
}

class RobloxAPIService {
  private static cacheDuration: number = 60000; // 1 minute cache
  private static cachedCount: number | null = null;
  private static lastFetchTime: number = 0;

  /**
   * Detects if the user has a slow connection based on modern browser APIs.
   * If the Network Information API is unavailable, it defaults to false.
   */
  private static isConnectionSlow(): boolean {
    const nav = navigator as any;
    const connection = nav.connection || nav.mozConnection || nav.webkitConnection;
    
    if (connection) {
      // 1. Check if the user is on an explicit saving mode or slow type
      if (connection.saveData === true) return true;
      if (['slow-2g', '2g', '3g'].includes(connection.effectiveType)) return true;
      
      // 2. Check latency (RTT). If Round Trip Time is > 500ms, it's a slow connection
      if (connection.rtt && connection.rtt > 500) return true;
    }
    return false;
  }

  /**
   * Retrieves the Roblox cookie string from browser storage.
   */
  public static async getRobloxCookie(cookieStoreId?: ChromeTabWithStore["cookieStoreId"]): Promise<string> {
    const query: chrome.cookies.GetAllDetails = { domain: "roblox.com" };
    if (cookieStoreId) query.storeId = cookieStoreId;
    
    const cookies = await chrome.cookies.getAll(query);
    const isAuthenticated = cookies.find((c: chrome.cookies.Cookie) => c.name === ".ROBLOSECURITY");
    if (!isAuthenticated) throw new Error("User is not authenticated.");
    
    return cookies.map((c: chrome.cookies.Cookie) => `${c.name}=${c.value}`).join('; ');
  }

  /**
   * Enhanced helper with an AbortSignal to forcefully cut off hanging/slow requests.
   */
  public static async callRobloxAPI<T>(endpoint: string, cookie: string, signal: AbortSignal, method: string = "GET"): Promise<T> {
    const response: Response = await fetch(endpoint, {
      method,
      signal, // Attach the abort signal here
      headers: {
        "Cookie": cookie,
        "Content-Type": "application/json"
      },
    });
    if (!response.ok) throw new Error(`Roblox API (${method}) failed: ${response.status}`);
    return await response.json() as T;
  }

  /**
   * Evaluates pagination while listening to the abort signal.
   */
  private static async executeFetch(cookie: string, signal: AbortSignal): Promise<number> {
    let total = 0;
    let cursor: string | null = null;

    do {
      const cursorParam = cursor ? `&cursor=${cursor}` : "";
      const url = `https://friends.roblox.com/v1/my/friends/requests?limit=100&sortOrder=Desc${cursorParam}`;
      
      const res: FriendRequestData = await this.callRobloxAPI(url, cookie, signal);
      if (!res?.data) break;
      
      total += res.data.length;
      cursor = res.nextPageCursor;
    } while (cursor);

    return total;
  }

  /**
   * THE TRUE SAFE CALLBACK (Network-Aware & Timeout Protected)
   */
  public static async fetchTotalFriendRequestCount(cookie: string, force = false): Promise<number> {
    const now = Date.now();
    const isSlow = this.isConnectionSlow();

    // 1. Adaptive Cache Strategy:
    // If connection is slow, we aggressively prefer stale cache over making a agonizingly slow network call.
    if (isSlow && this.cachedCount !== null) {
      console.info("[RobloxAPIService] Slow connection detected. Fast-tracking cached fallback.");
      return this.cachedCount;
    }

    // Standard fresh-cache validation
    if (!force && this.cachedCount !== null && (now - this.lastFetchTime < this.cacheDuration)) {
      return this.cachedCount;
    }

    // 2. Setup the Network Timeout (AbortController)
    const controller = new AbortController();
    
    // Set dynamic timeout thresholds: Give a healthy connection 6 seconds, but cut a slow connection off early at 3 seconds
    const timeoutThreshold = isSlow ? 4000 : 7000; 
    
    const timeoutId = setTimeout(() => {
      console.warn(`[RobloxAPIService] Request exceeded ${timeoutThreshold}ms limit. Aborting...`);
      controller.abort();
    }, timeoutThreshold);

    try {
      // 3. Fire the live network operation
      const freshTotal = await this.executeFetch(cookie, controller.signal);
      clearTimeout(timeoutId); // Network completed in time, clear the ticking clock!
      
      this.cachedCount = freshTotal;
      this.lastFetchTime = now;
      return freshTotal;

    } catch (err: any) {
      clearTimeout(timeoutId); // Ensure cleanup on failures too

      const isTimeout = err.name === 'AbortError';
      console.warn(`[RobloxAPIService] Safe Call recovery triggered. Reason: ${isTimeout ? 'Network Timeout' : err.message}`);

      // 4. Tiered Degraded Fallbacks
      if (this.cachedCount !== null) {
        return this.cachedCount; // Serve old data
      }

      return 0; // Absolute worst case scenario safe default
    }
  }
}

class EventListeners {
  public static init() {
    this.onMessage();
    this.onInstalled();
  }

  private static async onMessage() {
    chrome.runtime.onMessage.addListener((request: { action: string }, sender: chrome.runtime.MessageSender, sendResponse: (response: MessageResponse) => void) => {
      if (request.action === "start") {
        // Use an async function to handle the async API call
        (async () => {
          try {
            const storeId = (sender.tab as ChromeTabWithStore)?.cookieStoreId;
            const cookie = await RobloxAPIService.getRobloxCookie(storeId);
            const count = await RobloxAPIService.fetchTotalFriendRequestCount(cookie);
            sendResponse({ req: count });
          } catch (err: any) {
            sendResponse({ req: `Error: ${err.message}` });
          }
        })();
        return true; // Keeps the channel open for the async response
      }
    });
  }

  private static async onInstalled() {
    chrome.runtime.onInstalled.addListener(async(details: chrome.runtime.InstalledDetails) => {
      if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
        try {
          await RobloxAPIService.getRobloxCookie();

          // 1. Create the tab
          const tab = await chrome.tabs.create({ 
            url: "https://www.roblox.com/home"
          });

          // 2. Set up a listener to wait for the page to finish loading
          chrome.tabs.onUpdated.addListener(function listener(tabId: number, info: any) {
            if (tabId === tab.id && info?.status === 'complete') {
              // Remove listener so it doesn't run again
              chrome.tabs.onUpdated.removeListener(listener);
              chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: async function injectOnBoardingModal() {
                 if (document.getElementById("uncapped-friend-requests-modal")) return;
                    const isDark = document.body.classList.contains('dark-theme') || document.documentElement.classList.contains('dark-theme');
                    const modalContainer = document.createElement('div');

                    const shadow = modalContainer.attachShadow({ mode: 'open' });
                    const imageUrl = chrome.runtime.getURL('src/imgs/icon-128.png');
                    const chromeWebStoreURL = ""

                    shadow.innerHTML = `
                      <div class="overlay" id="modal-overlay">
                        <div class="modal-card" id="modal-card">
                          <div class="header">Welcome to Uncapped Friend Requests!</div>
                          <div class="content">
                            <div class="icon-header">
                              <img class="brand-image" src="${imageUrl}" alt="Logo">
                            </div>
                            <p class="main-text">
                              Thanks for installing <b class="highlight">Uncapped Friend Requests</b>!<br>
                              Your standard friend limit has now been lifted.
                            </p>
                            <p class="sub-text">
                              You can manage this feature on your friend requests page.
                            </p>
                            <p class="sub-text">
                              if you like the extension please give it a review on the <a href="${chromeWebStoreURL}" target="_blank">Chrome web store!</a>
                            </p>
                          </div>
                          <div class="actions">
                            <button class="btn-secondary" id="open-friends-btn">Go to Friends</button>
                            <button class="btn-primary" id="close-btn">Okay</button>
                          </div>
                        </div>
                      </div>

                      <style>
                        :host {
                          --bg-card: ${isDark ? '#232527' : '#ffffff'};
                          --bg-overlay: ${isDark ? 'rgba(0, 0, 0, 0.75)' : 'rgba(25, 25, 25, 0.6)'};
                          --bg-header: ${isDark ? '#2b2d2f' : '#f2f4f5'};
                          --text-header: ${isDark ? '#ffffff' : '#191b1d'};
                          --text-main: ${isDark ? '#bdbebe' : '#393b3d'};
                          --text-sub: ${isDark ? '#adb0b1' : '#656667'};
                          --highlight-color: ${isDark ? '#ffffff' : '#000000'};
                          --border-color: ${isDark ? '#393b3d' : '#dee1e3'};
                          --btn-primary-bg: rgb(51, 95, 255);
                          --btn-secondary-bg: ${isDark ? '#393b3d' : '#e3e5e7'};
                        }

                        /* --- Animations --- */
                        @keyframes fadeIn {
                          from { opacity: 0; }
                          to { opacity: 1; }
                        }

                        @keyframes fadeOut {
                          from { opacity: 1; }
                          to { opacity: 0; }
                        }

                        @keyframes popIn {
                          from { opacity: 0; transform: scale(0.8); } 
                          to { opacity: 1; transform: scale(1); } 
                        }

                        @keyframes popOut {
                          from { opacity: 1; transform: scale(1); } 
                          to { opacity: 0; transform: scale(0.8); } 
                        }

                        .overlay {
                          position: fixed; inset: 0; background: var(--bg-overlay);
                          display: flex; align-items: center; justify-content: center;
                          z-index: 2147483647; font-family: 'HCo Gotham SSm', Arial, sans-serif;
                          animation: fadeIn 0.2s ease-out forwards;
                        }

                        .modal-card {
                          background: var(--bg-card); color: var(--text-main); width: 400px; border-radius: 8px;
                          box-shadow: 0 8px 32px rgba(0,0,0,0.4); overflow: hidden; border: 1px solid var(--border-color);
                          animation: popIn 0.3s cubic-bezier(0.3, 0.5, 0, 1.15) forwards;
                        }

                        /* Exit Classes - Triggered by JS */
                        .overlay.closing { animation: fadeOut 0.15s ease-in forwards; }
                        .modal-card.closing { animation: popOut 0.15s ease-in forwards; }

                        /* --- Buttons & Rest of Style --- */
                        .header { padding: 15px; text-align: center; font-size: 16px; font-weight: 700; background: var(--bg-header); color: var(--text-header); border-bottom: 1px solid var(--border-color); }
                        .content { padding: 25px; text-align: center; }
                        .brand-image { width: 80px; height: 80px; margin-bottom: 15px; border-radius: 12px; }
                        .main-text { font-size: 15px; margin-bottom: 10px; line-height: 1.4; }
                        .sub-text { font-size: 13px; color: var(--text-sub); }
                        .actions { padding: 0 25px 25px; display: flex; gap: 10px; }
                        button { flex: 1; padding: 10px; border-radius: 8px; border: none; font-weight: 600; cursor: pointer; font-size: 14px; transition: transform 0.1s ease, background 0.1s ease; user-select: none; }
                        button:active { transform: scale(0.95); }
                        .btn-primary { background: var(--btn-primary-bg); color: #fff; }
                        .btn-secondary { background: var(--btn-secondary-bg); color: var(--text-header); border: 1px solid var(--border-color); }
                        .btn-secondary:hover { opacity: 0.8; }
                      </style>
                    `;
                    modalContainer.id = "uncapped-friend-requests-modal";
                    document.body.appendChild(modalContainer);

                    const card = shadow.getElementById('modal-card');
                    const overlay = shadow.getElementById('modal-overlay');

                    /**
                     * Refactored Close Logic
                     */
                    const closeModal = (callBack?: () => void) => {
                      // 1. Add closing classes to trigger keyframes
                      card?.classList.add('closing');
                      overlay?.classList.add('closing');

                      // 2. Wait for animation to finish (150ms) before removing from DOM
                      setTimeout(() => {
                        modalContainer.remove();
                        if (typeof callBack === 'function') callBack();
                      }, 150);
                    };

                    shadow.getElementById('close-btn')?.addEventListener('click', () => closeModal());
                    shadow.getElementById('open-friends-btn')?.addEventListener('click', () => {
                      closeModal(() => {
                        window.location.href = "https://www.roblox.com/users/friends#!/friend-requests";
                      });
                    }
                  );
                }
              })
            }
          })
        } catch {
          await chrome.tabs.create({ url: `https://www.roblox.com/login` });
        }
      }
    });
  }
}

EventListeners.init();