// Function to check if the popup should be shown
let doNotShowPopup = false;

// Declare updateInterval in a higher scope
let updateInterval;
let lastKnownFriendCount = 0; // New: Store the last known friend count

// Helper function to send message with retry logic
let backgroundPort;

// Function to check if the current URL matches the specified pattern
function checkURL() {
  const url = window.location.href;
  return url.startsWith("https://www.roblox.com/users/") && url.includes("friends#!/friend-requests");
}

// Helper to wait for an element to appear in the DOM
function waitForElm(selector) {
  return new Promise((resolve) => {
    if (document.querySelector(selector)) {
      return resolve(document.querySelector(selector));
    }

    const observer = new MutationObserver((_) => {
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
async function shouldShowPopup() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['doNotShowPopup'], function(result) {
      doNotShowPopup = result.doNotShowPopup || false;
      resolve(!doNotShowPopup);
    });
  });
}

// Function to display the popup message
async function displayPopupMessage() {
  // Display a popup message on the site
  const showPopup = await shouldShowPopup();
  if (showPopup) {
    const popupMessage = document.createElement("div");
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

    const doNotShowAgainBtn = popupMessage.querySelector("#doNotShowAgain");
    if (doNotShowAgainBtn) {
      doNotShowAgainBtn.addEventListener("click", () => {
        popupMessage.remove(); // Remove the popup
        // Store a flag in local storage to prevent showing the popup again
        chrome.storage.sync.set({ 'doNotShowPopup': true });
      });
    }
  }
}

// Function to display temporary messages
function displayTemporaryMessage(message) {
  const tempMessage = document.createElement("div");
  tempMessage.textContent = message; // Use textContent for safety

  const styles = {
    position: "fixed",
    bottom: "20px",
    left: "50%",
    transform: "translateX(-50%)",
    backgroundColor: "#333",
    color: "#fff",
    padding: "10px 20px",
    borderRadius: "5px",
    zIndex: "10001",
    fontFamily: "'Arial', sans-serif"
  };

  for (const prop in styles) {
    tempMessage.style[prop] = styles[prop];
  }

  document.body.appendChild(tempMessage);

  setTimeout(() => {
    tempMessage.remove();
  }, 5000); // Message disappears after 5 seconds
}

function connectToBackground() {
  if (backgroundPort && backgroundPort.connected) {
    return backgroundPort;
  }
  backgroundPort = chrome.runtime.connect({ name: "friendRequestPort" });
  backgroundPort.onDisconnect.addListener(() => {
    console.warn("Background script disconnected. Attempting to reconnect on next update.");
    backgroundPort = null; // Clear the disconnected port
  });
  return backgroundPort;
}

async function sendMessageWithRetry(message, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const port = connectToBackground();
      if (!port) {
        throw new Error("Failed to connect to background script.");
      }

      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error("Message response timed out."));
          if (port && port.connected) port.disconnect();
        }, 10000); // 10 second timeout for response

        port.onMessage.addListener(function handler(response) {
          clearTimeout(timeoutId);
          port.onMessage.removeListener(handler);
          resolve(response);
        });

        try {
          port.postMessage(message);
        } catch (error) {
          clearTimeout(timeoutId);
          reject(new Error(`Failed to post message: ${error.message}`));
        }
      });
    } catch (error) {
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
function updateLeftNavFriendsCount(count) {
  const leftNavFriendsCount = document.querySelector('a[href*="friends"] div.foundation-web-badge span');
  if (leftNavFriendsCount) {
    if (leftNavFriendsCount.innerHTML !== String(count)) { // Only update if necessary to avoid unnecessary DOM writes
      leftNavFriendsCount.innerHTML = count;
      leftNavFriendsCount.setAttribute('id', 'friendSubLeftNav'); // Give it a distinct ID
      console.log("Updated left navigation Friends count to:", leftNavFriendsCount.innerHTML);
    }
  }
}

// MutationObserver to watch for changes in the DOM and re-apply updates
const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
      // Check if any of the added nodes (or their descendants) contain the left nav friends link
      for (const node of mutation.addedNodes) {
        if (node.nodeType === 1 && (node.matches('a[href*="friends"] div.foundation-web-badge span') || node.querySelector('a[href*="friends"] div.foundation-web-badge span'))) {
          if (lastKnownFriendCount > 0) {
            updateLeftNavFriendsCount(lastKnownFriendCount);
          }
          break; // Found a relevant change, no need to check other added nodes for this mutation
        }
      }
    }
  });
});

