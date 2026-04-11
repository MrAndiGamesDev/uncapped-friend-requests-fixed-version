// Function to check if the popup should be shown
let doNotShowPopup = false;

// Declare updateInterval in a higher scope
let updateInterval;

// Function to check if the current URL matches the specified pattern
function checkURL() {
  const url = window.location.href;
  return url.includes("friends#!/friend-requests");
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
  tempMessage.innerHTML = message;
  tempMessage.style.position = "fixed";
  tempMessage.style.bottom = "20px";
  tempMessage.style.left = "50%";
  tempMessage.style.transform = "translateX(-50%)";
  tempMessage.style.backgroundColor = "#333";
  tempMessage.style.color = "#fff";
  tempMessage.style.padding = "10px 20px";
  tempMessage.style.borderRadius = "5px";
  tempMessage.style.zIndex = "10001";
  tempMessage.style.fontFamily = "'Arial', sans-serif";
  document.body.appendChild(tempMessage);

  setTimeout(() => {
    tempMessage.remove();
  }, 5000); // Message disappears after 5 seconds
}

// Helper function to send message with retry logic
async function sendMessageWithRetry(message, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(response);
          }
        });
      });
      return response;
    } catch (error) {
      if (error.message.includes("Extension context invalidated") && i < retries - 1) {
        console.warn(`Retrying message due to: ${error.message}. Attempt ${i + 1}/${retries}`);
        await new Promise(res => setTimeout(res, delay));
      } else {
        throw error;
      }
    }
  }
}

async function fetchAndUpdateFriendRequests() {
  try {
    const response = await sendMessageWithRetry({ action: "start" });

    const count = response.req;
    console.log("Fetched friend request count:", count); // Log the count

    if (typeof count === 'number' || typeof count === 'string') {
      const notificationElements = document.getElementsByClassName("notification-blue notification");
      let targetFriendSub = null;

      if (notificationElements.length > 0) {
        targetFriendSub = notificationElements[0];
        targetFriendSub.innerHTML = count;
        targetFriendSub.setAttribute('id', 'friendSub');
      }

      if (checkURL()) {
        console.log("Current URL matches, attempting to update .friends-subtitle"); // Log URL check
        waitForElm(".friends-subtitle").then((friendsSubtitle) => {
          console.log("Found .friends-subtitle. Current innerHTML:", friendsSubtitle.innerHTML); // Log current innerHTML
          if (friendsSubtitle && friendsSubtitle.innerHTML.includes("Requests")) {
            friendsSubtitle.innerHTML = `Friend Requests (${count})`;
            friendsSubtitle.setAttribute('id', "friendsSubtitleRequests");
            console.log("Updated .friends-subtitle to:", friendsSubtitle.innerHTML); // Log updated innerHTML
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

    // Check if the error is due to extension context invalidated
    if (err && err.message && err.message.includes("Extension context invalidated")) {
      // Optionally, display a user-friendly message on the page
      console.error("Extension context invalidated. Stopping further updates.");
      clearInterval(updateInterval); // Stop polling
      displayTemporaryMessage("Extension needs to be reloaded to function correctly.");
    }
  }
}

// Main execution logic
(async () => {
  // Fetch immediately on load
  await fetchAndUpdateFriendRequests();

  // Set up polling every 10 seconds
  updateInterval = setInterval(fetchAndUpdateFriendRequests, 2 * 1000); // 2 seconds

  // Clear interval when page is unloaded
  window.onbeforeunload = () => {
    clearInterval(updateInterval);
  };
})();