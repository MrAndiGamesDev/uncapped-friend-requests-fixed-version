interface FriendRequestData {
  data: any[];
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
    const data = await callRobloxAPI<FriendRequestData>(url);

    if (data.data && data.data.length > 0) {
      totalRequests += data.data.length;
      cursor = data.nextPageCursor || "";
      hasNextPage = !!cursor;
    } else {
      hasNextPage = false;
    }
  }
  return totalRequests;
}

/**
 * Listener for the persistent Port connection (from Content Script)
 */
chrome.runtime.onConnect.addListener((port: chrome.runtime.Port) => {
  if (port.name !== "friendRequestPort") return;
  port.onMessage.addListener(async(message: any) => {
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
chrome.runtime.onMessage.addListener((request: any, sender: chrome.runtime.MessageSender, sendResponse: (response: MessageResponse) => void) => {
  if (request.action === "start") {
    const fetchFriendRequestCount = async () => {
      try {
        const count = await fetchTotalFriendRequestCount();
        sendResponse({ req: count } as MessageResponse);
      } catch (error: any) {
        console.error("Background fetch error:", error);
        sendResponse({ req: `Error: ${error.message}` } as MessageResponse);
      }
    };
    fetchFriendRequestCount();
    return true; 
  }
});