interface ChromeStorageResult {
  doNotShowPopup?: boolean;
}

interface MessageResponse {
  req: number | string;
}

interface MessageRequest {
  action: "start";
}

// Validate The variables
let doNotShowPopup: boolean = false;
let lastKnownFriendCount: number = 0;

// Global interval for updating friend count
let updateInterval: number;
let backgroundPort: chrome.runtime.Port | undefined;

// Global selectors for friend count elements
const FRIEND_COUNT_SELECTORS = [
  'a[href*="friends"] div.foundation-web-badge span', // Most specific, original selector
  'a[href*="friends"] span.friend-count',             // A potential alternative
  'a[href*="friends"] .nav-menu-item-text + span'     // Another potential alternative (e.g., "Friends" text followed by count)
];

// MutationObserver to watch for changes in the DOM and re-apply updates
const observer = new MutationObserver((mutations: MutationRecord[]) => {
  mutations.forEach((mutation: MutationRecord) => {
    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === 1) {
          const element = node as Element;
          const foundRelevantElement = FRIEND_COUNT_SELECTORS.some(selector => element.matches(selector) || element.querySelector(selector));
          if (foundRelevantElement) {
            if (lastKnownFriendCount > 0) {
              updateLeftNavFriendsCount(lastKnownFriendCount);
            }
            break;
          }
        }
      }
    }
  });
});

// Function to check if the current URL matches the specified pattern
function checkCurrentURL(): boolean {
  const url: string = window.location.href;
  return url.startsWith("https://www.roblox.com/users/") && url.includes("friends#!/friend-requests");
}

// Helper to wait for an element to appear in the DOM
function waitForElm(selector: string): Promise<Element | null> {
  return new Promise((resolve: (value: Element | null) => void) => {
    if (document.querySelector(selector)) {
      return resolve(document.querySelector(selector));
    }

    const observer = new MutationObserver((_mutations: MutationRecord[]) => {
      if (document.querySelector(selector)) {
        resolve(document.querySelector(selector));
        observer.disconnect();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  });
}

function connectToBackground(): chrome.runtime.Port {
  backgroundPort = chrome.runtime.connect({ name: "friendRequestPort" });
  backgroundPort.onDisconnect.addListener(() => {
    console.warn("Background script disconnected. Attempting to reconnect on next update.");
    backgroundPort = undefined; // Clear the disconnected port
  });
  return backgroundPort;
}

async function sendMessageWithRetry(message: MessageRequest, retries: number = 3, delay: number = 1000): Promise<MessageResponse> {
  for (let i = 0; i < retries; i++) {
    try {
      const port: chrome.runtime.Port = connectToBackground();
      if (!port) {
        throw new Error("Failed to connect to background script.");
      }

      return new Promise((resolve: (value: MessageResponse) => void, reject: (reason?: any) => void) => {
        const timeoutId = setTimeout(() => {
          reject(new Error("Message response timed out."));
          if (port) port.disconnect();
        }, 10 * 1000); // 10 second timeout for response

        const handler = function(response: MessageResponse) {
          clearTimeout(timeoutId);
          port.onMessage.removeListener(handler);
          resolve(response);
        };
        
        port.onMessage.addListener(handler);

        try {
          port.postMessage(message);
        } catch (error: any) {
          clearTimeout(timeoutId);
          reject(new Error(`Failed to post message: ${error.message}`));
        }
      });
    } catch (error: any) {
      if (error.message.includes("Extension context invalidated") || error.message.includes("disconnected") || error.message.includes("Failed to connect")) {
        console.warn(`Retrying message due to: ${error.message}. Attempt ${i + 1}/${retries}`);
        if (i < retries - 1) {
          await new Promise(res => setTimeout(res, delay));
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }
  }
  throw new Error("Failed to establish communication with background script after multiple retries.");
}

// Function to update the left navigation "Friends" count
function updateLeftNavFriendsCount(count: number | string): void {
  let leftNavFriendsCount: HTMLSpanElement | null = null;

  for (const selector of FRIEND_COUNT_SELECTORS) {
    leftNavFriendsCount = document.querySelector<HTMLSpanElement>(selector);
    if (leftNavFriendsCount) break;
  }

  if (leftNavFriendsCount) {
    // Format the count if it's a number
    const displayCount = typeof count === 'number' ? count.toLocaleString() : String(count);

    if (leftNavFriendsCount.innerHTML !== displayCount) {
      leftNavFriendsCount.innerHTML = displayCount;
      leftNavFriendsCount.setAttribute('id', 'friendSubLeftNav');
      console.log("Updated left navigation Friends count to:", displayCount);
    }
  }
}

async function fetchAndUpdateFriendRequests(): Promise<void> {
  try {
    const checkURL: boolean = checkCurrentURL();
    const response: MessageResponse = await sendMessageWithRetry({ action: "start" });
    const count: number | string = response.req;
    lastKnownFriendCount = typeof count === 'number' ? count : 0;

    if (typeof count === 'number' || typeof count === 'string') {
      // Create the formatted string once
      const formattedCount = typeof count === 'number' ? count.toLocaleString() : String(count);
      const notificationElements = document.getElementsByClassName("notification-blue notification");
      if (notificationElements.length > 0) {
        const targetFriendSub = notificationElements[0] as HTMLElement;
        targetFriendSub.innerHTML = formattedCount; // Uses "1,000" instead of "1000"
        targetFriendSub.setAttribute('id', 'friendSub');
      }

      updateLeftNavFriendsCount(count);

      if (checkURL) {
        waitForElm(".friends-subtitle").then((friendsSubtitle: Element | null) => {
          if (friendsSubtitle && friendsSubtitle.innerHTML.includes("Requests")) {
            // The formatted string for the subtitle (e.g., "(1,234)")
            const newCountString = `(${formattedCount})`;
            let countElement = friendsSubtitle.querySelector<HTMLSpanElement>('span[class*="count"], span[class*="number"]');

            if (countElement) {
              countElement.textContent = newCountString;
            } else {
              // Regex fallback: now matches numbers with commas too
              const countRegex = /\([\d,]+\+?\)|\([\d,]+\)/; 
              const currentInnerHTML = friendsSubtitle.innerHTML;

              if (countRegex.test(currentInnerHTML)) {
                friendsSubtitle.innerHTML = currentInnerHTML.replace(countRegex, newCountString);
              } else {
                friendsSubtitle.innerHTML = `${currentInnerHTML.trim()} <span class="text-secondary">${newCountString}</span>`;
              }
            }
          }
        });
      }
    }
  } catch (err: any) {
    console.error("Error fetching friend requests:", err);
  }
}

// Main execution logic
(async() => {
  // Start observing the body for all changes
  observer.observe(document.body, { childList: true, subtree: true });
  
  // Fetch immediately on load
  await fetchAndUpdateFriendRequests();

  // Set up polling every 1 seconds
  updateInterval = setInterval(fetchAndUpdateFriendRequests, 1 * 1000);

  // Clear interval when page is unloaded
  window.onbeforeunload = () => {
    clearInterval(updateInterval);
  };
})();