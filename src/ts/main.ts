interface ChromeStorageResult {
  doNotShowPopup?: boolean;
}

interface MessageRequest {
  action: "start";
}

interface MessageResponse {
  req: number | string;
}

// Function to check if the popup should be shown
let doNotShowPopup: boolean = false;

// Declare updateInterval in a higher scope
let updateInterval: number;
let lastKnownFriendCount: number = 0; // New: Store the last known friend count

// Helper function to send message with retry logic
let backgroundPort: chrome.runtime.Port | undefined;

// Global selectors for friend count elements
const FRIEND_COUNT_SELECTORS = [
  'a[href*="friends"] div.foundation-web-badge span', // Most specific, original selector
  'a[href*="friends"] span.friend-count',             // A potential alternative
  'a[href*="friends"] .nav-menu-item-text + span'     // Another potential alternative (e.g., "Friends" text followed by count)
];

// MutationObserver to watch for changes in the DOM and re-apply updates
const observer = new MutationObserver((mutations: MutationRecord[]) => {
  mutations.forEach((mutation) => {
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
function checkURL(): boolean {
  const url: string = window.location.href;
  return url.startsWith("https://www.roblox.com/users/") && url.includes("friends#!/friend-requests");
}

// Helper to wait for an element to appear in the DOM
function waitForElm(selector: string): Promise<Element | null> {
  return new Promise((resolve) => {
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

// Function to check if the popup should be shown
async function shouldShowPopup(): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['doNotShowPopup'], function(result: ChromeStorageResult) {
      doNotShowPopup = result.doNotShowPopup || false;
      resolve(!doNotShowPopup);
    });
  });
}

// Function to display the popup message
async function displayPopupMessage(): Promise<void> {
  // Display a popup message on the site
  const showPopup: boolean = await shouldShowPopup();
  if (showPopup) {
    const popupMessage: HTMLDivElement = document.createElement("div");
    popupMessage.innerHTML = `
      <div style="font-weight: bold; font-size: 1.1em; margin-bottom: 10px;">Uncapped Friend Requests</div>
      <div style="margin-bottom: 5px;">You have less than 500 friend requests.</div>
      <div style="margin-bottom: 15px;">The Uncapped Roblox Friend Requests extension is unnecessary.</div>
      <button id="doNotShowAgain" style="background-color: #007bff; color: #ffffff; border: none; padding: 10px 15px; border-radius: 5px; cursor: pointer; font-size: 14px; margin-top: 15px; transition: background-color 0.2s ease;">Do Not Show Again</button>
      <div style="font-size: 0.9em; color: #777; margin-top: 10px;">Closing in 15 seconds...</div>
    `;
    popupMessage.style.position = "fixed";
    popupMessage.style.top = "50%";
    popupMessage.style.left = "50%";
    popupMessage.style.transform = "translate(-50%, -50%)";
    popupMessage.style.backgroundColor = "#ffffff";
    popupMessage.style.padding = "25px";
    popupMessage.style.borderRadius = "8px";
    popupMessage.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.15)";
    popupMessage.style.zIndex = "10000";
    popupMessage.style.fontFamily = "'Arial', sans-serif";
    popupMessage.style.color = "#333333";
    popupMessage.style.textAlign = "center";
    popupMessage.style.maxWidth = "350px";
    popupMessage.style.lineHeight = "1.5";
    document.body.appendChild(popupMessage);

    // Remove the popup after 15 seconds
    setTimeout(() => {
      popupMessage.remove();
    }, 15 * 1000);

    const doNotShowAgainBtn = popupMessage.querySelector<HTMLButtonElement>("#doNotShowAgain");
    if (doNotShowAgainBtn) {
      doNotShowAgainBtn.addEventListener("click", () => {
        popupMessage.remove(); // Remove the popup
        // Store a flag in local storage to prevent showing the popup again
        chrome.storage.sync.set({ 'doNotShowPopup': true });
      });
    }
  }
}

function connectToBackground(): chrome.runtime.Port {
  if (backgroundPort) {
    return backgroundPort;
  }
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

      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error("Message response timed out."));
          if (port) port.disconnect();
        }, 10000); // 10 second timeout for response

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
          throw error; // Re-throw after last retry attempt
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

      if (checkURL()) {
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
(async () => {
  // Start observing the body for all changes
  // We'll disconnect and reconnect this if needed, but for now, continuous observation.
  observer.observe(document.body, { childList: true, subtree: true });
  
  // Fetch immediately on load
  await fetchAndUpdateFriendRequests();

  // Set up polling every 2 seconds
  updateInterval = setInterval(fetchAndUpdateFriendRequests, 1 * 1000);

  // Clear interval when page is unloaded
  window.onbeforeunload = () => {
    clearInterval(updateInterval);
  };
})();