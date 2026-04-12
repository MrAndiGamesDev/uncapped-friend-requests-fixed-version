interface RobloxCookie {
  name: string;
  value: string;
}

interface FriendRequestData {
  data: any[]; // Adjust this interface based on the actual data structure if needed
  nextPageCursor: string | null;
}

interface MessageRequest {
  action: "start";
}

interface MessageResponse {
  req: number | string;
}

async function getRobloxCookie(): Promise<string> {
  let rawCookie: string = "";
  const cookies: RobloxCookie[] = await new Promise((resolve) => {
    chrome.cookies.getAll({ domain: "roblox.com" }, resolve);
  });

  for (const cookie of cookies) {
    rawCookie += `${cookie.name}=${cookie.value}; `;
  }

  if (!rawCookie) {
    throw new Error("No cookies found.");
  }

  return rawCookie.slice(0, -2); // Remove trailing space and semicolon
}

async function fetchFriendRequests(rawCookie: string): Promise<number> {
  let totalRequests: number = 0;
  let cursor: string = "";
  let hasNextPage: boolean = true;

  while (hasNextPage) {
    const url = `https://friends.roblox.com/v1/my/friends/requests?limit=100&cursor=${encodeURIComponent(cursor)}&sortOrder=Desc`;
    const requestOptions: RequestInit = {
      method: "GET",
      headers: {
        Cookie: rawCookie,
      },
    };

    const response = await fetch(url, requestOptions);
    const data: FriendRequestData = await response.json();

    if (data.data && data.data.length > 0) {
      totalRequests += data.data.length;
      console.log("Friend Requests:", totalRequests);
      cursor = data.nextPageCursor || "";
      hasNextPage = !!cursor;
    } else {
      hasNextPage = false;
    }
  }
  return totalRequests;
}

function handleMessage(request: MessageRequest, sender: chrome.runtime.MessageSender, sendResponse: (response: MessageResponse) => void): boolean {
  // If it returns false or nothing, the message channel closes before sendResponse can be called.
  if (request.action === "start") {
    // This function must return true to indicate that sendResponse will be called asynchronously.
    (async () => {
      try {
        const rawCookie = await getRobloxCookie();
        const totalRequests = await fetchFriendRequests(rawCookie);
        sendResponse({ req: totalRequests });
      } catch (error: any) {
        console.error("Friend request fetching error:", error);
        sendResponse({ req: `Error: ${error.message}` });
      }
    })();
    return true; // Important: Return true to keep the message channel open
  }
  return false; // Return false if the message was not handled asynchronously
}

function connectToFriendRequestPort(port: chrome.runtime.Port): void {
  if (port.name === "friendRequestPort") {
    console.log("Content script connected to background script.");
    port.onMessage.addListener(async function(request: MessageRequest) {
      if (request.action === "start") {
        try {
          const rawCookie = await getRobloxCookie();
          const totalRequests = await fetchFriendRequests(rawCookie);
          port.postMessage({ req: totalRequests });
        } catch (error: any) {
          console.error("Friend request fetching error:", error);
          port.postMessage({ req: `Error: ${error.message}` });
        }
      }
    });
    port.onDisconnect.addListener(function() {
      console.log("Content script disconnected from background script.");
    });
  }
}

chrome.runtime.onMessage.addListener(handleMessage);
chrome.runtime.onConnect.addListener(connectToFriendRequestPort);