async function fetchAndUpdateFriendRequests() {
  try {
    const response = await sendMessageWithRetry({ action: "start" });

    const count = response.req;
    // Log the count
    console.log("Fetched friend request count:", count);
    lastKnownFriendCount = count; // Update the global last known count

    if (typeof count === 'number' || typeof count === 'string') {
      const notificationElements = document.getElementsByClassName("notification-blue notification");
      let targetFriendSub = null;

      if (notificationElements.length > 0) {
        targetFriendSub = notificationElements[0];
        targetFriendSub.innerHTML = count;
        targetFriendSub.setAttribute('id', 'friendSub');
      }

      // Call the new function to update the left navigation Friends count
      updateLeftNavFriendsCount(count);

      if (checkURL()) {
        console.log("Current URL matches, attempting to update .friends-subtitle"); // Log URL check
        waitForElm(".friends-subtitle").then((friendsSubtitle) => {
          // Look for a span element within friendsSubtitle that might contain the count
          if (friendsSubtitle && friendsSubtitle.innerHTML.includes("Requests")) {
            // This is a common pattern for styled numbers.
            let countElement = friendsSubtitle.querySelector('span[class*="count"], span[class*="number"], span[class*="badge"], span[class*="text-secondary"]');

            if (countElement) {
              // If a suitable span is found, update its text content
              countElement.textContent = `(${count})`;
              console.log("Updated .friends-subtitle count element to:", countElement.textContent);
            } else {
              // Fallback: If no specific span is found, try to replace the count using regex on innerHTML
              // This is riskier but attempts to preserve other HTML.
              const currentInnerHTML = friendsSubtitle.innerHTML;
              const newCountString = `(${count})`;
              const countRegex = /\(\d+\+?\)|\(\d+\)/; // Matches (500+), (836), (123)

              if (countRegex.test(currentInnerHTML)) {
                friendsSubtitle.innerHTML = currentInnerHTML.replace(countRegex, newCountString);
                console.log("Updated .friends-subtitle via regex replacement:", friendsSubtitle.innerHTML);
              } else {
                // Last resort: If no count pattern found, append the new count in a span.
                // This assumes "Friend Requests" is plain text of friendsSubtitle and we need to add the styled count.
                friendsSubtitle.innerHTML = `${currentInnerHTML.trim()} <span class="text-secondary">${newCountString}</span>`; // Using a common Roblox class
                console.log("Fallback: Appended new count in span to .friends-subtitle:", friendsSubtitle.innerHTML);
              }
            }
            friendsSubtitle.setAttribute('id', "friendsSubtitleRequests");
            console.log("Final .friends-subtitle innerHTML after update:", friendsSubtitle.innerHTML);
          }
        });
      }
      
      if (typeof count === 'number' && count < 500) {
        displayPopupMessage();
      } else if (typeof count === 'string' && count.startsWith("Error")) {
        console.error("Failed to fetch friend requests:", count);
        if (targetFriendSub) {
          targetFriendSub.innerHTML = "Error";
        }
      }
    }
  } catch (err) {
    console.error("Error in main execution logic:", err);

    // Check if the error is due to extension context invalidated or disconnection
    if (err && err.message && (err.message.includes("Extension context invalidated") || err.message.includes("disconnected") || err.message.includes("Failed to connect"))) {
      console.error("Extension context invalidated, disconnected, or failed to connect. Attempting to restart updates...");
      clearInterval(updateInterval); // Clear current interval
      displayTemporaryMessage("Extension connection lost. Attempting to reconnect...");

      // Attempt to restart polling after a short delay
      setTimeout(() => {
        // Re-run the initial fetch and set the interval again
        // This will automatically try to re-establish the connection via connectToBackground()
        fetchAndUpdateFriendRequests();
        updateInterval = setInterval(fetchAndUpdateFriendRequests, 1 * 1000); // 2 seconds
      }, 5000); // Wait 5 seconds before attempting to restart
    }
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