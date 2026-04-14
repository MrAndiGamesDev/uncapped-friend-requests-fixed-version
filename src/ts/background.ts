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

  const modalContainer = document.createElement('div');
  modalContainer.id = "uncapped-requests-modal";
  
  const shadow = modalContainer.attachShadow({mode: 'open'});

  // Resolve the extension-internal URL for the image
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
            Thanks for installing <b style="color: white;">Uncapped Friend Requests</b>!
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
      .overlay {
        position: fixed; inset: 0; background: rgba(0, 0, 0, 0.85);
        display: flex; align-items: center; justify-content: center;
        z-index: 2147483647; font-family: 'HCo Gotham SSm', "Helvetica Neue", Helvetica, Arial, sans-serif;
      }
      .modal-card {
        background: #191b1d; color: white; width: 440px; border-radius: 12px;
        box-shadow: 0 12px 48px rgba(0,0,0,0.6); overflow: hidden; border: 1px solid #333;
      }
      .header {
        padding: 20px; text-align: center; font-size: 19px; font-weight: 700;
        border-bottom: 1px solid #333; background: #232527; letter-spacing: -0.5px;
      }
      
      .content { padding: 30px; text-align: center; line-height: 1.5; }
      
      /* Updated Icon CSS */
      .icon-header { margin-bottom: 25px; display: flex; justify-content: center; }
      .brand-image {
        width: 80px; height: 80px; border-radius: 16px; /* Mimics image rounding */
        box-shadow: 0 4px 10px rgba(0,0,0,0.3); /* Slight depth */
      }

      .main-text { font-size: 15px; color: #eee; margin-bottom: 15px; font-weight: 500; }
      p.sub-text { font-size: 13px; color: #bbb; margin-bottom: 25px; }
      
      .footer-text { font-size: 12px; margin-top: 20px; color: #999; }
      b { color: white; }

      .actions { padding: 20px; display: flex; gap: 12px; border-top: 1px solid #333; background: #1f2123;}
      button {
        flex: 1; padding: 12px; border-radius: 8px; border: none; 
        font-weight: 600; cursor: pointer; font-size: 14px; transition: background 0.2s;
      }
      .btn-primary { background: rgb(51, 95, 255); color: #eee; }
      .btn-primary:hover { background: #4477ff; }
      .btn-secondary { background: #333; color: white; }
      .btn-secondary:hover { background: #444; }
    </style>
  `;

  shadow.innerHTML = html;
  document.body.appendChild(modalContainer);

  // Okay Button Logic
  shadow.getElementById('close-btn')!.addEventListener('click', () => {
    modalContainer.remove();
  });

  // Second Action Button Logic
  shadow.getElementById('open-friends-btn')!.addEventListener('click', () => {
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