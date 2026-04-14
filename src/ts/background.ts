interface FriendRequestData {
  data: Record<string, any>[]; // Replaced 'any[]' with a slightly stricter type
  nextPageCursor: string | null;
}

interface MessageResponse {
  req: number | string;
}

/**
 * Retrieves the Roblox cookie string from the browser storage.
 */
async function getRobloxCookie(): Promise<string> {
  const cookies = await chrome.cookies.getAll({ domain: "roblox.com" });
  
  if (!cookies || cookies.length === 0) {
    throw new Error("No Roblox cookies found. Please log in.");
  }

  // Efficiently join cookie names and values
  return cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

/**
 * A generalized helper to call Roblox APIs with the correct credentials.
 * @param endpoint The full URL or path for the API
 * @param method GET, POST, etc.
 */
async function callRobloxAPI<T>(endpoint: string, method: string = "GET"): Promise<T> {
  const rawCookie = await getRobloxCookie();

  const response = await fetch(endpoint, {
    method,
    headers: {
      "Cookie": rawCookie,
      "Content-Type": "application/json",
    }
  });

  if (!response.ok) {
    throw new Error(`Roblox API (${method}) failed: ${response.status} ${response.statusText}`);
  }

  return await response.json() as T;
}

/**
 * Updated fetch logic using the generalized API helper
 */
async function fetchTotalFriendRequestCount(): Promise<number> {
  let totalRequests = 0;
  let cursor = "";
  let hasNextPage = true;

  while (hasNextPage) {
    const url = `https://friends.roblox.com/v1/my/friends/requests?limit=100&cursor=${encodeURIComponent(cursor)}&sortOrder=Desc`;
    
    // Call our new helper function
    const RequestData = await callRobloxAPI<FriendRequestData>(url);

    if (RequestData.data && RequestData.data.length > 0) {
      totalRequests += RequestData.data.length;
      cursor = RequestData.nextPageCursor || "";
      hasNextPage = !!cursor;
    } else {
      hasNextPage = false;
    }
  }
  
  return totalRequests;
}

/**
 * Injects a branded onboarding modal for 'uncapped-friend-requests-roblox'
 * using the custom provided image.
 */
function injectRobloxModal() {
  if (document.getElementById("uncapped-requests-modal")) return;

  // Detect Roblox site theme
  const isRobloxDark = document.body.classList.contains('dark-theme') || 
                       document.documentElement.classList.contains('dark-theme');

  const modalContainer = document.createElement('div');
  modalContainer.id = "uncapped-requests-modal";
  const shadow = modalContainer.attachShadow({mode: 'open'});

  const imageUrl = chrome.runtime.getURL('src/imgs/icon-128.png');

  const html = `
    <div class="overlay">
      <div class="modal-card">
        <div class="header">
          Welcome to Uncapped Friend Requests!
        </div>
        
        <div class="content">
          <div class="icon-header">
            <img class="brand-image" src="${imageUrl}" alt="Uncapped requests logo">
          </div>

          <p class="main-text">
            Thanks for installing <b class="highlight">Uncapped Friend Requests</b>!
            Your standard Roblox friend request limit has now been lifted.
          </p>
          
          <p class="sub-text">
            You are now free to send and receive thousands of friend requests! You can manage this feature on the Roblox friend requests page.
          </p>
          
          <p class="footer-text">
            If you enjoy the freedom, please consider leaving a review on the <b>Chrome Web Store</b>.
          </p>
        </div>

        <div class="actions">
          <button class="btn-secondary" id="open-friends-btn">Go to Friends Page</button>
          <button class="btn-primary" id="close-btn">Okay</button>
        </div>
      </div>
    </div>

    <style>
      :host {
        /* --- DYNAMIC THEME VARIABLES --- */
        --bg-card: ${isRobloxDark ? '#232527' : '#ffffff'};
        --bg-overlay: ${isRobloxDark ? 'rgba(0, 0, 0, 0.7)' : 'rgba(25, 25, 25, 0.5)'};
        
        /* Header Logic */
        --bg-header: ${isRobloxDark ? '#2b2d2f' : '#f2f4f5'};
        --text-header: ${isRobloxDark ? '#ffffff' : '#191b1d'};
        
        /* Text Logic */
        --text-main: ${isRobloxDark ? '#bdbebe' : '#393b3d'};
        --text-sub: ${isRobloxDark ? '#adb0b1' : '#656667'};
        --highlight-color: ${isRobloxDark ? '#ffffff' : '#000000'};
        
        /* Border Logic */
        --border-color: ${isRobloxDark ? '#393b3d' : '#dee1e3'};
        
        /* Button Logic */
        --btn-primary-bg: rgb(51, 95, 255);
        --btn-primary-text: #ffffff;
        --btn-secondary-bg: ${isRobloxDark ? '#393b3d' : '#e3e5e7'};
        --btn-secondary-text: ${isRobloxDark ? '#ffffff' : '#393b3d'};
      }

      .overlay {
        position: fixed; inset: 0; background: var(--bg-overlay);
        display: flex; align-items: center; justify-content: center;
        z-index: 2147483647; font-family: 'HCo Gotham SSm', "Helvetica Neue", Helvetica, Arial, sans-serif;
      }
      .modal-card {
        background: var(--bg-card); color: var(--text-main); width: 440px; border-radius: 8px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.3); overflow: hidden; border: 1px solid var(--border-color);
      }
      .header {
        padding: 18px; text-align: center; font-size: 18px; font-weight: 700;
        border-bottom: 1px solid var(--border-color); 
        background: var(--bg-header); 
        color: var(--text-header); 
      }
      
      .content { padding: 25px 35px; text-align: center; }
      .icon-header { margin-bottom: 20px; display: flex; justify-content: center; }
      .brand-image { width: 90px; height: 90px; border-radius: 12px; }

      .main-text { font-size: 15px; color: var(--text-main); margin: 0 0 12px; line-height: 1.5; }
      .highlight { color: var(--highlight-color); font-weight: 700; }
      .sub-text { font-size: 13px; color: var(--text-sub); margin: 0 0 20px; line-height: 1.5; }
      .footer-text { font-size: 12px; color: var(--text-sub); margin: 15px 0 0; }
      
      .actions { padding: 10px 25px 25px; display: flex; gap: 12px; background: var(--bg-card); }
      
      button {
        flex: 1; padding: 10px; border-radius: 4px; border: none; 
        font-weight: 600; cursor: pointer; font-size: 14px; transition: 0.1s;
      }
      .btn-primary { background: var(--btn-primary-bg); color: var(--btn-primary-text); }
      .btn-primary:hover { background: #4477ff; }
      
      .btn-secondary { 
        background: var(--btn-secondary-bg); 
        color: var(--btn-secondary-text); 
        border: 1px solid var(--border-color); 
      }
      .btn-secondary:hover { opacity: 0.8; }
    </style>
  `;

  shadow.innerHTML = html;
  document.body.appendChild(modalContainer);

  shadow.getElementById('close-btn')?.addEventListener('click', () => modalContainer.remove());
  shadow.getElementById('open-friends-btn')?.addEventListener('click', () => {
    window.location.href = "https://www.roblox.com/users/friends#!/friend-requests";
    modalContainer.remove();
  });
}

/**
 * Listener for the persistent Port connection (from Content Script)
 */
chrome.runtime.onConnect.addListener((port: chrome.runtime.Port) => {
  if (port.name !== "friendRequestPort") return;
  port.onMessage.addListener(async(message: { action: string }) => {
    if (message.action === "start") {
      try {
        const count = await fetchTotalFriendRequestCount();
        port.postMessage({ req: count } as MessageResponse);
      } catch (error: any) {
        console.error("Background fetch error:", error);
        port.postMessage({ req: `Error: ${error.message}` } as MessageResponse);
      }
    }
  });
});

/**
 * Optional: Listener for one-time messages
 */
chrome.runtime.onMessage.addListener(async(request: { action: string }, _sender: chrome.runtime.MessageSender, sendResponse: (response: MessageResponse) => void) => {
  if (request.action === "start") {
      try {
        const count = await fetchTotalFriendRequestCount();
        sendResponse({ req: count } as MessageResponse);
      } catch (error: any) {
        console.error("Background fetch error:", error);
        sendResponse({ req: `Error: ${error.message}` } as MessageResponse);
      }
    };
    return true;
  }
);

/**
 * Installation Logic
 */
chrome.runtime.onInstalled.addListener(async (details: chrome.runtime.InstalledDetails) => {
  if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
    try {
      await getRobloxCookie();

      // 1. Create the tab
      const tab = await chrome.tabs.create({ 
        url: "https://www.roblox.com/home" 
      });

      // 2. Set up a listener to wait for the page to finish loading
      chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
        if (tabId === tab.id && info.status === 'complete') {
          // Remove listener so it doesn't run again
          chrome.tabs.onUpdated.removeListener(listener);
          // 3. Inject the modal logic
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: injectRobloxModal
          });
        }
      });
    } catch {
      chrome.tabs.create({ url: `https://www.roblox.com/login` });
    }
  }
});